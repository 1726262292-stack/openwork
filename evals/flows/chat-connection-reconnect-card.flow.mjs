import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "chat-connection-reconnect-card";
const vo = await loadVoiceoverParagraphs(FLOW_ID);
const DEN_API_URL = (process.env.OPENWORK_EVAL_DEN_API_URL ?? "").trim().replace(/\/+$/, "");
const DEN_WEB_URL = (process.env.OPENWORK_EVAL_DEN_WEB_URL ?? DEN_API_URL).trim().replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";
const WORKSPACE_PATH = "/tmp/openwork-chat-connection-reconnect-card";
const CONNECTION_NAME = "Granola";

const state = {
  adminToken: null,
  connectionId: null,
};

async function denApiFetch(path, options = {}) {
  const response = await fetch(`${DEN_API_URL}${path}`, {
    ...options,
    headers: { "content-type": "application/json", origin: DEN_WEB_URL, ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body, text };
}

async function prepareCloudConnection(ctx) {
  const signedIn = await denApiFetch("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  ctx.assert(signedIn.response.ok && typeof signedIn.body?.token === "string", `Demo sign-in failed: ${signedIn.response.status}`);
  state.adminToken = signedIn.body.token;

  const existing = await denApiFetch("/v1/mcp-connections?scope=manageable", {
    headers: { authorization: `Bearer ${state.adminToken}` },
  });
  ctx.assert(existing.response.ok, `Connection list failed: ${existing.response.status}`);
  for (const connection of existing.body?.connections ?? []) {
    if (connection.name !== CONNECTION_NAME || connection.url !== "https://eval-granola.example.test/mcp") continue;
    await denApiFetch(`/v1/mcp-connections/${connection.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${state.adminToken}` },
    });
  }

  const created = await denApiFetch("/v1/mcp-connections", {
    method: "POST",
    headers: { authorization: `Bearer ${state.adminToken}` },
    body: JSON.stringify({
      name: CONNECTION_NAME,
      url: "https://eval-granola.example.test/mcp",
      authType: "oauth",
      credentialMode: "per_member",
      access: { orgWide: true },
    }),
  });
  ctx.assert(created.response.ok, `Granola connection create failed: ${created.response.status} ${created.text.slice(0, 300)}`);
  state.connectionId = created.body?.id ?? created.body?.connection?.id ?? null;
  ctx.assert(Boolean(state.connectionId), "Granola connection response did not include an id.");
}

async function signDesktopIntoCloud(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl) && Boolean(window.__OPENWORK_ELECTRON__?.invokeDesktop)", {
    timeoutMs: 90_000,
    label: "Electron control and desktop bridge",
  });
  const bootstrap = { baseUrl: DEN_WEB_URL, apiBaseUrl: DEN_API_URL, requireSignin: false, handoff: null };
  const written = await ctx.eval(`(async () => {
    const bridge = window.__OPENWORK_ELECTRON__?.invokeDesktop;
    if (!bridge) return false;
    await bridge("setDesktopBootstrapConfig", ${JSON.stringify(bootstrap)});
    localStorage.setItem("openwork.den.baseUrl", ${JSON.stringify(DEN_WEB_URL)});
    localStorage.setItem("openwork.den.apiBaseUrl", ${JSON.stringify(DEN_API_URL)});
    localStorage.removeItem("openwork.den.authToken");
    localStorage.removeItem("openwork.den.activeOrgId");
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("openwork.den.desktopConfig:")) localStorage.removeItem(key);
    }
    return true;
  })()`, { awaitPromise: true });
  ctx.assert(written === true, "Failed to write Daytona Den bootstrap.");
  await ctx.eval("location.reload()");
  await ctx.waitFor(
    "window.__openworkControl?.listActions().some((action) => action.id === 'auth.exchange-grant')",
    { timeoutMs: 60_000, label: "desktop handoff control after Den bootstrap" },
  );

  const handoff = await denApiFetch("/v1/auth/desktop-handoff", {
    method: "POST",
    headers: { authorization: `Bearer ${state.adminToken}` },
    body: JSON.stringify({ desktopScheme: "openwork" }),
  });
  ctx.assert(handoff.response.ok, `Desktop handoff failed: ${handoff.response.status}`);
  await ctx.control("auth.exchange-grant", { grant: handoff.body.grant, baseUrl: DEN_WEB_URL });
  await ctx.waitFor("Boolean((localStorage.getItem('openwork.den.activeOrgId') ?? '').trim())", {
    timeoutMs: 60_000,
    label: "active cloud organization",
  });
}

