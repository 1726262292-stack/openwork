import { createHash } from "node:crypto";
import { control, createAndSelectWorkspace, evalIn, waitFor } from "@openwork/behaviors";
import { connect, debuggerUrlFor, evaluate, listTargets, targetById } from "@openwork/cdp";
import type { CdpClient, CdpTarget, Surface } from "@openwork/cdp";
import { currentTape, validate } from "@openwork/fraimz";
import type { Shot, Tape } from "@openwork/fraimz";
import { expectFrame } from "@openwork/fraimz/vitest";
import { defaultDaytonaExec, desktop } from "@openwork/hosts";
import { needs, test } from "@openwork/testkit";
import { expect } from "vitest";

const FIXTURE_PORT = 43_127;
const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}/index.html`;
const LINK_URL = `http://localhost:${FIXTURE_PORT}/linked.html`;
const MENU_ITEM_HEIGHT = 36;
const MENU_SEPARATOR_HEIGHT = 13;

const PLAIN_LABELS = ["Back", "Forward", "Reload", "Copy Page URL", "Open Page in Browser"];
const LINK_LABELS = ["Open Link in New Tab", "Copy Link Address", "Open Link in Browser"];
const INPUT_LABELS = ["Cut", "Copy", "Paste", "Select All"];
const SELECTED_TEXT_LABELS = ["Copy"];
const TAB_LABELS = ["Copy URL", "Open in Browser", "Close Tab", "Close All Tabs"];

const fixtureHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>OpenWork Browser E2E Fixture</title>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { background: #f7f3e8; color: #181711; font: 16px/1.5 system-ui, sans-serif; }
      main { height: 100%; padding: 28px 34px; position: relative; }
      h1 { margin: 0 0 18px; font-size: 26px; }
      .row { display: flex; align-items: center; gap: 24px; margin-bottom: 20px; }
      a { color: #0645ad; font-weight: 700; }
      input { width: 280px; padding: 10px 12px; border: 2px solid #706b5b; border-radius: 8px; background: white; }
      button { padding: 10px 14px; border: 0; border-radius: 8px; color: white; background: #163a66; font-weight: 700; }
      #selectable { width: max-content; padding: 8px; background: #fff8cf; }
      #plain { position: absolute; left: 30%; top: 48%; width: 32%; height: 25%; border: 2px dashed #a39a7e; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #645f50; }
      #fixture-image { width: 72px; height: 48px; border-radius: 8px; }
      #marker { position: fixed; z-index: 2147483647; width: 30px; height: 30px; transform: translate(-15px, -15px); pointer-events: none; display: none; }
      #marker::before, #marker::after { content: ""; position: absolute; background: #ff00a8; box-shadow: 0 0 0 1px white; }
      #marker::before { left: 14px; top: 0; width: 2px; height: 30px; }
      #marker::after { left: 0; top: 14px; width: 30px; height: 2px; }
      #marker-ring { position: absolute; inset: 5px; border: 2px solid #ff00a8; border-radius: 999px; }
      #result { font: 13px/1.4 ui-monospace, monospace; color: #403b30; }
    </style>
  </head>
  <body>
    <main>
      <h1>Built-in browser interaction fixture</h1>
      <div class="row">
        <a id="fixture-link" href="/linked.html">Open deterministic linked page</a>
        <img id="fixture-image" alt="fixture image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='144' height='96'%3E%3Crect width='144' height='96' fill='%23e34b35'/%3E%3Ccircle cx='72' cy='48' r='28' fill='%23ffe36d'/%3E%3C/svg%3E">
      </div>
      <div class="row">
        <input id="fixture-input" value="Editable fixture text">
        <button id="passkey-button" type="button">Request a passkey</button>
        <span id="result">Passkey not requested</span>
      </div>
      <p id="selectable">Select this exact sentence for the Copy menu.</p>
      <div id="plain">Plain page area for context menu</div>
      <div id="marker"><div id="marker-ring"></div></div>
    </main>
    <script>
      window.__showContextMarker = (x, y) => {
        const marker = document.getElementById("marker");
        marker.style.left = x + "px";
        marker.style.top = y + "px";
        marker.style.display = "block";
      };
      document.getElementById("passkey-button").addEventListener("click", async () => {
        const startedAt = performance.now();
        let result;
        try {
          await navigator.credentials.get({
            publicKey: {
              challenge: new Uint8Array(32),
              timeout: 180000,
              rpId: "localhost",
              allowCredentials: [],
              userVerification: "preferred"
            }
          });
          result = { settled: true, elapsedMs: performance.now() - startedAt, resolved: true };
        } catch (error) {
          result = {
            settled: true,
            elapsedMs: performance.now() - startedAt,
            resolved: false,
            name: error && error.name,
            message: error && error.message,
            isDomException: error instanceof DOMException,
            constructorName: error && error.constructor && error.constructor.name
          };
        }
        window.__passkeyResult = result;
        document.getElementById("result").textContent = JSON.stringify(result);
      });
    </script>
  </body>
</html>`;

const linkedHtml = `<!doctype html><meta charset="utf-8"><title>Linked fixture page</title><body style="font:20px system-ui;background:#e8f4ff;padding:40px"><h1>Linked fixture page opened in a new tab</h1></body>`;

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number; top: number; right: number; bottom: number; left: number };
type MenuMetrics = {
  ariaLabel: string;
  labels: string[];
  innerWidth: number;
  innerHeight: number;
  itemHeights: number[];
  separatorFootprints: number[];
  menuRect: Rect;
  contentHeight: number;
  lastItemBottom: number;
  scrollHeight: number;
};
type BrowserTab = { id: string; url: string };
type BrowserState = { activeTabId: string | null; tabs: BrowserTab[] };
type PasskeyResult = {
  settled: boolean;
  elapsedMs: number;
  resolved: boolean;
  name: string;
  isDomException: boolean;
  constructorName: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function parsePoint(value: unknown, label: string): Point {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    throw new Error(`${label} did not resolve to a point: ${JSON.stringify(value)}`);
  }
  return { x: value.x, y: value.y };
}

function parseRect(value: unknown, label: string): Rect {
  if (
    !isRecord(value)
    || typeof value.x !== "number"
    || typeof value.y !== "number"
    || typeof value.width !== "number"
    || typeof value.height !== "number"
    || typeof value.top !== "number"
    || typeof value.right !== "number"
    || typeof value.bottom !== "number"
    || typeof value.left !== "number"
  ) {
    throw new Error(`${label} did not resolve to a rectangle: ${JSON.stringify(value)}`);
  }
  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    top: value.top,
    right: value.right,
    bottom: value.bottom,
    left: value.left,
  };
}

function parseMenuMetrics(value: unknown): MenuMetrics {
  if (
    !isRecord(value)
    || typeof value.ariaLabel !== "string"
    || !Array.isArray(value.labels)
    || !value.labels.every((entry) => typeof entry === "string")
    || typeof value.innerWidth !== "number"
    || typeof value.innerHeight !== "number"
    || !Array.isArray(value.itemHeights)
    || !value.itemHeights.every((entry) => typeof entry === "number")
    || !Array.isArray(value.separatorFootprints)
    || !value.separatorFootprints.every((entry) => typeof entry === "number")
    || typeof value.contentHeight !== "number"
    || typeof value.lastItemBottom !== "number"
    || typeof value.scrollHeight !== "number"
  ) {
    throw new Error(`Overlay did not expose menu metrics: ${JSON.stringify(value)}`);
  }
  return {
    ariaLabel: value.ariaLabel,
    labels: value.labels,
    innerWidth: value.innerWidth,
    innerHeight: value.innerHeight,
    itemHeights: value.itemHeights,
    separatorFootprints: value.separatorFootprints,
    menuRect: parseRect(value.menuRect, "menu"),
    contentHeight: value.contentHeight,
    lastItemBottom: value.lastItemBottom,
    scrollHeight: value.scrollHeight,
  };
}

function parseBrowserState(value: unknown): BrowserState {
  if (!isRecord(value) || (value.activeTabId !== null && typeof value.activeTabId !== "string") || !Array.isArray(value.tabs)) {
    throw new Error(`Browser state was invalid: ${JSON.stringify(value)}`);
  }
  const tabs: BrowserTab[] = [];
  for (const entry of value.tabs) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.url !== "string") {
      throw new Error(`Browser tab was invalid: ${JSON.stringify(entry)}`);
    }
    tabs.push({ id: entry.id, url: entry.url });
  }
  return { activeTabId: value.activeTabId, tabs };
}

function parsePasskeyResult(value: unknown): PasskeyResult {
  if (
    !isRecord(value)
    || typeof value.settled !== "boolean"
    || typeof value.elapsedMs !== "number"
    || typeof value.resolved !== "boolean"
    || typeof value.name !== "string"
    || typeof value.isDomException !== "boolean"
    || typeof value.constructorName !== "string"
  ) {
    throw new Error(`Passkey result was invalid: ${JSON.stringify(value)}`);
  }
  return {
    settled: value.settled,
    elapsedMs: value.elapsedMs,
    resolved: value.resolved,
    name: value.name,
    isDomException: value.isDomException,
    constructorName: value.constructorName,
  };
}

async function sandboxExec(sandbox: string, script: string, timeoutMs = 30_000): Promise<string> {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  const result = await defaultDaytonaExec(
    ["exec", sandbox, "--", "echo", encoded, "|", "base64", "-d", "|", "bash"],
    { timeoutMs },
  );
  if (result.code !== 0) {
    throw new Error(`Daytona command failed (${result.code}): ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

async function startFixtureServer(sandbox: string): Promise<void> {
  const html = Buffer.from(fixtureHtml, "utf8").toString("base64");
  const linked = Buffer.from(linkedHtml, "utf8").toString("base64");
  await sandboxExec(sandbox, `
set -euo pipefail
if [ -f /tmp/openwork-browser-fixture.pid ]; then kill "$(cat /tmp/openwork-browser-fixture.pid)" 2>/dev/null || true; fi
rm -rf /tmp/openwork-browser-fixture
mkdir -p /tmp/openwork-browser-fixture
printf %s ${shellQuote(html)} | base64 -d > /tmp/openwork-browser-fixture/index.html
printf %s ${shellQuote(linked)} | base64 -d > /tmp/openwork-browser-fixture/linked.html
nohup python3 -m http.server ${FIXTURE_PORT} --bind 127.0.0.1 --directory /tmp/openwork-browser-fixture >/tmp/openwork-browser-fixture.log 2>&1 &
echo $! > /tmp/openwork-browser-fixture.pid
for attempt in $(seq 1 50); do
  if curl -fsS ${FIXTURE_URL} >/dev/null; then exit 0; fi
  sleep 0.1
done
exit 1
`);
}

async function stopFixtureServer(sandbox: string): Promise<void> {
  await sandboxExec(sandbox, `
if [ -f /tmp/openwork-browser-fixture.pid ]; then
  kill "$(cat /tmp/openwork-browser-fixture.pid)" 2>/dev/null || true
  rm -f /tmp/openwork-browser-fixture.pid
fi
`).catch(() => undefined);
}

async function captureOsShot(app: Surface, sandbox: string): Promise<Shot> {
  const remotePath = `/tmp/openwork-browser-evidence-${Date.now()}.png`;
  const stdout = await sandboxExec(sandbox, `
set -euo pipefail
export DISPLAY=:99
xdotool search --name OpenWork windowactivate --sync 2>/dev/null || true
bash /workspace/.devcontainer/capture-daytona-screenshot.sh --output ${shellQuote(remotePath)} --size 1920x1080 >/tmp/openwork-browser-capture.log 2>&1
base64 -w 0 ${shellQuote(remotePath)}
rm -f ${shellQuote(remotePath)}
`);
  const png = Buffer.from(stdout.trim(), "base64");
  if (png.length < 1_000) throw new Error(`OS screenshot was unexpectedly small: ${png.length} bytes.`);
  const page = await evalIn(app, `({ route: location.hash, visibleText: document.body.innerText })`);
  if (!isRecord(page) || typeof page.route !== "string" || typeof page.visibleText !== "string") {
    throw new Error("The app did not expose route and visible text for OS evidence.");
  }
  const shot: Shot = {
    png,
    hash: createHash("sha256").update(png).digest("hex"),
    route: page.route,
    visibleText: page.visibleText,
    at: new Date().toISOString(),
  };
  const tape = currentTape();
  if (!tape) throw new Error("OS screenshot requires the ambient testkit evidence tape.");
  tape.recordTake(shot);
  return shot;
}

async function proveOsFrame(
  app: Surface,
  sandbox: string,
  expectations: string[],
): Promise<void> {
  const shot = await captureOsShot(app, sandbox);
  const seen = await validate(shot, expectations);
  expectFrame(seen);
}

async function waitUntil<T>(
  label: string,
  read: () => Promise<T | null>,
  timeoutMs = 20_000,
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await read();
      if (result !== null) return result;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${messageText(lastError)}` : ""}`);
}

async function findOverlayTarget(cdpBaseUrl: string): Promise<CdpTarget> {
  return waitUntil("menu overlay CDP target", async () => {
    const targets = await listTargets(cdpBaseUrl);
    return targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl && target.url.includes("overlay.html")) ?? null;
  });
}

async function elementCenter(client: CdpClient, selector: string): Promise<Point> {
  const value = await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  return parsePoint(value, selector);
}

async function viewportPoint(client: CdpClient, edge: "center" | "bottom-right"): Promise<Point> {
  const value = await evaluate(client, edge === "center"
    ? `({ x: innerWidth / 2, y: innerHeight / 2 })`
    : `({ x: innerWidth - 10, y: innerHeight - 10 })`);
  return parsePoint(value, `${edge} viewport point`);
}

async function showMarker(client: CdpClient, point: Point): Promise<void> {
  await evaluate(client, `window.__showContextMarker(${point.x}, ${point.y})`);
}

async function dispatchMouse(client: CdpClient, point: Point, button: "left" | "right"): Promise<void> {
  const buttons = button === "right" ? 2 : 1;
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button,
    buttons,
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button,
    buttons: 0,
    clickCount: 1,
  });
}

