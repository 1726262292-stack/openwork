import { fileURLToPath } from "node:url";
import { expect, onTestFinished, test } from "vitest";
import { attachSurface } from "@openwork/cdp";
import { photoRoll, screenshot, validate } from "@openwork/fraimz";
import {
  clickText,
  deleteEvalSession,
  ensureFreshWorkspace,
  ensureReadyWorkspace,
  evalIn,
  go,
  measureLoadedSkills,
  measureSkillsWithSlowCloud,
  readComposerCapabilities,
  readLoadedExtensions,
  resetSkillsCloudState,
  waitFor,
} from "@openwork/behaviors";

const cdpUrl = process.env.OPENWORK_EVAL_CDP_URL?.trim() ?? "";
const title = cdpUrl
  ? "local skills load quickly and stay usable from the composer"
  : "skills local skipped: set OPENWORK_EVAL_CDP_URL to attach a running app";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test.skipIf(!cdpUrl)(title, async () => {
  await using app = await attachSurface({
    name: "running-app",
    kind: "electron",
    hostKind: "attached",
    cdpUrl,
  });
  await using roll = photoRoll("skills-local");
  await ensureReadyWorkspace(app, { path: repoRoot });
  const workspaceId = await ensureFreshWorkspace(app, { path: repoRoot });
  let createdSessionId = "";
  onTestFinished(async () => {
    if (!createdSessionId) return;
    await using cleanupApp = await attachSurface({ name: "skills-local-cleanup", kind: "electron", hostKind: "attached", cdpUrl });
    await deleteEvalSession(cleanupApp, workspaceId, createdSessionId);
  });
  await go(app, `/workspace/${workspaceId}/session`);
  await ensureReadyWorkspace(app, { path: repoRoot });

  try {
    const capabilities = await readComposerCapabilities(app);
    expect(capabilities.sections).toEqual(["Agents", "Commands", "Skills", "Extensions"]);
    {
      const shot = await screenshot(app);
      const seen = await validate(shot, [
        "The composer capability menu visibly shows Agents, Commands, Skills, and Extensions",
        "No loading failure or 'Something went wrong' crash message is visible",
      ]);
      expect(seen.ok, seen.why).toBe(true);
      await roll.add(shot, seen);
    }

    const firstLoad = await measureLoadedSkills(app);
    expect(firstLoad.rowCount).toBeGreaterThanOrEqual(10);
    expect(firstLoad.elapsedMs).toBeLessThan(3_000);
    expect(firstLoad.skills.some((skill) => skill.name === "/browser-automation")).toBe(true);
    expect(firstLoad.skills.some((skill) => skill.name === "/browser-automation" && skill.local)).toBe(true);
    expect(firstLoad.loadingCommandsVisible).toBe(false);
    {
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

    await clickText(app, "New session", { timeoutMs: 30_000 });
    await waitFor(app, `/^#\\/workspace\\/[^/?#]+\\/session\\/ses_[^/?#]+/.test(window.location.hash)`, {
      timeoutMs: 30_000,
      label: "new session id route",
    });
    const sessionRoute = await evalIn(app, "window.location.hash");
    if (typeof sessionRoute !== "string") throw new Error("New session route was not a string.");
    createdSessionId = /\/session\/(ses_[^/?#]+)/.exec(sessionRoute)?.[1] ?? "";
    if (!createdSessionId) throw new Error(`New session route had no session ID: ${sessionRoute}`);
    const coldLoad = await measureLoadedSkills(app);
    expect(coldLoad.rowCount).toBeGreaterThanOrEqual(10);
    expect(coldLoad.elapsedMs).toBeLessThan(3_000);
    expect(coldLoad.skills.some((skill) => skill.name === "/browser-automation")).toBe(true);
    expect(await evalIn(app, "window.location.hash")).toEqual(expect.stringContaining("/session/"));
    {
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
      const shot = await screenshot(app);
      const seen = await validate(shot, [
        "Local skills including browser-automation remain visibly available while cloud loading is delayed",
        "No Loading commands state or 'Something went wrong' crash message is visible",
      ]);
      expect(seen.ok, seen.why).toBe(true);
      await roll.add(shot, seen);
    }
  } finally {
    await resetSkillsCloudState(app);
  }
});
