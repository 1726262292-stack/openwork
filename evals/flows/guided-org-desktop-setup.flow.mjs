import { connect, debuggerUrlFor, listTargets } from "../runner/cdp.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "guided-org-desktop-setup";
const vo = await loadVoiceoverParagraphs(FLOW_ID);
const DEN_API_URL = clean(process.env.OPENWORK_EVAL_DEN_API_URL);
const DEN_WEB_URL = clean(process.env.OPENWORK_EVAL_DEN_WEB_URL);
const WEB_CDP_URL = clean(process.env.OPENWORK_EVAL_WEB_CDP_ADMIN);
const ADMIN_EMAIL = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";

const state = {
  desktopClient: null,
  installToken: "",
  installPageUrl: "",
  connectUrl: "",
  organizationName: "",
};

function clean(value) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({ type: "assertion", status: condition ? "passed" : "failed", assertion, actual });
  ctx.assert(condition, `${assertion}. Actual: ${JSON.stringify(actual)}`);
}

function rememberDesktop(ctx) {
  if (!state.desktopClient) state.desktopClient = ctx.client;
}

function useDesktop(ctx) {
  ctx.client = state.desktopClient;
}

async function firstPageTarget(cdpBaseUrl) {
  const existing = await listTargets(cdpBaseUrl);
  const page = existing.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (page) return page;
  const response = await fetch(`${cdpBaseUrl}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`Could not create Den browser target: ${response.status}`);
  return response.json();
}

async function withWeb(ctx, fn) {
  const previous = ctx.client;
  const target = await firstPageTarget(WEB_CDP_URL);
  const client = await connect(debuggerUrlFor(WEB_CDP_URL, target));
  ctx.client = client;
  try {
    return await fn();
  } finally {
    ctx.client = previous;
    client.close();
  }
}

async function navigate(ctx, path) {
  const url = new URL(path, DEN_WEB_URL).toString();
  await ctx.eval(`location.assign(${JSON.stringify(url)}); true`);
  await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 30_000, label: `load ${path}` });
}

async function clickExact(ctx, text, selector = "button, a") {
  await ctx.waitFor(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((entry) => (entry.textContent ?? '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)} && !entry.disabled);
    element?.scrollIntoView({ block: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs: 20_000, label: `click ${text}` });
}

async function signIn(ctx) {
  await navigate(ctx, "/");
  if (await ctx.eval("location.pathname.startsWith('/dashboard')")) return;
  if (await ctx.eval("!document.querySelector('input[type=email]') && document.body.innerText.includes('Sign in')")) {
    await clickExact(ctx, "Sign in");
  }
  await ctx.waitFor("Boolean(document.querySelector('input[type=email]'))", { timeoutMs: 30_000, label: "Den email input" });
  await ctx.fill('input[type="email"]', ADMIN_EMAIL);
  const hasNext = await ctx.eval("[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Next')");
  if (hasNext) await clickExact(ctx, "Next", "button");
  await ctx.waitFor("Boolean(document.querySelector('input[type=password]'))", { timeoutMs: 20_000, label: "Den password input" });
  await ctx.fill('input[type="password"]', ADMIN_PASSWORD);
  await clickExact(ctx, "Sign in", "button");
  await ctx.waitFor("location.pathname.startsWith('/dashboard')", { timeoutMs: 45_000, label: "Den dashboard" });
}

async function openGuideFromDashboard(ctx) {
  await signIn(ctx);
  await navigate(ctx, "/dashboard");
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=organization-download-button]'))", { timeoutMs: 30_000, label: "workspace download" });
  await clickExact(ctx, "Download for this workspace", "button");
  await ctx.waitFor("location.pathname === '/install'", { timeoutMs: 30_000, label: "install navigation" });
  const navigated = new URL(await ctx.eval("location.href"));
  state.installToken = navigated.searchParams.get("token") ?? "";
  state.installPageUrl = new URL(`/install?token=${encodeURIComponent(state.installToken)}`, DEN_WEB_URL).toString();
  await ctx.eval(`location.assign(${JSON.stringify(state.installPageUrl)}); true`);
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=install-guide]'))", { timeoutMs: 30_000, label: "guided installer" });
}

async function clickWithoutFollowing(ctx, selector) {
  await ctx.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.addEventListener('click', (event) => event.preventDefault(), { once: true });
    element.click();
    return true;
  })()`);
}

