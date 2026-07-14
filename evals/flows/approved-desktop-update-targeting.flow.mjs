import { connect, debuggerUrlFor, listTargets } from "../runner/cdp.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "approved-desktop-update-targeting";
const vo = await loadVoiceoverParagraphs(FLOW_ID);
const DEN_WEB_URL = (process.env.OPENWORK_EVAL_DEN_WEB_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
const ADMIN_CDP_URL = (process.env.OPENWORK_EVAL_WEB_CDP_ADMIN ?? "").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function firstPageTarget(cdpBaseUrl) {
  const targets = await listTargets(cdpBaseUrl);
  const target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
  if (!target) throw new Error(`No page target available at ${cdpBaseUrl}`);
  return target;
}

async function withClient(ctx, cdpBaseUrl, callback) {
  const previous = ctx.client;
  const target = await firstPageTarget(cdpBaseUrl);
  const client = await connect(debuggerUrlFor(cdpBaseUrl, target));
  ctx.client = client;
  try {
    return await callback();
  } finally {
    ctx.client = previous;
    client.close();
  }
}

async function clickExact(ctx, text, selector = "button, a") {
  await ctx.waitFor(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((entry) => (entry.textContent ?? '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)} && !entry.disabled);
    element?.scrollIntoView({ block: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs: 30_000, label: `click ${text}` });
}

async function signInAndOpenOrgSettings(ctx) {
  await ctx.client.send("Network.clearBrowserCookies", {}).catch(() => undefined);
  await ctx.client.send("Network.clearBrowserCache", {}).catch(() => undefined);
  await ctx.client.send("Network.setCacheDisabled", { cacheDisabled: true }).catch(() => undefined);
  await ctx.client.send("Page.navigate", { url: DEN_WEB_URL });
  await ctx.waitFor("location.origin !== 'null' && document.readyState === 'complete'", { timeoutMs: 30_000, label: "Den sign-in page" });
  await ctx.eval("(() => { localStorage.clear(); sessionStorage.clear(); return true; })()");
  await ctx.client.send("Page.reload", { ignoreCache: true });
  await ctx.waitFor("Boolean(document.querySelector('input[type=\"email\"]'))", { timeoutMs: 45_000, label: "Den email sign-in" });
  await ctx.fill('input[type="email"]', ADMIN_EMAIL);
  await clickExact(ctx, "Next", "button");
  await ctx.waitFor("Boolean(document.querySelector('input[type=\"password\"]'))", { timeoutMs: 30_000, label: "Den password sign-in" });
  await ctx.fill('input[type="password"]', ADMIN_PASSWORD);
  await clickExact(ctx, "Sign in", "button");
  await ctx.waitFor("location.pathname.startsWith('/dashboard')", { timeoutMs: 45_000, label: "Den dashboard" });
  await ctx.eval(`location.assign(${JSON.stringify(`${DEN_WEB_URL}/dashboard/org-settings`)})`);
  await ctx.waitForText("Allowed Desktop Versions", { timeoutMs: 60_000 });
}

async function setChecked(ctx, version, checked) {
  await ctx.waitFor(`(() => {
    const input = document.querySelector(${JSON.stringify(`input[aria-label="Allow desktop version ${version}"]`)});
    if (!input) return false;
    input.scrollIntoView({ block: 'center' });
    if (input.checked !== ${checked}) input.click();
    return input.checked === ${checked};
  })()`, { timeoutMs: 30_000, label: `${version} checked=${checked}` });
}

async function configureDesktopEval(ctx, input) {
  await ctx.eval(`(() => {
    const metadata = {
      minAppVersion: '0.11.207',
      latestAppVersion: '0.17.24',
      publishedDesktopVersions: ['0.17.22', '0.17.23', '0.17.24'],
    };
    window.__approvedUpdateEval ??= { currentVersion: '0.17.22', checks: [], metadataReads: 0 };
    if (${input.reset === true}) {
      window.__approvedUpdateEval.checks = [];
      window.__approvedUpdateEval.metadataReads = 0;
    }
    window.__approvedUpdateEval.currentVersion = ${JSON.stringify(input.currentVersion)};
    window.__approvedUpdateEval.delayMs = ${input.delayMs ?? 0};
    const stale = window.__openworkApplyDesktopConfig;
    const fresh = window.__openworkSetDesktopConfigRefreshResult;
    if (typeof stale !== 'function' || typeof fresh !== 'function') throw new Error('Desktop policy eval bridge unavailable');
    stale(${JSON.stringify(input.staleConfig)});
    fresh(${JSON.stringify(input.freshConfig)});
    window.__openworkReadDesktopVersionMetadataEval = async () => {
      window.__approvedUpdateEval.metadataReads += 1;
      return metadata;
    };
    window.__openworkUpdaterEvalBridge = {
      getChannel: async () => ({ channel: 'stable', feedUrl: 'eval://stable', currentVersion: window.__approvedUpdateEval.currentVersion }),
      check: async (channel, targetVersion) => {
        window.__approvedUpdateEval.checks.push({ channel, targetVersion, currentVersion: window.__approvedUpdateEval.currentVersion });
        if (window.__approvedUpdateEval.delayMs) await new Promise((resolve) => setTimeout(resolve, window.__approvedUpdateEval.delayMs));
        return {
          available: Boolean(targetVersion),
          currentVersion: window.__approvedUpdateEval.currentVersion,
          latestVersion: targetVersion ?? null,
          channel: 'stable',
          feedUrl: targetVersion ? 'https://github.com/different-ai/openwork/releases/download/v' + targetVersion : 'eval://stable',
          releaseDate: '2026-07-13T18:43:13.427Z',
        };
      },
      download: async () => ({ ok: true }),
      installAndRestart: async () => ({ ok: true }),
    };
    return true;
  })()`);
}

async function ensureDesktopSession(ctx) {
  const apiUrl = ctx.env.OPENWORK_EVAL_DEN_API_URL.replace(/\/+$/, "");
  const token = ctx.env.OPENWORK_EVAL_DEN_TOKEN;
  const response = await fetch(`${apiUrl}/v1/me/orgs`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  const organizations = Array.isArray(body?.orgs) ? body.orgs : [];
  const activeOrg = organizations.find((organization) => organization?.id === body?.activeOrgId) ?? organizations[0];
  if (!activeOrg?.id) throw new Error("The fraimz Den token has no active organization");

  await ctx.control("eval.auth.set-base-url", { baseUrl: DEN_WEB_URL });
  await ctx.eval(`(() => {
    localStorage.setItem('openwork.den.baseUrl', ${JSON.stringify(DEN_WEB_URL)});
    localStorage.setItem('openwork.den.apiBaseUrl', ${JSON.stringify(apiUrl)});
    localStorage.setItem('openwork.den.authToken', ${JSON.stringify(token)});
    localStorage.setItem('openwork.den.activeOrgId', ${JSON.stringify(activeOrg.id)});
    localStorage.setItem('openwork.den.activeOrgSlug', ${JSON.stringify(activeOrg.slug ?? "acme-robotics-demo")});
    localStorage.setItem('openwork.den.activeOrgName', ${JSON.stringify(activeOrg.name ?? "Acme Robotics")});
    window.dispatchEvent(new CustomEvent('openwork-den-settings-changed', { detail: {} }));
    window.dispatchEvent(new CustomEvent('openwork-den-session-updated', { detail: { token: ${JSON.stringify(token)} } }));
    return true;
  })()`);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await ctx.control("auth.status", {}).catch(() => null);
    if (status?.status === "signed_in") return;
    await sleep(250);
  }
  throw new Error("Desktop did not retain the seeded Den session");
}

async function openDesktopUpdates(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl && window.__openworkApplyDesktopConfig && window.__openworkSetDesktopConfigRefreshResult)", {
    timeoutMs: 45_000,
    label: "desktop eval bridges",
  });
  await ensureDesktopSession(ctx);
  await ctx.navigateHash("/settings/updates");
  await ctx.waitForText("Check now", { timeoutMs: 30_000 });
  await ctx.eval(`(() => {
    const toggle = document.querySelector('[aria-label="Check automatically"]');
    if (toggle?.getAttribute('aria-checked') === 'true') toggle.click();
    return true;
  })()`);
  await ctx.waitFor("document.querySelector('[aria-label=\"Check automatically\"]')?.getAttribute('aria-checked') === 'false'", {
    timeoutMs: 5_000,
    label: "automatic checks disabled for deterministic manual-check proof",
  });
}

export default {
  id: FLOW_ID,
  title: "Manual desktop checks refresh Den policy and install the highest approved published release",
  kind: "user-facing",
  requiredEnv: ["OPENWORK_EVAL_WEB_CDP_ADMIN"],
  steps: [
    {
      name: "Frame 1 — Den exposes real published versions",
      run: async (ctx) => withClient(ctx, ADMIN_CDP_URL, async () => {
        await ctx.prove("Den shows the published 0.17.22–0.17.24 releases and saves 0.17.23 as the approved target", {
          voiceover: vo[0],
          action: async () => {
            await signInAndOpenOrgSettings(ctx);
            await setChecked(ctx, "0.17.22", false);
            await setChecked(ctx, "0.17.23", true);
            await setChecked(ctx, "0.17.24", false);
            await clickExact(ctx, "Save settings", "button");
          },
          assert: async () => {
            await sleep(500);
            const state = await ctx.eval(`(() => Object.fromEntries(['0.17.22', '0.17.23', '0.17.24'].map((version) => {
              const input = document.querySelector('input[aria-label="Allow desktop version ' + version + '"]');
              return [version, input?.checked ?? null];
            })))()`);
            ctx.assert(state["0.17.22"] === false && state["0.17.23"] === true && state["0.17.24"] === false, JSON.stringify(state));
            await ctx.eval(`document.querySelector('input[aria-label="Allow desktop version 0.17.23"]')?.closest('div.grid.gap-3')?.scrollIntoView({ block: 'center' })`);
          },
          screenshot: { name: "den-approved-01723", requireText: ["Allowed Desktop Versions", "0.17.22", "0.17.23", "0.17.24"] },
        });
      }),
    },
    {
      name: "Frame 2 — Manual check refreshes stale policy",
      run: async (ctx) => {
        await ctx.prove("Check now refreshes the cached organization policy and Den release inventory", {
          voiceover: vo[1],
          action: async () => {
            await openDesktopUpdates(ctx);
            await configureDesktopEval(ctx, {
              currentVersion: "0.17.22",
              staleConfig: { allowedDesktopVersions: ["0.17.22"] },
              freshConfig: { allowedDesktopVersions: ["0.17.23"] },
              delayMs: 1_500,
              reset: true,
            });
            await ctx.clickText("Check now");
          },
          assert: async () => {
            await ctx.waitFor("window.__approvedUpdateEval.metadataReads > 0", {
              timeoutMs: 5_000,
              label: "fresh Den release inventory request",
            });
            await ctx.expectText("Checking for updates…");
            const reads = await ctx.eval("window.__approvedUpdateEval.metadataReads");
            ctx.assert(reads > 0, `expected a fresh metadata request, got ${reads}`);
          },
          screenshot: { name: "desktop-checking-fresh-policy", requireText: ["Updates", "Checking for updates…"] },
        });
      },
    },
    {
      name: "Frame 3 — Highest approved release wins",
      run: async (ctx) => {
        await ctx.prove("A 0.17.22 desktop offers approved 0.17.23 instead of unapproved latest 0.17.24", {
          voiceover: vo[2],
          action: async () => {
            await ctx.waitForText("Update available: v0.17.23", { timeoutMs: 10_000 });
          },
          assert: async () => {
            const lastCheck = await ctx.eval("window.__approvedUpdateEval.checks.at(-1)");
            ctx.assert(lastCheck?.targetVersion === "0.17.23", JSON.stringify(lastCheck));
            await ctx.expectText("Download");
          },
          screenshot: { name: "desktop-offers-approved-01723", requireText: ["Update available: v0.17.23", "Download"], rejectText: ["v0.17.24"] },
        });
      },
    },
    {
      name: "Frame 4 — Newer release is visibly blocked",
      run: async (ctx) => {
        await ctx.prove("On 0.17.23, OpenWork explains that 0.17.24 exists but still needs organization approval", {
          voiceover: vo[3],
          action: async () => {
            await configureDesktopEval(ctx, {
              currentVersion: "0.17.23",
              staleConfig: { allowedDesktopVersions: ["0.17.23"] },
              freshConfig: { allowedDesktopVersions: ["0.17.23"] },
            });
            await ctx.clickText("Check now");
          },
          assert: async () => {
            await ctx.expectText("Update available: v0.17.24");
            await ctx.expectText("OpenWork 0.17.24 is available, but your organization has not approved it yet. Ask an organization administrator to enable this version.");
          },
          screenshot: { name: "desktop-01724-needs-admin", requireText: ["Update available: v0.17.24", "Ask an organization administrator"] },
        });
      },
    },
    {
      name: "Frame 5 — Next check sees new approval",
      run: async (ctx) => {
        await ctx.prove("The next manual check immediately offers 0.17.24 after the administrator approves it", {
          voiceover: vo[4],
          action: async () => {
            await configureDesktopEval(ctx, {
              currentVersion: "0.17.23",
              staleConfig: { allowedDesktopVersions: ["0.17.23"] },
              freshConfig: { allowedDesktopVersions: ["0.17.24"] },
            });
            await ctx.clickText("Check now");
          },
          assert: async () => {
            await ctx.expectText("Download");
            await ctx.expectText("Update available: v0.17.24");
            const lastCheck = await ctx.eval("window.__approvedUpdateEval.checks.at(-1)");
            ctx.assert(lastCheck?.targetVersion === "0.17.24", JSON.stringify(lastCheck));
          },
          screenshot: { name: "desktop-offers-newly-approved-01724", requireText: ["Update available: v0.17.24", "Download"], rejectText: ["has not approved"] },
        });
      },
    },
    {
      name: "Frame 6 — Unrestricted latest, never downgrade",
      run: async (ctx) => {
        await ctx.prove("Unrestricted organizations receive latest while an older approved version never triggers a downgrade", {
          voiceover: vo[5],
          action: async () => {
            await configureDesktopEval(ctx, {
              currentVersion: "0.17.22",
              staleConfig: {},
              freshConfig: {},
            });
            await ctx.clickText("Check now");
            await ctx.waitFor("(() => { const check = window.__approvedUpdateEval.checks.at(-1); return check?.currentVersion === '0.17.22' && check?.targetVersion === '0.17.24'; })()", {
              timeoutMs: 10_000,
              label: "unrestricted latest updater target",
            });
            const unrestrictedCheck = await ctx.eval("window.__approvedUpdateEval.checks.at(-1)");
            ctx.assert(unrestrictedCheck?.targetVersion === "0.17.24", JSON.stringify(unrestrictedCheck));

            await configureDesktopEval(ctx, {
              currentVersion: "0.17.25",
              staleConfig: { allowedDesktopVersions: ["0.17.24"] },
              freshConfig: { allowedDesktopVersions: ["0.17.24"] },
            });
            await ctx.clickText("Check now");
          },
          assert: async () => {
            await ctx.expectText("You're up to date");
            await sleep(250);
            const checks = await ctx.eval("window.__approvedUpdateEval.checks");
            ctx.assert(checks.some((entry) => entry.targetVersion === "0.17.24"), JSON.stringify(checks));
            ctx.assert(!checks.some((entry) => entry.currentVersion === "0.17.25"), `downgrade check reached updater: ${JSON.stringify(checks)}`);
          },
          screenshot: { name: "desktop-never-downgrades", requireText: ["You're up to date", "Check now"] },
        });
      },
    },
  ],
};
