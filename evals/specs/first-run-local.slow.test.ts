import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { attachSurface } from "@openwork/cdp";
import { photoRoll, screenshot, validate } from "@openwork/fraimz";
import {
  clickButton,
  createLocalWorkspaceViaUi,
  currentHash,
  ensureReadyWorkspace,
  readAvailableModels,
  readComposerState,
  resetOnboarding,
  selectModel,
  sendComposerMessage,
  waitForAssistantReply,
  waitForText,
} from "@openwork/behaviors";

const cdpUrl = process.env.OPENWORK_EVAL_CDP_URL?.trim() ?? "";
const title = cdpUrl
  ? "first use without an invite or cloud reaches a usable local model"
  : "first-run local skipped: set OPENWORK_EVAL_CDP_URL to attach a running app";
const providerName = process.env.OPENAI_API_KEY?.trim()
  ? "openai"
  : process.env.ANTHROPIC_API_KEY?.trim()
    ? "anthropic"
    : "";
const prompt = "Create a short welcome checklist for this OpenWork workspace. Use exactly three bullets and mention one thing I can do next.";

test.skipIf(!cdpUrl)(title, async () => {
  await using app = await attachSurface({
    name: "running-app",
    kind: "electron",
    hostKind: "attached",
    cdpUrl,
  });
  await using roll = photoRoll("first-run-local");

  const reset = await resetOnboarding(app);
  expect(reset.route).toContain("/welcome");
  expect(reset.welcomeVisible).toBe(true);
  await waitForText(app, "Welcome to OpenWork");
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The Welcome to OpenWork heading and Use Without Cloud option are visible",
      "No generic error or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  const workspacePath = await mkdtemp(join(tmpdir(), "openwork-first-run-local-"));
  const workspace = await createLocalWorkspaceViaUi(app, { path: workspacePath });
  expect(workspace.path).toBe(workspacePath);
  expect(workspace.id).toBeTruthy();
  expect(await currentHash(app)).toContain("/welcome");
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The model setup step is visible with the Skip and use the free model option",
      "No generic error or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  await clickButton(app, "Skip and use the free model", { timeoutMs: 30_000 });
  await waitForText(app, "How did you hear about OpenWork?", { timeoutMs: 30_000 });
  await clickButton(app, "Skip", { timeoutMs: 15_000 });
  const ready = await ensureReadyWorkspace(app, { path: workspacePath });
  expect(ready.route).toContain(`/workspace/${workspace.id}/session`);
  const composer = await readComposerState(app);
  expect(composer.route).toContain("/workspace/");
  expect(composer.route).toContain("/session");
  expect(composer.runTaskVisible).toBe(true);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The workspace composer is visible with What do you need done? and a task input",
      "No generic error or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  const models = await readAvailableModels(app);
  expect(models.length).toBeGreaterThan(0);
  expect(models.some((model) => model.selectable)).toBe(true);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The Models picker visibly lists models that can be selected",
      "No generic error, empty-model failure, or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  const preferred = providerName
    ? models.find((model) =>
      model.providerName.toLowerCase().includes(providerName)
      || model.id.toLowerCase().includes(providerName === "openai" ? "gpt" : "claude"))
    : undefined;
  const selectable = preferred ?? models.find((model) => model.selectable);
  expect(selectable).toBeTruthy();
  if (!selectable) throw new Error("No selectable model was returned.");
  const selected = await selectModel(app, selectable.id);
  expect(selected.selectable).toBe(true);
  expect(selected.id).toBe(selectable.id);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The composer is ready after selecting a model",
      "No unavailable-model warning or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  // A real response requires the provider secrets volume. Without OPENAI_API_KEY
  // or ANTHROPIC_API_KEY this journey intentionally stops after proving a model
  // is selectable, rather than treating provider setup as a completed task.
  if (!providerName) return;

  const sent = await sendComposerMessage(app, prompt);
  expect(sent.userMessageCount).toBeGreaterThan(0);
  await waitForText(app, prompt, { timeoutMs: 30_000 });
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The submitted welcome-checklist task is visibly present in the conversation",
      "No task submission error or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  const reply = await waitForAssistantReply(app, { timeoutMs: 180_000 });
  expect(reply.assistantMessageCount).toBeGreaterThan(0);
  expect(reply.text.trim().length).toBeGreaterThan(0);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "A substantive assistant response to the welcome-checklist task is visible",
      "No response failure or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }
});