export default {
  id: FLOW_ID,
  title: "Den guides a standard OpenWork install into an organization with an explicit signed handoff",
  kind: "user-facing",
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_WEB_URL", "OPENWORK_EVAL_WEB_CDP_ADMIN"],
  steps: [
    {
      name: "Workspace download opens the guide",
      run: async (ctx) => {
        rememberDesktop(ctx);
        await withWeb(ctx, async () => ctx.prove("The organization download button opens a three-step Den guide", {
          voiceover: vo[0],
          action: async () => openGuideFromDashboard(ctx),
          assert: async () => {
            state.organizationName = await ctx.eval(`(() => {
              const heading = document.querySelector('[data-testid=install-card] h1')?.textContent?.trim() ?? '';
              return heading.includes(' for ') ? heading.split(' for ').at(-1) ?? '' : '';
            })()`);
            await ctx.expectText("Download and install");
            await ctx.expectText("Open OpenWork");
            await ctx.expectText("Sign in");
            witness(ctx, Boolean(state.installToken), "The guide came from a real organization install token", "token redacted");
          },
          screenshot: { name: "organization-download-guide", requireText: ["Download and install", "Open OpenWork", "Sign in"] },
        }));
      },
    },
    {
      name: "Installer is direct",
      run: async (ctx) => withWeb(ctx, async () => ctx.prove("Step one uses the normal release installer without a Den ZIP", {
        voiceover: vo[1],
        action: async () => {
          const href = await ctx.eval("document.querySelector('[data-testid=install-download-primary]')?.href ?? ''");
          const started = performance.now();
          const response = await fetch(href, { redirect: "manual" });
          const elapsedMs = Math.round(performance.now() - started);
          const location = response.headers.get("location") ?? "";
          witness(ctx, response.status === 302, "Den returns a redirect instead of streaming an artifact", { status: response.status, elapsedMs });
          witness(ctx, location.includes("github.com/different-ai/openwork/releases/download/"), "The redirect targets the configured normal release", location);
          witness(ctx, !location.includes(state.installToken), "The organization token is not forwarded to GitHub", location);
          ctx.output("direct installer route", JSON.stringify({ status: response.status, elapsedMs, location }, null, 2));
          await ctx.eval("document.body.focus()");
          for (let presses = 0; presses < 12; presses += 1) {
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
            if (await ctx.eval("document.activeElement?.getAttribute('data-testid') === 'install-download-primary'")) break;
          }
        },
        assert: async () => {
          await ctx.expectNoText("Preparing your");
          await ctx.expectNoText("ZIP");
          await ctx.expectText("When installation finishes, return to this page.");
        },
        screenshot: { name: "normal-installer-direct", requireText: ["Run the normal signed installer", "return to this page"], rejectText: ["Preparing your", "ZIP"] },
      })),
    },
    {
      name: "Den waits for the return",
      run: async (ctx) => withWeb(ctx, async () => ctx.prove("The same Den page keeps step one complete and makes step two explicit", {
        voiceover: vo[2],
        action: async () => {
          await clickWithoutFollowing(ctx, "[data-testid=install-download-primary]");
          await ctx.eval(`(() => {
            const step = document.querySelector('[data-testid=install-guide-step-open]');
            const button = document.querySelector('[data-testid=install-connect-open]');
            step?.scrollIntoView({ block: 'center' });
            button?.focus();
            return Boolean(step && button);
          })()`);
        },
        assert: async () => {
          witness(ctx, (await ctx.eval("new URL(location.href).searchParams.get('step')")) === "2", "The guide records step two in its own URL", await ctx.eval("location.href"));
          witness(ctx, (await ctx.eval("document.querySelector('[data-testid=install-guide-step-download]')?.dataset.state")) === "complete", "Download step is visibly complete", "complete");
          await ctx.expectText("confirm that you want to connect it to");
        },
        screenshot: { name: "return-to-den-step-two", requireText: ["Download again", "Open OpenWork", "Refresh an expired connection link"] },
      })),
    },
    {
      name: "Signed link previews the exact target",
      run: async (ctx) => {
        await withWeb(ctx, async () => {
          state.connectUrl = await ctx.eval("document.querySelector('[data-testid=install-connect-open]')?.href ?? ''");
          await clickWithoutFollowing(ctx, "[data-testid=install-connect-open]");
        });
        useDesktop(ctx);
        await ctx.prove("Open OpenWork shows the exact organization and server before changing anything", {
          voiceover: vo[3],
          action: async () => {
            await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 60_000, label: "desktop ready" });
            await ctx.eval(`window.dispatchEvent(new CustomEvent('openwork:deep-link', { detail: { urls: [${JSON.stringify(state.connectUrl)}] } })); true`);
          },
          assert: async () => {
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=connect-confirm-dialog]'))", { timeoutMs: 30_000, label: "connect confirmation" });
            witness(ctx, Boolean(state.organizationName), "The organization name was read from the real Den guide", state.organizationName);
            await ctx.expectText(state.organizationName);
            await ctx.expectText("localhost:8790");
          },
          screenshot: { name: "desktop-connect-confirmation", requireText: ["Set up", "Server", "localhost:8790", "Connect"] },
        });
      },
    },
    {
      name: "Confirm leads to normal sign-in",
      run: async (ctx) => {
        useDesktop(ctx);
        await ctx.prove("Confirming persists the organization and opens the normal sign-in gate", {
          voiceover: vo[4],
          action: async () => clickExact(ctx, "Connect", "button"),
          assert: async () => {
            await ctx.waitForText("Sign in to OpenWork", { timeoutMs: 45_000 });
            await ctx.expectText("Sign in to get started with your workspace.");
          },
          screenshot: { name: "organization-normal-signin", requireText: ["Welcome to OpenWork", "Sign in to OpenWork", "workspace"] },
        });
      },
    },
    {
      name: "Already-installed and error paths stay explicit",
      run: async (ctx) => withWeb(ctx, async () => ctx.prove("An installed user can skip download, refresh an expired handoff, and sees no public-download magic", {
        voiceover: vo[5],
        action: async () => {
          await ctx.eval(`location.assign(${JSON.stringify(state.installPageUrl)}); true`);
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=install-skip-download]'))", { timeoutMs: 30_000, label: "already installed action" });
          await clickExact(ctx, "I already have OpenWork", "button");
        },
        assert: async () => {
          await ctx.expectText("Refresh an expired connection link");
          const expired = await fetch(`${DEN_API_URL}/v1/install-config?token=expired-token`);
          witness(ctx, expired.status === 404, "An invalid or expired install token fails clearly", expired.status);
          witness(ctx, !(await ctx.eval("document.body.innerText.includes('OpenWork Enterprise')")), "The guide uses generic organization copy", "OpenWork Enterprise absent");
        },
        screenshot: { name: "already-installed-explicit-recovery", requireText: ["Download again", "Open OpenWork", "Refresh an expired connection link"], rejectText: ["OpenWork Enterprise"] },
      })),
    },
  ],
};