async function ensureWorkspace(ctx) {
  await ctx.clickText("Continue with organization", { timeoutMs: 8_000 }).catch(() => {});
  await ctx.clickText("Continue to workspace", { timeoutMs: 10_000 }).catch(() => {});
  await ctx.waitFor(
    "window.location.hash.includes('/workspace/') || Boolean(document.querySelector('input[placeholder=\"/workspace/my-project\"]')) || document.body.innerText.includes('Skip and use the free model')",
    { timeoutMs: 30_000, label: "workspace, folder form, or model onboarding" },
  );
  const needsFolder = await ctx.eval("Boolean(document.querySelector('input[placeholder=\"/workspace/my-project\"]'))").catch(() => false);
  if (needsFolder) {
    await ctx.fill('input[placeholder="/workspace/my-project"]', WORKSPACE_PATH);
    await ctx.clickText("Use this folder", { timeoutMs: 15_000 });
  }
  await ctx.waitFor(
    "window.location.hash.includes('/workspace/') || document.body.innerText.includes('Skip and use the free model')",
    { timeoutMs: 60_000, label: "workspace route or model onboarding" },
  );
  await ctx.clickText("Skip and use the free model", { timeoutMs: 10_000 }).catch(() => {});
  await ctx.waitFor("window.location.hash.includes('/workspace/')", { timeoutMs: 60_000, label: "workspace route" });
  await ctx.eval(`(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Continue without OpenWork Models");
    button?.click();
    return true;
  })()`);
  await ctx.waitFor(
    "window.__openworkControl?.listActions().some((action) => action.id === 'eval.connection_status.seed')",
    { timeoutMs: 60_000, label: "connection-status eval fixture" },
  );
}

async function returnToChat(ctx) {
  await ctx.clickText("Back to app", { timeoutMs: 15_000 });
  await ctx.waitFor("window.location.hash.includes('/workspace/') && !window.location.hash.includes('/settings/')", {
    timeoutMs: 30_000,
    label: "chat route",
  });
  await ctx.waitFor(
    "window.__openworkControl?.listActions().some((action) => action.id === 'eval.connection_status.seed')",
    { timeoutMs: 30_000, label: "connection-status eval fixture after returning" },
  );
}

async function cleanup(ctx) {
  if (!state.adminToken || !state.connectionId) return;
  const removed = await denApiFetch(`/v1/mcp-connections/${state.connectionId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${state.adminToken}` },
  });
  ctx.assert(removed.response.ok, `Granola cleanup failed: ${removed.response.status}`);
}

