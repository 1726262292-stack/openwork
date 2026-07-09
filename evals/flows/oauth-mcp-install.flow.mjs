/**
 * Member side of the marketplace lifecycle — the "other side" proof.
 *
 * Rashmi (org member, SECOND isolated app instance) views the plugin the owner
 * published in oauth-mcp-publish.flow.mjs:
 *   1. Signs in to OpenWork Cloud via desktop handoff on App B.
 *   2. Lands in her workspace with the local engine ready.
 *   3. Confirms the ServiceNow MCP test instance is running on :3979.
 *   4. Opens Settings → Connect and proves the org-shared "Laptop Refresh
 *      Policy" plugin and "BY IT Marketplace" are available through her own
 *      Den view, with the owner's OAuth client secret absent.
 *   5. Proves the shared ServiceNow MCP still requires Rashmi's own OAuth:
 *      the member-visible plugin data carries clientId/scope, never the
 *      owner's client secret.
 *
 * Current dev does not expose member self-serve in-app connect for this
 * cloud-runnable org plugin until an admin has provisioned the MCP connection
 * as member-usable. This flow therefore proves member availability and the
 * secret boundary honestly, rather than a full click-to-Ready path. The real
 * member-side ServiceNow OAuth engine path is covered by
 * apps/server/src/mcp.servicenow-spec.e2e.test.ts.
 *
 * Run AFTER oauth-mcp-publish (App A, CDP 9923). This flow targets App B
 * (CDP 9924): pnpm fraimz --flow oauth-mcp-install --cdp-url http://127.0.0.1:9924
 *
 * Required env:
 * - OPENWORK_EVAL_DEN_API_URL  local Den API (e.g. http://127.0.0.1:8790)
 * Prereqs: member rashmi@acme.test / OpenWorkDemo123! exists in the org.
 * The flow auto-starts scripts/servicenow-mcp-server.mjs on :3979 when needed.
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SHARED = {
  MEMBER_EMAIL: "rashmi@acme.test",
  PASSWORD: "OpenWorkDemo123!",
  MCP_NAME: "acme-servicenow",
  OAUTH_CLIENT_ID: "acme-desktop-client",
  OAUTH_CLIENT_SECRET: "acme-oauth-secret-98765",
  PLUGIN_NAME: "Laptop Refresh Policy",
  MARKETPLACE_NAME: "BY IT Marketplace",
};

const CLICK_ANY = "button, [role=button], a, div, article, li, label";
const DEN_WEB_PROXY = "http://localhost:3005/api/den";
const SERVICENOW_BASE = "http://127.0.0.1:3979";
const SERVICENOW_SCRIPT = fileURLToPath(new URL("../../scripts/servicenow-mcp-server.mjs", import.meta.url));

async function serviceNowHealth() {
  try {
    const response = await fetch(`${SERVICENOW_BASE}/health`, { signal: AbortSignal.timeout(1_500) });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = { status: response.status, message: text.slice(0, 200) }; }
    return response.ok ? payload : { ...payload, status: response.status };
  } catch {
    return null;
  }
}

async function ensureServiceNowUp(ctx) {
  const current = await serviceNowHealth();
  if (current?.product === "servicenow-mcp") {
    ctx.log(`ServiceNow MCP already healthy at ${SERVICENOW_BASE}`);
    return;
  }
  if (current) {
    throw new Error(`Port 3979 is serving a non-ServiceNow /health response: ${JSON.stringify(current).slice(0, 300)}`);
  }
  const child = spawn(process.execPath, [SERVICENOW_SCRIPT], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PORT: "3979", AUTO_APPROVE: "1" },
  });
  child.unref();
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const health = await serviceNowHealth();
    if (health?.product === "servicenow-mcp") {
      ctx.log(`ServiceNow MCP started at ${SERVICENOW_BASE}`);
      return;
    }
    if (health) {
      throw new Error(`Port 3979 became a non-ServiceNow service: ${JSON.stringify(health).slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("ServiceNow MCP server did not become healthy on :3979 within 10s.");
}

async function denFetch(ctx, path, init = {}) {
  const base = ctx.env.OPENWORK_EVAL_DEN_API_URL.trim().replace(/\/+$/, "");
  const origin = ctx.env.OPENWORK_EVAL_DEN_ORIGIN?.trim() || base.replace("127.0.0.1", "localhost");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", origin, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  return { ok: response.ok, status: response.status, payload };
}

const memberDenViewExpr = ({ includeResolved = false } = {}) => `(async () => {
  const denWebProxy = ${JSON.stringify(DEN_WEB_PROXY)};
  const token = localStorage.getItem("openwork.den.authToken");
  const orgId = localStorage.getItem("openwork.den.activeOrgId");
  if (!token || !orgId) {
    return { ok: false, error: "missing member Den token or active org", hasToken: Boolean(token), hasOrgId: Boolean(orgId) };
  }
  const headers = { authorization: "Bearer " + token, origin: "http://localhost:3005" };
  const read = async (path) => {
    try {
      const response = await fetch(denWebProxy + path, { headers });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
      return { ok: response.ok, status: response.status, path, payload, raw: text };
    } catch (error) {
      return { ok: false, status: 0, path, payload: null, raw: "", error: String(error) };
    }
  };
  const itemsFrom = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.plugins)) return payload.plugins;
    if (Array.isArray(payload?.marketplaces)) return payload.marketplaces;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  };
  const plugins = await read("/v1/orgs/" + encodeURIComponent(orgId) + "/plugins");
  const marketplaces = await read("/v1/orgs/" + encodeURIComponent(orgId) + "/marketplaces");
  const pluginText = plugins.raw || JSON.stringify(plugins.payload ?? null);
  const marketplaceText = marketplaces.raw || JSON.stringify(marketplaces.payload ?? null);
  const pluginItem = itemsFrom(plugins.payload).find((item) => JSON.stringify(item).includes(${JSON.stringify(SHARED.PLUGIN_NAME)}));
  const marketplaceItem = itemsFrom(marketplaces.payload).find((item) => JSON.stringify(item).includes(${JSON.stringify(SHARED.MARKETPLACE_NAME)}));
  const resolved = [];
  if (${JSON.stringify(includeResolved)}) {
    const ids = [marketplaceItem?.id, marketplaceItem?.pluginId, pluginItem?.id, pluginItem?.pluginId]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .map(String);
    for (const id of ids) {
      resolved.push(await read("/v1/marketplaces/" + encodeURIComponent(id) + "/resolved"));
      resolved.push(await read("/v1/plugins/" + encodeURIComponent(id) + "/resolved"));
    }
  }
  return {
    ok: plugins.ok && marketplaces.ok,
    orgId,
    plugins,
    marketplaces,
    pluginPresent: pluginText.includes(${JSON.stringify(SHARED.PLUGIN_NAME)}),
    marketplacePresent: marketplaceText.includes(${JSON.stringify(SHARED.MARKETPLACE_NAME)}),
    pluginHasSecret: pluginText.includes(${JSON.stringify(SHARED.OAUTH_CLIENT_SECRET)}),
    marketplaceHasSecret: marketplaceText.includes(${JSON.stringify(SHARED.OAUTH_CLIENT_SECRET)}),
    resolved,
  };
})()`;

async function memberDenView(ctx, options) {
  return ctx.eval(memberDenViewExpr(options), { awaitPromise: true });
}

function responseText(response) {
  return response?.raw || JSON.stringify(response?.payload ?? null);
}

// auth.status can transiently reject with "Already acting" when a previous
// poll is still in flight; retry briefly instead of failing the frame.
async function authStatus(ctx) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await ctx.control("auth.status");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return null;
}

// Drive through post-sign-in onboarding (org choice -> resources -> done)
// by clicking whichever affordance is on screen until we leave /onboarding.
async function handleOnboarding(ctx) {
  await ctx.waitFor(`(() => {
    const hash = window.location.hash;
    if (!hash.includes("/onboarding")) return true;
    const labels = ["Continue with organization", "Continue to workspace", "Continue", "Acme Robotics"];
    const nodes = [...document.querySelectorAll(${JSON.stringify(CLICK_ANY)})];
    for (const label of labels) {
      const matches = nodes.filter((el) => {
        const text = (el.innerText ?? "").trim();
        return label === "Continue" ? text === label : text.includes(label);
      }).filter((el) => !el.disabled);
      // Prefer real buttons, then the most specific (shortest-text) match.
      const node = matches.sort((a, b) =>
        (a.tagName === "BUTTON" ? 0 : 1) - (b.tagName === "BUTTON" ? 0 : 1) ||
        (a.innerText ?? "").length - (b.innerText ?? "").length)[0];
      if (node) { node.click(); return false; }
    }
    return false;
  })()`, { timeoutMs: 45_000, label: "onboarding completed" }).catch(() => {});
}

export default {
  id: "oauth-mcp-install",
  title: "Member sees the shared ServiceNow plugin; OAuth remains member-owned and secret-free",
  spec: "apps/server/src/extensions-export.ts",
  kind: "user-facing",
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL"],
  steps: [
    {
      name: "App B boots; member signs in via desktop handoff",
      run: async (ctx) => {
        await ctx.prove("Member (Rashmi) is signed in on her own app instance", {
          voiceover: "Rashmi is signed in on her own OpenWork desktop as an Acme Robotics member.",
          action: async () => {
            await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 90_000, label: "control API" });
            const status = await authStatus(ctx);
            if (status?.status !== "signed_in") {
              const signIn = await denFetch(ctx, "/api/auth/sign-in/email", {
                method: "POST",
                body: JSON.stringify({ email: SHARED.MEMBER_EMAIL, password: SHARED.PASSWORD }),
              });
              ctx.assert(signIn.ok && signIn.payload.token, `Member sign-in failed: ${signIn.status}`);
              const handoff = await denFetch(ctx, "/v1/auth/desktop-handoff", {
                method: "POST",
                headers: { authorization: `Bearer ${signIn.payload.token}` },
                body: "{}",
              });
              ctx.assert(handoff.ok && handoff.payload.grant, `Handoff failed: ${handoff.status}`);
              await ctx.control("auth.exchange-grant", { grant: handoff.payload.grant });
            }
            await ctx.waitFor(
              "window.__openworkControl.execute('auth.status').then(r => r.result?.status === 'signed_in').catch(() => false)",
              { timeoutMs: 20_000, label: "auth signed_in" },
            );
            await handleOnboarding(ctx);
            // Frame from a stable surface (re-runs may resume on settings).
            await ctx.navigateHash("/");
          },
          assert: async () => {
            const status = await authStatus(ctx);
            ctx.assert(status?.status === "signed_in", "Not signed in after handoff exchange.");
            ctx.assert(String(status?.user?.email ?? "").includes("rashmi@"), `Unexpected user: ${status?.user?.email}`);
          },
          screenshot: { name: "member-signed-in", rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Member has a workspace",
      run: async (ctx) => {
        const wsPath = join(homedir(), ".openwork", "two-electron-demo", "eval-workspace-b");
        await mkdir(wsPath, { recursive: true });
        const inWorkspace = await ctx.eval("location.hash.includes('/workspace/')");
        if (!inWorkspace) {
          await handleOnboarding(ctx);
          await ctx.waitFor("location.hash.includes('/welcome') || location.hash.includes('/workspace/')", { timeoutMs: 30_000 });
          if (await ctx.eval("location.hash.includes('/welcome')")) {
            await ctx.fill("input", wsPath);
            await ctx.clickText("Use this folder", { timeoutMs: 10_000 });
          }
        }
        await ctx.waitFor("location.hash.includes('/workspace/')", { timeoutMs: 45_000, label: "workspace route" });
        // Re-runs may land on a settings page; return to the session surface.
        await ctx.navigateHash("/");
        await ctx.waitFor(
          "document.body.innerText.includes('Run task') || document.body.innerText.includes('Describe your task') || document.body.innerText.includes('Ready for new tasks') || document.body.innerText.includes('Select or create a session')",
          { timeoutMs: 60_000, label: "engine ready" },
        );
      },
    },
    {
      name: "ServiceNow MCP instance is running",
      run: async (ctx) => {
        await ensureServiceNowUp(ctx);
      },
    },
    {
      name: "Member sees the org-shared ServiceNow plugin available to her",
      run: async (ctx) => {
        await ctx.prove("Rashmi's member Den view exposes the shared ServiceNow plugin without the owner's secret", {
          voiceover: "Rashmi opens Connect and sees that Acme's shared Laptop Refresh Policy, backed by the ServiceNow connector, is available to her. The owner's OAuth client secret never appears in her member view.",
          action: async () => {
            await ctx.control("settings.panel.open", { panel: "connect" });
            await ctx.waitFor("location.hash.includes('/settings/connect')", { timeoutMs: 15_000, label: "Connect settings route" });
            await ctx.control("extensions.refresh-marketplace").catch(() => {});
            await ctx.waitFor(`(async () => {
              const view = await ${memberDenViewExpr()};
              return Boolean(view.ok && view.pluginPresent && view.marketplacePresent && !view.pluginHasSecret && !view.marketplaceHasSecret);
            })()`, { timeoutMs: 60_000, label: "member org plugin and marketplace available via Den" });
          },
          assert: async () => {
            const view = await memberDenView(ctx);
            ctx.assert(view?.plugins?.status === 200, `Member org plugins API returned ${view?.plugins?.status}: ${responseText(view?.plugins).slice(0, 300)}`);
            ctx.assert(view?.marketplaces?.status === 200, `Member org marketplaces API returned ${view?.marketplaces?.status}: ${responseText(view?.marketplaces).slice(0, 300)}`);
            ctx.assert(view.pluginPresent, `${SHARED.PLUGIN_NAME} was not visible in Rashmi's org plugins payload.`);
            ctx.assert(view.marketplacePresent, `${SHARED.MARKETPLACE_NAME} was not visible in Rashmi's org marketplaces payload.`);
            ctx.assert(!responseText(view.plugins).includes(SHARED.OAUTH_CLIENT_SECRET), "Owner OAuth client secret leaked in member org plugins payload.");
            ctx.assert(!responseText(view.marketplaces).includes(SHARED.OAUTH_CLIENT_SECRET), "Owner OAuth client secret leaked in member org marketplaces payload.");
            await ctx.expectHashIncludes("/settings/connect");
            ctx.output("member-den-availability", JSON.stringify({
              orgId: view.orgId,
              pluginsStatus: view.plugins.status,
              marketplacesStatus: view.marketplaces.status,
              plugin: SHARED.PLUGIN_NAME,
              marketplace: SHARED.MARKETPLACE_NAME,
            }, null, 2));
          },
          screenshot: {
            name: "member-connect-panel",
            hashIncludes: "/settings/connect",
            rejectText: [SHARED.OAUTH_CLIENT_SECRET],
          },
        });
      },
    },
    {
      name: "The shared ServiceNow MCP requires the member's own OAuth (secret never traveled)",
      run: async (ctx) => {
        await ctx.prove("Member-visible ServiceNow MCP config has clientId and scope, never the owner's secret", {
          voiceover: "Using the shared ServiceNow connector still requires Rashmi's own ServiceNow sign-in. Her member-visible configuration carries the shared client ID and OAuth scope, but the owner's client secret never travels to her workspace.",
          action: async () => {
            await ctx.control("settings.panel.open", { panel: "connect" });
            await ctx.waitFor("location.hash.includes('/settings/connect')", { timeoutMs: 15_000, label: "Connect settings route" });
            await ctx.control("extensions.refresh-marketplace").catch(() => {});
            await ctx.waitFor(`(async () => {
              const view = await ${memberDenViewExpr({ includeResolved: true })};
              const textFrom = (entry) => entry?.raw || JSON.stringify(entry?.payload ?? null);
              const texts = [textFrom(view.plugins), textFrom(view.marketplaces), ...(view.resolved ?? []).map(textFrom)].join("\\n");
              return Boolean(
                view.ok &&
                texts.includes(${JSON.stringify(SHARED.MCP_NAME)}) &&
                texts.includes(${JSON.stringify(SHARED.OAUTH_CLIENT_ID)}) &&
                /"scopes?"\\s*:/.test(texts) &&
                !texts.includes(${JSON.stringify(SHARED.OAUTH_CLIENT_SECRET)})
              );
            })()`, { timeoutMs: 60_000, label: "member-visible OAuth config without owner secret" });
          },
          assert: async () => {
            const view = await memberDenView(ctx, { includeResolved: true });
            ctx.assert(view?.plugins?.status === 200, `Member org plugins API returned ${view?.plugins?.status}: ${responseText(view?.plugins).slice(0, 300)}`);
            ctx.assert(view?.marketplaces?.status === 200, `Member org marketplaces API returned ${view?.marketplaces?.status}: ${responseText(view?.marketplaces).slice(0, 300)}`);
            const resolved = view.resolved ?? [];
            const baseText = [responseText(view.plugins), responseText(view.marketplaces)].join("\n");
            const candidates = [
              ...resolved.filter((entry) => entry.ok).map((entry) => ({ label: entry.path, text: responseText(entry) })),
              { label: "org plugins + marketplaces fallback", text: baseText },
            ];
            const source = candidates.find((candidate) => candidate.text.includes(SHARED.MCP_NAME) && candidate.text.includes(SHARED.OAUTH_CLIENT_ID))
              ?? candidates.find((candidate) => candidate.text.includes(SHARED.OAUTH_CLIENT_ID))
              ?? candidates[candidates.length - 1];
            const allMemberVisibleText = [baseText, ...resolved.map(responseText)].join("\n");
            ctx.assert(!allMemberVisibleText.includes(SHARED.OAUTH_CLIENT_SECRET), "Owner OAuth client secret leaked in member-visible plugin or marketplace payload.");
            ctx.assert(source.text.includes(SHARED.MCP_NAME), `${SHARED.MCP_NAME} was not present in ${source.label}.`);
            ctx.assert(source.text.includes(SHARED.OAUTH_CLIENT_ID), `${SHARED.OAUTH_CLIENT_ID} was not present in ${source.label}.`);
            ctx.assert(/\"scopes?\"\s*:/.test(source.text), `OAuth scope was not present in ${source.label}.`);
            await ctx.expectHashIncludes("/settings/connect");
            ctx.output("member-den-secret-boundary", JSON.stringify({
              source: source.label,
              resolvedStatuses: resolved.map((entry) => ({ path: entry.path, status: entry.status })),
            }, null, 2));
          },
        });
      },
    },
  ],
};
