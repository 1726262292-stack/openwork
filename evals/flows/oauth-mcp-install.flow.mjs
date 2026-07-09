/**
 * Member side of the marketplace lifecycle — the "other side" proof.
 *
 * Rashmi (org member, SECOND isolated app instance) installs the plugin the
 * owner published in oauth-mcp-publish.flow.mjs:
 *   1. Signs in to OpenWork Cloud via desktop handoff on App B.
 *   2. Finds "Laptop Refresh Policy" in the Extension Marketplace and
 *      installs it through the real UI (card -> Add).
 *   3. Witnesses the full unit of value arriving: the skill file is
 *      installed AND the OAuth MCP is registered — showing a genuine
 *      "Sign in needed" state because she must authenticate as herself.
 *   4. Proves the owner's client secret never traveled: her workspace's MCP
 *      config has clientId/scope but no secret anywhere.
 *   5. Completes the real ServiceNow OAuth sign-in and proves the MCP reaches
 *      Ready using scripts/servicenow-mcp-server.mjs on :3979.
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
  SKILL_NAME: "laptop-refresh-policy",
  MCP_NAME: "acme-servicenow",
  OAUTH_CLIENT_ID: "acme-desktop-client",
  OAUTH_CLIENT_SECRET: "acme-oauth-secret-98765",
  PLUGIN_NAME: "Laptop Refresh Policy",
};

const CLICK_ANY = "button, [role=button], a, div, article, li, label";
const SERVICENOW_BASE = "http://127.0.0.1:3979";
const SERVICENOW_MCP_PATH = "/sncapps/mcp-server/mcp/sn_openwork_it";
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

async function serviceNowRequests() {
  const response = await fetch(`${SERVICENOW_BASE}/requests`, { signal: AbortSignal.timeout(2_000) });
  const payload = await response.json();
  return payload.requests ?? [];
}

const CARD_STATUS_EXPR = `(() => {
  const leaves = [...document.querySelectorAll("*")].filter(
    (e) => e.children.length === 0 && (e.textContent ?? "").trim() === ${JSON.stringify(SHARED.MCP_NAME)},
  );
  const labels = ["Ready", "Sign in needed", "Issue", "Offline", "Paused"];
  for (const leaf of leaves) {
    let node = leaf;
    for (let i = 0; i < 8 && node; i += 1) {
      const text = node.textContent ?? "";
      for (const label of labels) {
        if (text.includes(label)) return label;
      }
      node = node.parentElement;
    }
  }
  return null;
})()`;

async function cardStatus(ctx) {
  return ctx.eval(CARD_STATUS_EXPR);
}

async function scrollCardIntoView(ctx) {
  await ctx.eval(`(() => {
    const leaf = [...document.querySelectorAll("*")].find(
      (e) => e.children.length === 0 && (e.textContent ?? "").trim() === ${JSON.stringify(SHARED.MCP_NAME)},
    );
    if (leaf) leaf.scrollIntoView({ block: "center" });
    return Boolean(leaf);
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function refreshStatuses(ctx) {
  await ctx.eval(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Refresh");
    if (btn) btn.click();
    return Boolean(btn);
  })()`);
}

async function waitForCardStatus(ctx, accepted, { timeoutMs, refreshEveryMs = 10_000 } = {}) {
  const startedAt = Date.now();
  let lastRefresh = 0;
  let status = null;
  while (Date.now() - startedAt < (timeoutMs ?? 60_000)) {
    if (Date.now() - lastRefresh >= refreshEveryMs) {
      lastRefresh = Date.now();
      await refreshStatuses(ctx);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    status = await cardStatus(ctx);
    if (accepted.includes(status)) return status;
  }
  throw new Error(`Timed out waiting for ${SHARED.MCP_NAME} status in [${accepted.join(", ")}]; last: ${status}`);
}

let serviceNowClickAt = null;

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

const serverCallExpr = (pathTemplate) => `(async () => {
  const port = localStorage.getItem("openwork.server.port");
  const token = localStorage.getItem("openwork.server.token");
  if (!port || !token) return { ok: false, error: "no server port/token in localStorage" };
  const base = "http://127.0.0.1:" + port;
  const headers = { Authorization: "Bearer " + token };
  const wsResponse = await fetch(base + "/workspaces", { headers });
  if (!wsResponse.ok) return { ok: false, error: "workspaces " + wsResponse.status };
  const wsPayload = await wsResponse.json();
  const workspaces = Array.isArray(wsPayload) ? wsPayload : wsPayload.items ?? [];
  const fromHash = (window.location.hash.match(/workspace\\/(ws_[a-z0-9]+)/) ?? [])[1];
  const active = localStorage.getItem("openwork.react.activeWorkspace");
  const workspace = workspaces.find((entry) => entry.id === (fromHash || active)) ?? workspaces[0];
  if (!workspace) return { ok: false, error: "no workspace" };
  const response = await fetch(base + ${JSON.stringify(pathTemplate)}.replace(":id", workspace.id), { headers });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  return { ok: response.ok, status: response.status, workspaceId: workspace.id, payload, raw: text };
})()`;

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
  title: "Member installs the plugin; OAuth MCP arrives sign-in-required, secret never travels",
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
      name: "Member installs the plugin from the Extension Marketplace UI",
      run: async (ctx) => {
        await ctx.prove("Plugin installs through the real marketplace UI", {
          voiceover: "Rashmi finds Laptop Refresh Policy in the marketplace and adds it to her workspace. The plugin card confirms the shared extension is available.",
          action: async () => {
            await ctx.control("settings.panel.open", { panel: "cloud-marketplaces" });
            await ctx.waitFor("location.hash.includes('/settings/cloud-marketplaces')", { timeoutMs: 15_000 });
            await ctx.control("extensions.refresh-marketplace").catch(() => {});
            await ctx.waitForText(SHARED.PLUGIN_NAME, { timeoutMs: 60_000 });
            await ctx.screenshot("marketplace-shows-plugin", {
              claim: "Member sees the published plugin in the marketplace.",
              requireText: [SHARED.PLUGIN_NAME],
              rejectText: [SHARED.OAUTH_CLIENT_SECRET],
            });
            // The whole card is a button: click it to open the detail
            // dialog, then confirm with the dialog's Add button.
            await ctx.eval(`(() => {
              const leaf = [...document.querySelectorAll("*")]
                .find((node) => node.children.length === 0 && (node.textContent ?? "").trim() === ${JSON.stringify(SHARED.PLUGIN_NAME)});
              if (!leaf) return false;
              let card = leaf;
              for (let i = 0; i < 8 && card; i += 1) {
                if (card.tagName === "BUTTON") break;
                card = card.parentElement;
              }
              if (!card) return false;
              card.click();
              return true;
            })()`);
            await ctx.waitFor("Boolean(document.querySelector('[role=dialog]'))", { timeoutMs: 15_000, label: "plugin detail dialog" });
            const clicked = await ctx.eval(`(() => {
              const dialog = document.querySelector("[role=dialog]");
              const add = [...dialog.querySelectorAll("button")].find((b) => (b.innerText ?? "").trim() === "Add");
              if (add && !add.disabled) { add.click(); return "add"; }
              return "already-installed";
            })()`);
            ctx.log(`dialog action: ${clicked}`);
          },
          assert: async () => {
            // Witness the real side effect: skill file + MCP land in the
            // member's workspace (polled via the OpenWork server API).
            await ctx.waitFor(`(async () => {
              const port = localStorage.getItem("openwork.server.port");
              const token = localStorage.getItem("openwork.server.token");
              if (!port || !token) return false;
              const base = "http://127.0.0.1:" + port;
              const headers = { Authorization: "Bearer " + token };
              const wsResponse = await fetch(base + "/workspaces", { headers });
              if (!wsResponse.ok) return false;
              const workspaces = (await wsResponse.json()).items ?? [];
              const workspace = workspaces[0];
              if (!workspace) return false;
              const skills = await (await fetch(base + "/workspace/" + workspace.id + "/skills", { headers })).json();
              const mcp = await (await fetch(base + "/workspace/" + workspace.id + "/mcp", { headers })).json();
              const hasSkill = (skills.items ?? []).some((item) => item.name === ${JSON.stringify(SHARED.SKILL_NAME)});
              const hasMcp = (mcp.items ?? []).some((item) => item.name === ${JSON.stringify(SHARED.MCP_NAME)});
              return hasSkill && hasMcp;
            })()`, { timeoutMs: 60_000, label: "skill + MCP installed in workspace" });
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: { name: "plugin-installed", requireText: [SHARED.PLUGIN_NAME] },
        });
      },
    },
    {
      name: "Skill and OAuth MCP arrive; MCP requires the member's own sign-in",
      run: async (ctx) => {
        await ctx.prove("Installed MCP shows a genuine Sign in needed state", {
          voiceover: "The ServiceNow connector appears with a genuine Sign in needed badge. Rashmi has to authenticate as herself, and the owner's secret never traveled.",
          action: async () => {
            await ctx.navigateHash("/settings/extensions/mcp");
            await ctx.waitForText("Add Custom App", { timeoutMs: 30_000 });
          },
          assert: async () => {
            await ctx.waitForText(SHARED.MCP_NAME, { timeoutMs: 45_000 });
            await ctx.waitFor(`(() => {
              const el = [...document.querySelectorAll("*")]
                .find((node) => node.children.length === 0 && (node.textContent ?? "").includes(${JSON.stringify(SHARED.MCP_NAME)}));
              if (!el) return false;
              el.scrollIntoView({ block: "center" });
              return document.body.innerText.includes("Sign in needed");
            })()`, { timeoutMs: 90_000, label: "Sign in needed status" });
            await ctx.expectNoText(SHARED.OAUTH_CLIENT_SECRET);
          },
          screenshot: {
            name: "installed-mcp-needs-signin",
            requireText: [SHARED.MCP_NAME, "Sign in needed"],
            rejectText: [SHARED.OAUTH_CLIENT_SECRET],
          },
        });
      },
    },
    {
      name: "The owner's client secret never traveled",
      run: async (ctx) => {
        await ctx.prove("Member workspace has clientId/scope but no secret anywhere", {
          voiceover: "Rashmi's workspace shows the skill and ServiceNow connector with the shared client ID, but no owner secret is present.",
          action: async () => {},
          assert: async () => {
            const skills = await ctx.eval(serverCallExpr("/workspace/:id/skills"), { awaitPromise: true });
            ctx.assert(skills?.ok, `List skills failed: ${skills?.status}`);
            const names = (skills.payload.items ?? []).map((item) => item.name);
            ctx.assert(names.includes(SHARED.SKILL_NAME), `Skill not installed. Got: ${names.join(", ")}`);

            const mcp = await ctx.eval(serverCallExpr("/workspace/:id/mcp"), { awaitPromise: true });
            ctx.assert(mcp?.ok, `List MCP failed: ${mcp?.status}`);
            ctx.assert(!mcp.raw.includes(SHARED.OAUTH_CLIENT_SECRET), "SECRET FOUND in member MCP config.");
            const item = (mcp.payload.items ?? []).find((entry) => entry.name === SHARED.MCP_NAME);
            ctx.assert(Boolean(item), "Installed MCP not found in member workspace.");
            ctx.assert(item.config?.oauth?.clientId === SHARED.OAUTH_CLIENT_ID, "clientId missing on installed MCP.");
            ctx.assert(item.config?.oauth?.clientSecret === undefined, "clientSecret key present on installed MCP.");
            ctx.log(`member MCP oauth keys: ${JSON.stringify(Object.keys(item.config?.oauth ?? {}))}`);
          },
        });
      },
    },
    {
      name: "Member completes ServiceNow OAuth sign-in and the MCP is Ready",
      run: async (ctx) => {
        await ctx.prove("Member connects the installed ServiceNow MCP with her own OAuth sign-in", {
          voiceover: "Rashmi opens the ServiceNow connector, clicks Sign in, and approves access in the browser. Back in OpenWork, the connector flips to Ready.",
          action: async () => {
            await ensureServiceNowUp(ctx);
            await ctx.navigateHash("/settings/extensions/mcp");
            await ctx.waitForText("Add Custom App", { timeoutMs: 30_000 });
            await waitForCardStatus(ctx, ["Ready", "Sign in needed", "Issue", "Offline"], { timeoutMs: 45_000 });
            const clickedAt = new Date().toISOString();
            await ctx.clickText(SHARED.MCP_NAME, { selector: "button", timeoutMs: 15_000 });
            await ctx.clickText("Sign in", { timeoutMs: 20_000 });
            await waitForCardStatus(ctx, ["Ready"], { timeoutMs: 90_000 });
            await scrollCardIntoView(ctx);
            serviceNowClickAt = clickedAt;
          },
          assert: async () => {
            ctx.assert((await cardStatus(ctx)) === "Ready", "ServiceNow MCP card should show Ready after sign-in.");
            const since = new Date(serviceNowClickAt ?? 0).getTime();
            const recent = (await serviceNowRequests()).filter((entry) => new Date(entry.at).getTime() >= since);
            const labels = recent.map((entry) => `${entry.method} ${entry.path}${entry.jsonrpcMethod ? ` ${entry.jsonrpcMethod}` : ""}`);
            ctx.recordEvidence({
              type: "assertion",
              status: labels.includes("GET /oauth_auth.do") && labels.includes("POST /oauth_token.do") && labels.some((label) => label === `POST ${SERVICENOW_MCP_PATH} tools/list`) ? "passed" : "failed",
              assertion: `ServiceNow saw OAuth + tools/list after member sign-in: ${labels.join(", ")}`,
            });
            ctx.assert(labels.includes("GET /oauth_auth.do"), "ServiceNow did not see GET /oauth_auth.do after Sign in.");
            ctx.assert(labels.includes("POST /oauth_token.do"), "ServiceNow did not see POST /oauth_token.do after Sign in.");
            ctx.assert(labels.some((label) => label === `POST ${SERVICENOW_MCP_PATH} tools/list`), "ServiceNow did not see authenticated MCP tools/list after Sign in.");
            await ctx.expectNoText(SHARED.OAUTH_CLIENT_SECRET);
            await scrollCardIntoView(ctx);
          },
          screenshot: {
            name: "member-connected-ready",
            requireText: [SHARED.MCP_NAME, "Ready"],
            rejectText: [SHARED.OAUTH_CLIENT_SECRET],
          },
        });
      },
    },
  ],
};