async function rightClick(client: CdpClient, point: Point, mark = true): Promise<void> {
  if (mark) await showMarker(client, point);
  await dispatchMouse(client, point, "right");
}

async function dispatchEscape(client: CdpClient): Promise<void> {
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
}

async function readMenuMetrics(client: CdpClient): Promise<MenuMetrics | null> {
  const value = await evaluate(client, `(() => {
    const menu = document.querySelector('[data-slot="context-menu-content"]');
    if (!menu) return null;
    const items = Array.from(menu.querySelectorAll('[data-slot="context-menu-item"]'));
    const separators = Array.from(menu.querySelectorAll('[data-slot="context-menu-separator"]'));
    const rectValue = (rect) => ({
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
    });
    const menuRect = menu.getBoundingClientRect();
    const rootStyle = getComputedStyle(menu.parentElement);
    const contentHeight = menuRect.height + parseFloat(rootStyle.paddingTop) + parseFloat(rootStyle.paddingBottom);
    const lastRect = items.at(-1)?.getBoundingClientRect();
    return {
      ariaLabel: menu.getAttribute('aria-label') ?? '',
      labels: items.map((item) => item.textContent?.trim() ?? ''),
      innerWidth,
      innerHeight,
      itemHeights: items.map((item) => item.getBoundingClientRect().height),
      separatorFootprints: separators.map((separator) => {
        const style = getComputedStyle(separator);
        return separator.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      }),
      menuRect: rectValue(menuRect),
      contentHeight,
      lastItemBottom: lastRect?.bottom ?? 0,
      scrollHeight: document.documentElement.scrollHeight,
    };
  })()`);
  return value === null ? null : parseMenuMetrics(value);
}

