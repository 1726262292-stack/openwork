import { expect, test } from "vitest";
import { createAndSelectWorkspace, evalIn, waitFor } from "@openwork/behaviors";
import { photoRoll, screenshot, validate } from "@openwork/fraimz";
import { desktop } from "@openwork/hosts";

const appSpecsEnabled = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const title = appSpecsEnabled
  ? "app boots with a control route and meaningful visible content"
  : "app smoke skipped: set OPENWORK_EVAL_APP_SPECS=1 to opt in";

test.skipIf(!appSpecsEnabled)(title, async () => {
  await using app = await desktop({ name: "app-smoke" });
  await using roll = photoRoll("app-smoke");
  const workspace = await createAndSelectWorkspace(app, { path: process.cwd() });
  expect(workspace.route).toContain("/workspace/");
  expect(workspace.route).toContain("/session");
  const route = await evalIn(app, "window.__openworkControl.snapshot().route");
  expect(route).toBeTruthy();
  await waitFor(app, "document.body.innerText.trim().length > 40", { timeoutMs: 30_000, label: "rendered body text" });
  const shot = await screenshot(app);
  const seen = await validate(shot, [
    "A ready OpenWork workspace composer with meaningful visible content is on screen",
    "No generic error or 'Something went wrong' crash message is visible",
  ]);
  expect(seen.ok, seen.why).toBe(true);
  await roll.add(shot, seen);
});
