import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { attachSurface } from "@openwork/cdp";
import { fraimz } from "@openwork/fraimz";
import {
  clickButton,
  createLocalWorkspaceViaUi,
  currentHash,
  readAvailableModels,
  readComposerState,
  resetOnboarding,
  selectModel,
  sendComposerMessage,
  waitFor,
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

test.skipIf(!cdpUrl)(title, async ({ annotate }) => {
  await using app = await attachSurface({
    name: "running-app",
    kind: "electron",
    hostKind: "attached",
    cdpUrl,
  });
  const frame = fraimz((message, attachment) => annotate(message, typeof attachment === "string" ? attachment : undefined));

  const reset = await resetOnboarding(app);
  expect(reset.route).toContain("/welcome");
  expect(reset.welcomeVisible).toBe(true);
  await waitForText(app, "Welcome to OpenWork");
  await frame(app, "first-run-1-welcome");

  const workspacePath = await mkdtemp(join(tmpdir(), "openwork-first-run-local-"));
  const workspace = await createLocalWorkspaceViaUi(app, { path: workspacePath });
  expect(workspace.path).toBe(workspacePath);
  expect(workspace.id).toBeTruthy();
  expect(await currentHash(app)).toContain("/welcome");
  await frame(app, "first-run-2-local-workspace-created");

  await clickButton(app, "Skip and use the free model", { timeoutMs: 30_000 });
  await waitForText(app, "How did you hear about OpenWork?", { timeoutMs: 30_000 });
  await clickButton(app, "Skip", { timeoutMs: 15_000 });
  await waitFor(app, `window.__openworkControl.snapshot().route.includes("/session/ses_")`, {
    timeoutMs: 90_000,
    label: "first onboarding session route",
  });
  const composer = await readComposerState(app);
  expect(composer.route).toContain("/workspace/");
  expect(composer.route).toContain("/session/");
  expect(composer.runTaskVisible).toBe(true);
  await frame(app, "first-run-3-chat-ready");

  const models = await readAvailableModels(app);
  expect(models.length).toBeGreaterThan(0);
  expect(models.some((model) => model.selectable)).toBe(true);
  await frame(app, "first-run-4-models-available");

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
  await frame(app, "first-run-5-model-selected");

  // A real response requires the provider secrets volume. Without OPENAI_API_KEY
  // or ANTHROPIC_API_KEY this journey intentionally stops after proving a model
  // is selectable, rather than treating provider setup as a completed task.
  if (!providerName) return;

  const sent = await sendComposerMessage(app, prompt);
  expect(sent.userMessageCount).toBeGreaterThan(0);
  await waitForText(app, prompt, { timeoutMs: 30_000 });
  await frame(app, "first-run-6-task-submitted");

  const reply = await waitForAssistantReply(app, { timeoutMs: 180_000 });
  expect(reply.assistantMessageCount).toBeGreaterThan(0);
  expect(reply.text.trim().length).toBeGreaterThan(0);
  await frame(app, "first-run-7-assistant-response");
});
