import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { attachSurface } from "@openwork/cdp";
import { fraimz } from "@openwork/fraimz";
import {
  clickText,
  ensureFreshWorkspace,
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

async function createSession(app: Awaited<ReturnType<typeof attachSurface>>): Promise<void> {
  await waitFor(app, `window.__openworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 60_000,
    label: "session.create_task enabled",
  });
  await evalIn(app, `window.__openworkControl.execute("session.create_task", null)`, { awaitPromise: true });
  await waitFor(app, `window.location.hash.includes("/session/")`, { timeoutMs: 60_000, label: "created session route" });
}

test.skipIf(!cdpUrl)(title, async ({ annotate }) => {
  await using app = await attachSurface({
    name: "running-app",
    kind: "electron",
    hostKind: "attached",
    cdpUrl,
  });
  const frame = fraimz((message, attachment) => annotate(message, typeof attachment === "string" ? attachment : undefined));
  const workspaceId = await ensureFreshWorkspace(app, { path: repoRoot });
  await go(app, `/workspace/${workspaceId}/session`);
  await createSession(app);

  try {
    const capabilities = await readComposerCapabilities(app);
    expect(capabilities.sections).toEqual(["Agents", "Commands", "Skills", "Extensions"]);
    await frame(app, "skills-1-composer-capability-sections");

    const firstLoad = await measureLoadedSkills(app);
    expect(firstLoad.rowCount).toBeGreaterThanOrEqual(10);
    expect(firstLoad.elapsedMs).toBeLessThan(3_000);
    expect(firstLoad.skills.some((skill) => skill.name === "/browser-automation")).toBe(true);
    expect(firstLoad.skills.some((skill) => skill.name === "/browser-automation" && skill.local)).toBe(true);
    expect(firstLoad.loadingCommandsVisible).toBe(false);
    await frame(app, "skills-2-local-skills-fast");

    const extensions = await readLoadedExtensions(app);
    expect(extensions.some((label) => label.includes("OpenWork Browser"))).toBe(true);
    expect(await evalIn(app, `document.body.innerText.includes("Loading commands")`)).toBe(false);
    await frame(app, "skills-3-extensions-settled");

    await clickText(app, "New session", { timeoutMs: 30_000 });
    await waitFor(app, `window.location.hash.includes("/session/")`, { timeoutMs: 30_000, label: "new session route" });
    const coldLoad = await measureLoadedSkills(app);
    expect(coldLoad.rowCount).toBeGreaterThanOrEqual(10);
    expect(coldLoad.elapsedMs).toBeLessThan(3_000);
    expect(coldLoad.skills.some((skill) => skill.name === "/browser-automation")).toBe(true);
    expect(await evalIn(app, "window.location.hash")).toEqual(expect.stringContaining("/session/"));
    await frame(app, "skills-4-cold-session-fast");

    const slowCloud = await measureSkillsWithSlowCloud(app);
    expect(slowCloud.denRequestCount).toBeGreaterThanOrEqual(1);
    expect(slowCloud.elapsedMs).toBeLessThan(3_000);
    expect(slowCloud.connectSettledMs).toBeNull();
    expect(slowCloud.rowCount).toBeGreaterThanOrEqual(10);
    expect(slowCloud.skills.some((skill) => skill.name === "/browser-automation")).toBe(true);
    expect(slowCloud.loadingCommandsVisible).toBe(false);
    await frame(app, "skills-5-fast-while-cloud-hangs");
  } finally {
    await resetSkillsCloudState(app);
  }
});
