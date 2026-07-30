import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { timed } from "@openwork/timeline";
import { control, evalIn, waitFor, waitForText } from "./desktop.ts";
import type { Surface } from "@openwork/cdp";

/**
 * The desktop signs in by opening the system browser and finishing there. To
 * observe that faithfully we capture what the app actually asks the OS to open
 * (via a PATH shim for xdg-open, which is what Electron's shell.openExternal
 * calls on Linux) rather than trusting that a browser appeared.
 *
 * Nothing here modifies the product: the app opens a URL exactly as it always
 * does; we just record where it pointed.
 */

export interface UrlCapture {
  /** Prepend to PATH when spawning the app. */
  binDir: string;
  /** Every URL the app asked the OS to open, oldest first. */
  opened(): Promise<string[]>;
  /** Wait for a URL matching a predicate, so a spec never races the handoff. */
  waitForUrl(match: (url: string) => boolean, opts?: { timeoutMs?: number }): Promise<string>;
}

export async function captureOpenedUrls(): Promise<UrlCapture> {
  const dir = await mkdtemp(join(tmpdir(), "openwork-open-external-"));
  const logPath = join(dir, "opened-urls.log");
  await writeFile(logPath, "", "utf8");
  const shim = join(dir, "xdg-open");
  await writeFile(shim, `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> ${JSON.stringify(logPath)}\nexit 0\n`, "utf8");
  await chmod(shim, 0o755);

  const opened = async (): Promise<string[]> => {
    const contents = await readFile(logPath, "utf8").catch(() => "");
    return contents.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  };

  return {
    binDir: dir,
    opened,
    async waitForUrl(match, { timeoutMs = 60_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let seen: string[] = [];
      while (Date.now() < deadline) {
        seen = await opened();
        const hit = seen.find((url) => match(url));
        if (hit) return hit;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`The app never asked to open a matching URL within ${timeoutMs}ms. Opened: ${seen.join(", ") || "<none>"}`);
    },
  };
}

/** Sign in on a real den web page in a real browser, the way a person does. */
export async function signInInBrowser(
  browser: Surface,
  url: string,
  credentials: { email: string; password: string },
): Promise<void> {
  await timed("browser.signIn", async () => {
    await evalIn(browser, `window.location.href = ${JSON.stringify(url)}`);
    await waitForText(browser, "Sign in", { timeoutMs: 120_000 });
    await waitFor(browser, `(() => {
      const email = document.querySelector('input[type="email"], input[name="email"]');
      const password = document.querySelector('input[type="password"], input[name="password"]');
      if (!email || !password) return false;
      const set = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set(email, ${JSON.stringify(credentials.email)});
      set(password, ${JSON.stringify(credentials.password)});
      return true;
    })()`, { timeoutMs: 60_000, label: "den sign-in form filled" });
    await waitFor(browser, `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => /sign in|continue|log in/i.test(candidate.textContent ?? "") && !candidate.disabled);
      button?.click();
      return Boolean(button);
    })()`, { timeoutMs: 60_000, label: "den sign-in submitted" });
  }, credentials.email);
}

/**
 * Complete the hop back into the desktop.
 *
 * A real OS dispatches `openwork://den-auth?grant=…` to the app. A container has
 * no protocol handler registered, so we hand the grant to the product's own
 * documented entry point for exactly this situation (`auth.exchange-grant`,
 * described in-product as signing in with a handoff grant). The grant itself is
 * the real one the app generated and the browser session approved — only the OS
 * dispatch is bridged, and that is stated wherever this is used.
 */
export async function completeDesktopHandoff(app: Surface, deepLinkOrGrantUrl: string, denBaseUrl: string): Promise<string> {
  const url = new URL(deepLinkOrGrantUrl);
  const grant = url.searchParams.get("grant") ?? "";
  if (!grant) throw new Error(`No grant in the handoff URL: ${deepLinkOrGrantUrl}`);
  await control(app, "auth.exchange-grant", { grant, baseUrl: denBaseUrl });
  return grant;
}