async function waitForMenu(client: CdpClient, ariaLabel: string, labels: string[]): Promise<MenuMetrics> {
  return waitUntil(`${ariaLabel} with ${labels.join(", ")}`, async () => {
    const metrics = await readMenuMetrics(client);
    return metrics?.ariaLabel === ariaLabel && JSON.stringify(metrics.labels) === JSON.stringify(labels) ? metrics : null;
  });
}

function assertMenuSizing(
  evidence: Tape,
  metrics: MenuMetrics,
  separatorCount: number,
): void {
  expect(metrics.innerWidth).toBe(196);
  expect(metrics.contentHeight).toBeLessThanOrEqual(metrics.innerHeight);
  expect(metrics.innerHeight - metrics.contentHeight).toBeLessThanOrEqual(1);
  expect(metrics.itemHeights).toHaveLength(metrics.labels.length);
  for (const height of metrics.itemHeights) {
    expect(height).toBeGreaterThanOrEqual(34);
    expect(height).toBeLessThanOrEqual(MENU_ITEM_HEIGHT);
  }
  expect(metrics.separatorFootprints).toHaveLength(separatorCount);
  for (const height of metrics.separatorFootprints) expect(height).toBeCloseTo(MENU_SEPARATOR_HEIGHT, 1);
  expect(metrics.menuRect.top).toBeGreaterThanOrEqual(0);
  expect(metrics.menuRect.bottom).toBeLessThanOrEqual(metrics.innerHeight);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight);
  const visibleTrailingGap = metrics.menuRect.bottom - metrics.lastItemBottom;
  const transparentBottomSpace = metrics.innerHeight - metrics.menuRect.bottom;
  expect(visibleTrailingGap).toBeGreaterThanOrEqual(0);
  expect(visibleTrailingGap).toBeLessThanOrEqual(10);
  evidence.fact(
    `${metrics.ariaLabel} overlay height matches its rendered content without clipping or a large dead gap`,
    JSON.stringify({ overlayHeight: metrics.innerHeight, contentHeight: metrics.contentHeight, metrics, visibleTrailingGap, transparentBottomSpace }),
    true,
  );
}

