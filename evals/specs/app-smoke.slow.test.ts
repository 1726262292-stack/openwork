import { expect, test } from "vitest";
import { attachSurface } from "@openwork/cdp";
import { ensureReadyWorkspace, evalIn, waitFor } from "@openwork/behaviors";
import { photoRoll, screenshot, validate } from "@openwork/fraimz";

const cdpUrl = process.env.OPENWORK_EVAL_CDP_URL?.trim() ?? "";
const title = cdpUrl
  ? "app boots with a control route and meaningful visible content"
  : "app smoke skipped: set OPENWORK_EVAL_CDP_URL to attach a running app";

test.skipIf(!cdpUrl)(title, async () => {
  await using app = await attachSurface({
    name: "running-app",
    kind: "electron",
    hostKind: "attached",
    cdpUrl,
  });
  await using roll = photoRoll("app-smoke");
  await waitFor(app, "Boolean(window.__openworkControl)", { timeoutMs: 30_000, label: "window.__openworkControl" });
  const workspace = await ensureReadyWorkspace(app);
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
