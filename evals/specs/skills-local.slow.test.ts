import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { photoRoll, screenshot, validate } from "@openwork/fraimz";
import { desktop } from "@openwork/hosts";
import {
  clickText,
  createAndSelectWorkspace,
  evalIn,
  measureLoadedSkills,
  measureSkillsWithSlowCloud,
  readComposerCapabilities,
  readLoadedExtensions,
  waitFor,
} from "@openwork/behaviors";

const appSpecsEnabled = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const title = appSpecsEnabled
  ? "local skills load quickly and stay usable from the composer"
  : "skills local skipped: set OPENWORK_EVAL_APP_SPECS=1 to opt in";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test.skipIf(!appSpecsEnabled)(title, async () => {
  await using app = await desktop({ name: "skills-local" });
  await using roll = photoRoll("skills-local");
  await createAndSelectWorkspace(app, { path: repoRoot });

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
  const createdSessionId = /\/session\/(ses_[^/?#]+)/.exec(sessionRoute)?.[1] ?? "";
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
});
