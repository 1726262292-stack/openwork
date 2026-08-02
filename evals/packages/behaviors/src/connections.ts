import { evalIn, go, waitFor } from "./desktop.ts";
import type { Surface } from "@openwork/cdp";

export async function waitForConnectionCard(app: Surface, name: string, workspaceId: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    // Short per-probe timeout, failure tolerated: two desktops in one sandbox
    // make the renderer freeze in bursts, and a bare 20s evaluate turns one
    // freeze into a failed spec.
    const found = await evalIn(app, `([...document.querySelectorAll('button')]
      .some((button) => (button.textContent ?? '').includes(${JSON.stringify(name)})))`, { timeoutMs: 8_000 })
      .catch(() => false);
    if (found === true) return;
    // The app opens a freshly created session on its own, which navigates away
    // from settings mid-poll. Steer back, the way a person would click back.
    // The app CANONICALISES this route: /settings/extensions/connections
    // becomes /extensions/connections. Checking for the pre-rewrite form made
    // the steer-back below fire every iteration, so navigation fought the
    // rewrite and the surface never settled — which looked like a blank page.
    const onExtensions = await evalIn(app, `window.location.hash.includes("/extensions")`, { timeoutMs: 8_000 }).catch(() => false);
    if (onExtensions !== true) {
      await go(app, `/workspace/${workspaceId}/settings/extensions/connections`);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      continue;
    }
    await evalIn(app, "window.__openworkControl.execute('extensions.refresh-marketplace', null)", { awaitPromise: true, timeoutMs: 15_000 })
      .catch(() => undefined);
    await evalIn(app, `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((element) => (element.textContent ?? '').trim() === 'Refresh' && !element.disabled);
      button?.click();
      return Boolean(button);
    })()`).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  // Say what WAS on screen: "card missing" alone cannot distinguish an
  // unmounted surface from a connection den never offered this member.
  const seen = await evalIn(app, `({
    hash: window.location.hash,
    buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 40),
    text: (document.body.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 600),
  })`).catch(() => null);
  throw new Error(`The connection card ${name} never appeared. On screen: ${JSON.stringify(seen)}`);
}

/**
 * Wait for text to be REALLY on screen, then bring it into view.
 *
 * waitForText proves the DOM contains it; a frame proves pixels. The detail
 * panel paints slightly after its text lands, so screenshotting on the DOM
 * signal alone captures a blank panel intermittently.
 */
export async function revealText(app: Surface, text: string, timeoutMs = 45_000): Promise<void> {
  await waitFor(app, `(() => {
    // innerText, not textContent: innerText is render-aware, so CSS
    // text-transform (a badge styled uppercase) matches what waitForText saw
    // and what a person reads. Comparing raw textContent can never agree.
    const wanted = ${JSON.stringify(text)}.toLowerCase();
    const nodes = [...document.querySelectorAll("button, h1, h2, h3, p, span, div")];
    const node = nodes.reverse().find((element) => ((element.innerText ?? element.textContent ?? "")).toLowerCase().includes(wanted));
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    node.scrollIntoView({ block: "center" });
    return true;
  })()`, { timeoutMs, label: `visible text ${JSON.stringify(text)}` });
  // One paint after scrolling, so the frame is not captured mid-scroll.
  await new Promise((resolve) => setTimeout(resolve, 750));
}

/** The connections surface, settled — polling before it mounts finds nothing. */
export async function openConnectionsSurface(app: Surface, workspaceId: string): Promise<void> {
  await go(app, `/workspace/${workspaceId}/settings/extensions/connections`);
  await waitFor(app, `window.location.hash.includes("/extensions") && document.body.innerText.includes("Extensions")`, {
    timeoutMs: 60_000,
    label: "extensions connections route (app canonicalises away /settings)",
  });
}