async function chooseMenuItem(client: CdpClient, label: string): Promise<void> {
  const point = await elementCenter(client, `[data-slot="context-menu-item"]`);
  const value = await evaluate(client, `(() => {
    const item = Array.from(document.querySelectorAll('[data-slot="context-menu-item"]'))
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!item) return null;
    const rect = item.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await dispatchMouse(client, value === null ? point : parsePoint(value, label), "left");
}

async function browserState(app: Surface): Promise<BrowserState> {
  return parseBrowserState(await evalIn(app, "window.__OPENWORK_ELECTRON__.browser.getState()", { awaitPromise: true }));
}

async function clipboardText(client: CdpClient): Promise<string> {
  const value = await evaluate(client, "navigator.clipboard.readText()", { awaitPromise: true });
  if (typeof value !== "string") throw new Error(`Clipboard read did not return text: ${JSON.stringify(value)}`);
  return value;
}

async function selectFixtureText(client: CdpClient): Promise<Point> {
  const value = await evaluate(client, `(() => {
    const element = document.getElementById('selectable');
    if (!element?.firstChild) return null;
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  return parsePoint(value, "selected fixture text");
}

async function clearSelection(client: CdpClient): Promise<void> {
  await evaluate(client, `getSelection()?.removeAllRanges()`);
}

test("built-in browser page menus and passkeys work in Electron with OS-level visual evidence", async ({ evidence }) => {
  needs({
    optIn: ["OPENWORK_EVAL_APP_SPECS"],
    daytona: true,
    env: ["OPENWORK_EVAL_CDP_URL", "OPENWORK_EVAL_DAYTONA_SANDBOX", "OPENAI_API_KEY"],
  });

  const sandbox = process.env.OPENWORK_EVAL_DAYTONA_SANDBOX?.trim();
  if (!sandbox) throw new Error("OPENWORK_EVAL_DAYTONA_SANDBOX was checked by needs() but is empty.");

  await startFixtureServer(sandbox);
  try {
    await using app = await desktop({ mode: "attach", name: "builtin-browser-context-menu-passkey" });
    const userAgent = await evalIn(app, "navigator.userAgent");
    expect(userAgent).toEqual(expect.stringContaining("Electron/35."));
    evidence.fact("The real app under test is Electron 35", String(userAgent), true);

    await createAndSelectWorkspace(app, { path: "/tmp/openwork-browser-context-menu-passkey" });
    await waitFor(
      app,
      `window.__openworkControl.listActions().some((action) => action.id === 'browser.open_url' && !action.disabled)`,
      { timeoutMs: 60_000, label: "browser.open_url action" },
    );
    await evalIn(app, "window.__OPENWORK_ELECTRON__.browser.closeAllTabs()", { awaitPromise: true });

    const opened = await control(app, "browser.open_url", { provider: "builtin", url: FIXTURE_URL });
    if (!isRecord(opened) || typeof opened.target_id !== "string" || typeof opened.tab_id !== "string") {
      throw new Error(`browser.open_url did not return target_id and tab_id: ${JSON.stringify(opened)}`);
    }
    const originalTabId = opened.tab_id;
    const pageTarget = await targetById(app.handle.cdpUrl, opened.target_id, { timeoutMs: 30_000 });
    const pageClient = await connect(debuggerUrlFor(app.handle.cdpUrl, pageTarget));
    await pageClient.send("Page.enable");

    let overlayClient: CdpClient | null = null;
    try {
      await waitUntil("fixture page load", async () => {
        const title = await evaluate(pageClient, "document.title");
        return title === "OpenWork Browser E2E Fixture" ? title : null;
      }, 30_000);

      const plainPoint = await elementCenter(pageClient, "#plain");
      await rightClick(pageClient, plainPoint);
      const overlayTarget = await findOverlayTarget(app.handle.cdpUrl);
      overlayClient = await connect(debuggerUrlFor(app.handle.cdpUrl, overlayTarget));
      await overlayClient.send("Page.enable");

      const plainMenu = await waitForMenu(overlayClient, "page context menu", PLAIN_LABELS);
      expect(plainMenu.labels).toEqual(PLAIN_LABELS);
      assertMenuSizing(evidence, plainMenu, 1);
      evidence.fact(
        "A real CDP right-click on plain page area opens Back / Forward / Reload / Copy Page URL / Open Page in Browser and is not instantly dismissed",
        JSON.stringify(plainMenu.labels),
        true,
      );
      await proveOsFrame(app, sandbox, [
        "The in-app browser visibly shows a five-item page context menu with Back, Forward, Reload, Copy Page URL, and Open Page in Browser",
        "The page context menu begins at the magenta click marker, is fully visible, and tightly fits its five rows without clipping or a large empty gap",
      ]);

      await chooseMenuItem(overlayClient, "Copy Page URL");
      const copiedUrl = await clipboardText(pageClient);
      expect(copiedUrl).toBe(FIXTURE_URL);
      evidence.fact("Choosing Copy Page URL writes the browsed page URL to the OS clipboard", copiedUrl, true);

      await rightClick(pageClient, plainPoint);
      await waitForMenu(overlayClient, "page context menu", PLAIN_LABELS);
      const outsidePoint = { x: 18, y: plainPoint.y };
      await dispatchMouse(pageClient, outsidePoint, "left");
      await new Promise((resolve) => setTimeout(resolve, 200));
      await proveOsFrame(app, sandbox, [
        "After a left-click on the browsed page, no page or tab context menu is visible anywhere in the OpenWork window",
      ]);

      await rightClick(pageClient, plainPoint);
      await waitForMenu(overlayClient, "page context menu", PLAIN_LABELS);
      await dispatchEscape(overlayClient);
      await showMarker(pageClient, { x: 30, y: 30 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      await proveOsFrame(app, sandbox, [
        "After pressing Escape, no page or tab context menu is visible anywhere in the OpenWork window",
      ]);

      const linkPoint = await elementCenter(pageClient, "#fixture-link");
      await rightClick(pageClient, linkPoint);
      const linkMenu = await waitForMenu(overlayClient, "page context menu", LINK_LABELS);
      expect(linkMenu.labels).toEqual(LINK_LABELS);
      assertMenuSizing(evidence, linkMenu, 0);
      evidence.fact("Right-clicking a link exposes the three link actions", JSON.stringify(linkMenu.labels), true);
      await proveOsFrame(app, sandbox, [
        "The in-app browser visibly shows Open Link in New Tab, Copy Link Address, and Open Link in Browser for the fixture link",
        "The link menu is positioned at the magenta click marker and all three rows are fully visible without excess empty space",
      ]);

      const beforeNewTab = await browserState(app);
      await chooseMenuItem(overlayClient, "Open Link in New Tab");
      const afterNewTab = await waitUntil("linked page in a new built-in browser tab", async () => {
        const state = await browserState(app);
        return state.tabs.length === beforeNewTab.tabs.length + 1 && state.tabs.some((tab) => tab.url === LINK_URL) ? state : null;
      });
      expect(afterNewTab.tabs).toHaveLength(beforeNewTab.tabs.length + 1);
      expect(afterNewTab.tabs.some((tab) => tab.url === LINK_URL)).toBe(true);
      evidence.fact(
        "Choosing Open Link in New Tab opens the link in one new in-panel tab",
        JSON.stringify({ before: beforeNewTab, after: afterNewTab }),
        true,
      );
      await evalIn(app, `window.__OPENWORK_ELECTRON__.browser.selectTab(${JSON.stringify(originalTabId)})`, { awaitPromise: true });

      const inputPoint = await elementCenter(pageClient, "#fixture-input");
      await dispatchMouse(pageClient, inputPoint, "left");
      await rightClick(pageClient, inputPoint);
      const inputMenu = await waitForMenu(overlayClient, "page context menu", INPUT_LABELS);
      expect(inputMenu.labels).toEqual(INPUT_LABELS);
      assertMenuSizing(evidence, inputMenu, 1);
      evidence.fact("Right-clicking an editable text input exposes Cut / Copy / Paste / Select All", JSON.stringify(inputMenu.labels), true);
      await proveOsFrame(app, sandbox, [
        "The in-app browser visibly shows Cut, Copy, Paste, and Select All for the text input",
        "The four-row input menu is fully visible at the magenta click marker and tightly sized without clipping",
      ]);

      await dispatchEscape(overlayClient);
      const selectedPoint = await selectFixtureText(pageClient);
      await rightClick(pageClient, selectedPoint);
      const selectedMenu = await waitForMenu(overlayClient, "page context menu", SELECTED_TEXT_LABELS);
      expect(selectedMenu.labels).toEqual(SELECTED_TEXT_LABELS);
      assertMenuSizing(evidence, selectedMenu, 0);
      evidence.fact("Right-clicking selected non-editable text exposes Copy", JSON.stringify(selectedMenu.labels), true);
      await proveOsFrame(app, sandbox, [
        "The selected sentence is visibly highlighted and its context menu contains the single Copy action",
        "The one-row Copy menu is fully visible at the magenta click marker with no extra blank height below the Copy row",
      ]);

      await dispatchEscape(overlayClient);
      await clearSelection(pageClient);
      const bottomRightPoint = await viewportPoint(pageClient, "bottom-right");
      await rightClick(pageClient, bottomRightPoint);
      const edgeMenu = await waitForMenu(overlayClient, "page context menu", PLAIN_LABELS);
      assertMenuSizing(evidence, edgeMenu, 1);
      evidence.fact(
        "A bottom-right page right-click keeps the complete five-item menu at its calculated item-count height",
        JSON.stringify({ point: bottomRightPoint, edgeMenu }),
        true,
      );
      await proveOsFrame(app, sandbox, [
        "Near the bottom-right browser edge, the complete five-item page context menu is shifted left and up so it remains fully on-screen and unclipped",
        "The magenta click marker is near the menu's bottom-right corner, showing the edge-clamped menu is aligned to the requested click rather than offset",
        "The edge menu tightly fits its five rows without a large empty area below Open Page in Browser",
      ]);

      await dispatchEscape(overlayClient);
      const tabPoint = parsePoint(await evalIn(app, `(() => {
        const button = document.getElementById(${JSON.stringify(originalTabId)})
          ?.querySelector('button[aria-label^="Select tab:"]');
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`), "browser tab strip");
      await dispatchMouse(app.client, tabPoint, "right");
      const tabMenu = await waitForMenu(overlayClient, "tab context menu", TAB_LABELS);
      expect(tabMenu.labels).toEqual(TAB_LABELS);
      assertMenuSizing(evidence, tabMenu, 1);
      evidence.fact("Right-clicking the browser tab strip preserves the original four-item tab menu", JSON.stringify(tabMenu.labels), true);
      await proveOsFrame(app, sandbox, [
        "The browser tab strip visibly shows its original four-item menu: Copy URL, Open in Browser, Close Tab, and Close All Tabs",
        "The tab context menu is fully visible beside the right-clicked tab and tightly fits its four rows",
      ]);

      await dispatchEscape(overlayClient);
      const passkeyPoint = await elementCenter(pageClient, "#passkey-button");
      await dispatchMouse(pageClient, passkeyPoint, "left");
      const passkey = await waitUntil("fast passkey rejection", async () => {
        const value = await evaluate(pageClient, "window.__passkeyResult ?? null");
        return value === null ? null : parsePasskeyResult(value);
      }, 2_000);
      expect(passkey.settled).toBe(true);
      expect(passkey.resolved).toBe(false);
      expect(passkey.elapsedMs).toBeLessThan(2_000);
      expect(passkey.name).toBe("NotAllowedError");
      expect(passkey.isDomException).toBe(true);
      expect(passkey.constructorName).toBe("DOMException");
      evidence.fact(
        "navigator.credentials.get({ publicKey }) settles under 2s with a real NotAllowedError DOMException",
        JSON.stringify(passkey),
        true,
      );
      const passkeyMenu = await waitForMenu(overlayClient, "Open this page to use a passkey", ["Open in your browser"]);
      expect(passkeyMenu.labels).toEqual(["Open in your browser"]);
      evidence.fact("The passkey fast-fail offers Open in your browser", JSON.stringify(passkeyMenu.labels), true);
      await proveOsFrame(app, sandbox, [
        "The in-app browser visibly offers Open in your browser after the fixture requests a passkey",
        "The passkey fallback explains that the built-in browser cannot use passkeys yet, and the overlay is fully visible and unclipped",
      ]);
    } finally {
      overlayClient?.close();
      pageClient.close();
    }
  } finally {
    await stopFixtureServer(sandbox);
  }
});