export default {
  id: FLOW_ID,
  title: "A broken Cloud connector becomes an actionable, honest card in chat",
  kind: "user-facing",
  spec: "evals/voiceovers/chat-connection-reconnect-card.md",
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_WEB_URL"],
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("The user asks for meeting notes without needing to know the connector is broken", {
          voiceover: vo[0],
          action: async () => {
            await prepareCloudConnection(ctx);
            await signDesktopIntoCloud(ctx);
            await ensureWorkspace(ctx);
            await ctx.control("eval.connection_status.seed", { fixture: "prompt" });
            await ctx.waitForText("Pull my latest meeting notes from Granola.");
          },
          assert: async () => {
            await ctx.expectText("Pull my latest meeting notes from Granola.");
            await ctx.expectNoText("Granola needs you to sign in again");
          },
          screenshot: {
            name: "meeting-notes-request",
            requireText: ["Pull my latest meeting notes from Granola."],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("A member-actionable expired login renders as a plain-language reconnect card", {
          voiceover: vo[1],
          action: async () => {
            await ctx.control("eval.connection_status.seed", { fixture: "member" });
            await ctx.waitForText("Granola needs you to sign in again");
          },
          assert: async () => {
            await ctx.expectText("Granola needs you to sign in again");
            await ctx.expectText("Reconnect Granola");
            const cards = await ctx.eval("document.querySelectorAll('[data-testid=\"connection-status-card\"]').length");
            ctx.assert(cards === 1, `Expected one connection-status card, found ${cards}.`);
          },
          screenshot: {
            name: "member-reconnect-card",
            requireText: ["Granola needs you to sign in again", "Reconnect Granola"],
            rejectText: ["provider_admin", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("Reconnect lands on Connect with the matching organization connector highlighted", {
          voiceover: vo[2],
          action: async () => {
            await ctx.clickText("Reconnect Granola", { timeoutMs: 15_000 });
            await ctx.waitFor("window.location.hash.includes('/settings/connect')", { timeoutMs: 30_000, label: "Connect settings route" });
            await ctx.waitFor(`(() => {
              const row = document.querySelector('[data-testid="connect-organization-row"][data-connection-name="Granola"]');
              return row instanceof HTMLElement && row.classList.contains("ring-2");
            })()`, { timeoutMs: 60_000, label: "highlighted Granola row" });
          },
          assert: async () => {
            await ctx.expectHashIncludes("/settings/connect");
            const row = await ctx.eval(`(() => {
              const target = document.querySelector('[data-testid="connect-organization-row"][data-connection-name="Granola"]');
              return target ? { text: target.textContent, highlighted: target.classList.contains("ring-2") } : null;
            })()`);
            ctx.assert(row?.text?.includes("Granola"), `Granola row missing: ${JSON.stringify(row)}`);
            ctx.assert(row?.highlighted === true, `Granola row was not highlighted: ${JSON.stringify(row)}`);
          },
          screenshot: {
            name: "connect-row-highlighted",
            requireText: ["Connect", "Granola", "NEEDS YOUR SIGN-IN"],
            rejectText: ["Something went wrong"],
            hashIncludes: ["/settings/connect"],
          },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("A provider-owned failure names who must act and exposes a support reference", {
          voiceover: vo[3],
          action: async () => {
            await returnToChat(ctx);
            await ctx.control("eval.connection_status.seed", { fixture: "provider_admin" });
            await ctx.waitForText("Granola isn't working right now");
          },
          assert: async () => {
            await ctx.expectText("This needs a fix on the Granola provider side.");
            await ctx.expectText("a0b58150-7bad-4a37-ba36-c4260f444a8d");
            await ctx.expectText("Copy reference");
            await ctx.expectNoText("Reconnect Granola");
          },
          screenshot: {
            name: "provider-admin-card",
            requireText: ["Granola isn't working right now", "provider side", "Copy reference"],
            rejectText: ["Reconnect Granola", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        await ctx.prove("The complete technical payload remains available under a disclosure", {
          voiceover: vo[4],
          action: async () => {
            await ctx.clickText("Technical details", { timeoutMs: 15_000 });
            await ctx.waitForText("MCP_HTTP_400", { timeoutMs: 15_000 });
          },
          assert: async () => {
            await ctx.expectText("MCP_HTTP_400");
            await ctx.expectText("provider_admin");
            await ctx.expectText("a0b58150-7bad-4a37-ba36-c4260f444a8d");
          },
          screenshot: {
            name: "technical-details-disclosed",
            requireText: ["Technical details", "MCP_HTTP_400", "provider_admin"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Cleanup",
      run: cleanup,
    },
  ],
};
