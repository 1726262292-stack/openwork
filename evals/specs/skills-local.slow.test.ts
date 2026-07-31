import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { photoRoll, screenshot, validate } from "@openwork/fraimz";
import { desktop } from "@openwork/hosts";
import {
  clickButton,
  control,
  createAndSelectWorkspace,
  enabledButtons,
  evalIn,
  go,
  measureLoadedSkills,
  measureSkillsWithSlowCloud,
  readComposerCapabilities,
  readLoadedExtensions,
  revealMenuRow,
  waitFor,
  waitUntilInteractive,
} from "@openwork/behaviors";

const appSpecsEnabled = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const title = appSpecsEnabled
  ? "local skills load quickly and stay usable from the composer"
  : "skills local skipped: set OPENWORK_EVAL_APP_SPECS=1 to opt in";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test.skipIf(!appSpecsEnabled)(title, async () => {
  await using app = await desktop({ name: "skills-local" });
  await using roll = photoRoll("skills-local");
  const workspace = await createAndSelectWorkspace(app, { path: repoRoot });

  const capabilities = await readComposerCapabilities(app);
  expect(capabilities.sections).toEqual(["Agents", "Commands", "Skills", "Extensions"]);
  {
    await revealMenuRow(app, "Agents");
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The composer capability menu visibly shows the Agents section among its capability sections",
      "No loading failure or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  const firstLoad = await measureLoadedSkills(app);
  expect(firstLoad.rowCount).toBeGreaterThanOrEqual(10);
  expect(firstLoad.elapsedMs).toBeLessThan(3_000);
  expect(
    firstLoad.skills.some((skill) => skill.name === "/browser-automation"),
    `expected a /browser-automation skill. Loaded: ${firstLoad.skills.map((skill) => skill.name).join(", ")}`,
  ).toBe(true);
  expect(firstLoad.skills.some((skill) => skill.name === "/browser-automation" && skill.local)).toBe(true);
  expect(firstLoad.loadingCommandsVisible).toBe(false);
  {
    await revealMenuRow(app, "/browser-automation");
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The Skills list visibly includes the local browser-automation skill",
      "No Loading commands state or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  const extensions = await readLoadedExtensions(app);
  expect(extensions.some((label) => label.includes("OpenWork Browser"))).toBe(true);
  expect(await evalIn(app, `document.body.innerText.includes("Loading commands")`)).toBe(false);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The Extensions list visibly includes OpenWork Browser",
      "No Loading commands state or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  // "New session" is rendered as a control rather than plain clickable text in
  // some layouts, so use the product's own action when it is available.
  const sessionActions = await enabledButtons(app);
  if (sessionActions.includes("New session")) await clickButton(app, "New session", { timeoutMs: 30_000 });
  else await control(app, "session.create_task");
  // A created session does not always put its id in the hash; wait for the app
  // to be interactive on the session surface instead.
  await waitUntilInteractive(app, { timeoutMs: 120_000 });
  // The app does not always navigate to the new session, so ask it for the list
  // rather than scraping the route. Observed payload shape:
  // { ok, actionId, result: [{ sessionId: "ses_…", title, workspace, updatedAt }] }
  const listed = await waitFor(app, `(async () => {
    const result = await window.__openworkControl.execute("session.list_sessions", null);
    const sessions = Array.isArray(result?.result) ? result.result : [];
    const withId = sessions.map((entry) => entry?.sessionId).filter((id) => typeof id === "string" && id.startsWith("ses_"));
    return withId.length > 0 ? withId[0] : false;
  })()`, { timeoutMs: 120_000, awaitPromise: true, label: "created session id" });
  const createdSessionId = typeof listed === "string" ? listed : "";
  if (!createdSessionId) throw new Error(`Could not read a created session id, got: ${JSON.stringify(listed)}`);
  await go(app, `/workspace/${workspace.workspaceId}/session/${createdSessionId}`);
  await waitUntilInteractive(app, { timeoutMs: 120_000 });
  const coldLoad = await measureLoadedSkills(app);
  expect(coldLoad.rowCount).toBeGreaterThanOrEqual(10);
  expect(coldLoad.elapsedMs).toBeLessThan(3_000);
  expect(coldLoad.skills.some((skill) => skill.name === "/browser-automation")).toBe(true);
  expect(await evalIn(app, "window.location.hash")).toEqual(expect.stringContaining("/session/"));
  {
    await revealMenuRow(app, "/browser-automation");
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "A newly created session visibly shows the local browser-automation skill",
      "No Loading commands state or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  const slowCloud = await measureSkillsWithSlowCloud(app);
  expect(slowCloud.denRequestCount).toBeGreaterThanOrEqual(1);
  expect(slowCloud.elapsedMs).toBeLessThan(3_000);
  expect(slowCloud.connectSettledMs).toBeNull();
  expect(slowCloud.rowCount).toBeGreaterThanOrEqual(10);
  expect(slowCloud.skills.some((skill) => skill.name === "/browser-automation")).toBe(true);
  expect(slowCloud.loadingCommandsVisible).toBe(false);
  {
    await revealMenuRow(app, "/browser-automation");
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "Local skills including browser-automation remain visibly available while cloud loading is delayed",
      "No Loading commands state or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }
});
