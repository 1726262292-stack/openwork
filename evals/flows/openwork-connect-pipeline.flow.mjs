import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { denApiFetch, denWebUrl, mcpAgentCall, mintMcpToken, openAdminConnections, signInViaBrowser } from "./lib/den-web.mjs";

const FLOW_ID = "openwork-connect-pipeline";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const ADMIN_EMAIL = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";
const RUN_TAG = Date.now().toString(36);
const CONNECTION_PREFIX = "Connect Pipeline Acme Parts";
const CONNECTION_NAME = `${CONNECTION_PREFIX} ${RUN_TAG}`;
const LOOKUP_TOOL = "acme_lookup_part";
const RUNTIME_TOOL = "acme_runtime_calibration";
const LOOKUP_MARKER = `ACME_LOOKUP_ECHO_${RUN_TAG}`;
const WORKSPACE_PATH = join(tmpdir(), `openwork-connect-pipeline-${RUN_TAG}`);
const CLOUD_MCP_NAME = "openwork-cloud";
const USER_STATE_KEY = "openwork.den.mcp.cloudControlUserState";

const state = {
  adminSession: "",
  memberSession: "",
  adminMcpToken: "",
  memberMcpToken: "",
  orgId: "",
  connectionId: "",
  workspaceId: "",
  mockServer: null,
  mockPort: 0,
  mockPublicUrl: "",
  mockRequests: [],
  tools: [],
  denTabOpened: false,
  liveToolAddedAt: "",
  chatStartedAt: "",
  cloudAuthorizationBeforeSignOut: "",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function normalizeMcpUrl(value) {
  const url = new URL(value.trim());
  url.hash = "";
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/mcp") ? pathname : `${pathname}/mcp`;
  return url.toString();
}

function denApiBase(ctx) {
  return cleanBaseUrl(ctx.env.OPENWORK_EVAL_DEN_API_URL);
}

function authHeaders(extra = {}) {
  return {
    authorization: `Bearer ${state.adminSession}`,
    ...(state.orgId ? { "x-openwork-org-id": state.orgId, "x-openwork-legacy-org-id": state.orgId } : {}),
    ...extra,
  };
}

async function adminFetch(ctx, path, options = {}, expectedStatuses = [200]) {
  const { response, body } = await denApiFetch(path, {
    ...options,
    headers: authHeaders(options.headers ?? {}),
  });
  ctx.assert(
    expectedStatuses.includes(response.status),
    `${options.method || "GET"} ${path} failed: ${response.status} ${JSON.stringify(body).slice(0, 600)}`,
  );
  return { response, body };
}

function json(response, status, body) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function lookupToolDefinition() {
  return {
    name: LOOKUP_TOOL,
    title: "Acme lookup part",
    description: "Look up Acme part availability and draft-ready supplier details for the Connect pipeline proof.",
    inputSchema: {
      type: "object",
      properties: {
        partNumber: { type: "string", description: "The Acme part number to look up." },
      },
      required: ["partNumber"],
      additionalProperties: true,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

function runtimeToolDefinition() {
  return {
    name: RUNTIME_TOOL,
    title: "Acme runtime calibration",
    description: "Runtime-added Acme calibration status for proving live catalog search with no admin re-sync.",
    inputSchema: {
      type: "object",
      properties: {
        line: { type: "string", description: "Optional production line." },
      },
      additionalProperties: true,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

function mcpFixtureResult(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "openwork-connect-pipeline-fixture", version: "1.0.0" },
    };
  }
  if (message.method === "tools/list") {
    return { tools: state.tools };
  }
  if (message.method === "tools/call") {
    const params = isRecord(message.params) ? message.params : {};
    const args = isRecord(params.arguments) ? params.arguments : {};
    const toolName = typeof params.name === "string" ? params.name : "";
    if (toolName === LOOKUP_TOOL) {
      const partNumber = typeof args.partNumber === "string" ? args.partNumber : "unknown-part";
      return {
        content: [{ type: "text", text: `${LOOKUP_MARKER}: ${partNumber} resolved by ${CONNECTION_NAME}` }],
      };
    }
    if (toolName === RUNTIME_TOOL) {
      return {
        content: [{ type: "text", text: `Runtime calibration is visible for ${CONNECTION_NAME}.` }],
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown Acme fixture tool: ${toolName}` }],
    };
  }
  return {};
}

async function startMockMcpServer(ctx) {
  if (state.mockServer) return;
  state.tools = [lookupToolDefinition()];
  const requestedPortText = ctx.env.OPENWORK_EVAL_CONNECT_PIPELINE_MCP_PORT?.trim() ?? "";
  const requestedPort = requestedPortText ? Number(requestedPortText) : 0;
  ctx.assert(Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535, `Invalid OPENWORK_EVAL_CONNECT_PIPELINE_MCP_PORT: ${requestedPortText}`);
  state.mockPublicUrl = ctx.env.OPENWORK_EVAL_CONNECT_PIPELINE_MCP_URL?.trim()
    ? normalizeMcpUrl(ctx.env.OPENWORK_EVAL_CONNECT_PIPELINE_MCP_URL)
    : "";

  state.mockServer = http.createServer(async (request, response) => {
    try {
      const base = `http://127.0.0.1:${state.mockPort || requestedPort || 1}`;
      const url = new URL(request.url || "/", base);
      if (url.pathname === "/health") {
        json(response, 200, { ok: true, connectionName: CONNECTION_NAME, tools: state.tools.map((tool) => tool.name) });
        return;
      }
      if (url.pathname === "/requests") {
        json(response, 200, { requests: state.mockRequests });
        return;
      }
      if (url.pathname !== "/mcp" || request.method !== "POST") {
        json(response, 404, { error: "not_found" });
        return;
      }
      const body = await readJson(request);
      const messages = Array.isArray(body) ? body : [body];
      const replies = [];
      for (const message of messages) {
        if (isRecord(message)) {
          const params = isRecord(message.params) ? message.params : {};
          state.mockRequests.push({
            at: new Date().toISOString(),
            method: request.method,
            path: url.pathname,
            rpcMethod: typeof message.method === "string" ? message.method : null,
            toolName: typeof params.name === "string" ? params.name : null,
          });
          if (message.id !== undefined) {
            replies.push({ jsonrpc: "2.0", id: message.id, result: mcpFixtureResult(message) });
          }
        }
      }
      if (replies.length === 0) {
        response.writeHead(202, { "access-control-allow-origin": "*" });
        response.end();
        return;
      }
      json(response, 200, Array.isArray(body) ? replies : replies[0]);
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise((resolve, reject) => {
    state.mockServer.once("error", reject);
    state.mockServer.listen(requestedPort, requestedPort > 0 ? "0.0.0.0" : "127.0.0.1", resolve);
  });
  state.mockServer.unref();
  const address = state.mockServer.address();
  if (!address || typeof address === "string") throw new Error("Connect pipeline MCP mock has no TCP address.");
  state.mockPort = address.port;
}

function mockMcpUrl() {
  if (state.mockPublicUrl) return state.mockPublicUrl;
  if (!state.mockPort) throw new Error("Connect pipeline MCP mock is not listening.");
  return `http://127.0.0.1:${state.mockPort}/mcp`;
}

async function ensureAdminContext(ctx) {
  state.adminSession = ctx.env.OPENWORK_EVAL_DEN_TOKEN.trim();
  state.memberSession = state.adminSession;
  const orgs = await adminFetch(ctx, "/v1/me/orgs");
  const candidates = Array.isArray(orgs.body?.orgs) ? orgs.body.orgs : [];
  const selected = candidates.find((org) => org.id === orgs.body?.activeOrgId)
    ?? candidates.find((org) => String(org.name ?? "").includes("Acme Robotics"))
    ?? candidates[0];
  ctx.assert(selected && typeof selected.id === "string", `No organization available to ${ADMIN_EMAIL}.`);
  state.orgId = selected.id;
  await adminFetch(ctx, "/v1/me/active-organization", {
    method: "POST",
    body: JSON.stringify({ organizationId: state.orgId }),
  });
}

async function cleanupConnections(ctx) {
  const listed = await adminFetch(ctx, "/v1/mcp-connections?scope=manageable");
  const connections = Array.isArray(listed.body?.connections) ? listed.body.connections : [];
  for (const connection of connections) {
    if (typeof connection.name === "string" && connection.name.startsWith(CONNECTION_PREFIX)) {
      await adminFetch(ctx, `/v1/mcp-connections/${connection.id}`, { method: "DELETE" }, [200, 204]);
    }
  }
}

async function createConnection(ctx) {
  const created = await adminFetch(ctx, "/v1/mcp-connections", {
    method: "POST",
    body: JSON.stringify({
      name: CONNECTION_NAME,
      url: mockMcpUrl(),
      authType: "none",
      credentialMode: "shared",
      access: { orgWide: true, memberIds: [], teamIds: [] },
    }),
  });
  state.connectionId = created.body?.id ?? "";
  ctx.assert(state.connectionId.length > 0, `Connection creation did not return an id: ${JSON.stringify(created.body)}`);
  ctx.assert(created.body?.connected === true, `No-auth connection was not probe-validated as connected: ${JSON.stringify(created.body)}`);
  await replaceConnectionAccess(ctx, { orgWide: true, memberIds: [], teamIds: [] });
  state.adminMcpToken = await mintMcpToken(state.adminSession, ctx);
}

async function replaceConnectionAccess(ctx, access) {
  await adminFetch(ctx, `/v1/mcp-connections/${state.connectionId}/access`, {
    method: "PUT",
    body: JSON.stringify({ access }),
  });
}

async function openDenConnectionsInNewTab(ctx) {
  await ctx.switchToNewTab({
    label: "den-web connections tab",
    trigger: async () => {
      await ctx.eval(`(() => { window.open(${JSON.stringify(denWebUrl())}, "_blank"); return true; })()`);
    },
  });
  state.denTabOpened = true;
  await signInViaBrowser(ctx, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openAdminConnections(ctx);
  await ctx.waitFor(`(() => {
    const leaf = [...document.querySelectorAll('*')]
      .find((entry) => entry.children.length === 0 && (entry.textContent ?? '').trim() === ${JSON.stringify(CONNECTION_NAME)});
    leaf?.scrollIntoView({ block: 'center' });
    return Boolean(leaf);
  })()`, { timeoutMs: 30_000, label: `${CONNECTION_NAME} row` });
}

function parseToolText(result) {
  const text = result?.content?.[0]?.text ?? "{}";
  return { text, parsed: JSON.parse(text) };
}

function externalCapabilityName(toolName) {
  return `mcp:${state.connectionId}:${toolName}`;
}

async function searchCapabilities(ctx, mcpToken, query, limit = 10, type = "all") {
  const result = await mcpAgentCall(mcpToken, "tools/call", {
    name: "search_capabilities",
    arguments: { query, limit, type },
  }, ctx);
  const { parsed, text } = parseToolText(result);
  const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
  return { matches, text, parsed };
}

async function setViewport(ctx, height = 1000) {
  if (!ctx.client?.send) return;
  await ctx.client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

const revealHidden = async (ctx) => {
  const showing = await ctx.eval("document.body.innerText.includes('Showing hidden')");
  if (!showing) await ctx.clickText("Show hidden", { timeoutMs: 30_000 });
};

async function waitForDesktopControl(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 90_000, label: "OpenWork desktop control" });
}

async function configureDesktopForDen(ctx) {
  await waitForDesktopControl(ctx);
  await ctx.waitFor("Boolean(window.__OPENWORK_ELECTRON__?.invokeDesktop)", { timeoutMs: 30_000, label: "desktop bridge" });
  const denBase = denApiBase(ctx);
  const written = await ctx.eval(`(async () => {
    const bridge = window.__OPENWORK_ELECTRON__?.invokeDesktop;
    if (!bridge) return { ok: false, reason: 'desktop bridge missing' };
    await bridge('setDesktopBootstrapConfig', { baseUrl: ${JSON.stringify(denBase)}, apiBaseUrl: ${JSON.stringify(denBase)}, requireSignin: false, handoff: null });
    localStorage.setItem('openwork.den.baseUrl', ${JSON.stringify(denBase)});
    localStorage.setItem('openwork.den.apiBaseUrl', ${JSON.stringify(denBase)});
    localStorage.removeItem('openwork.den.authToken');
    localStorage.removeItem('openwork.den.activeOrgId');
    localStorage.removeItem('openwork.den.activeOrgSlug');
    localStorage.removeItem('openwork.den.activeOrgName');
    localStorage.removeItem('openwork.den.mcp.sync');
    localStorage.removeItem(${JSON.stringify(USER_STATE_KEY)});
    const prefs = JSON.parse(localStorage.getItem('openwork.preferences') || '{}');
    localStorage.setItem('openwork.preferences', JSON.stringify({ ...prefs, selectedAgent: 'openwork' }));
    return { ok: true };
  })()`, { awaitPromise: true });
  ctx.assert(written?.ok === true, `Failed to write desktop bootstrap config: ${JSON.stringify(written)}`);
  await ctx.eval("location.reload()");
  await waitForDesktopControl(ctx);
}

async function signDesktopIntoCloud(ctx) {
  const handoff = await adminFetch(ctx, "/v1/auth/desktop-handoff", {
    method: "POST",
    body: JSON.stringify({ desktopScheme: "openwork" }),
  });
  ctx.assert(typeof handoff.body?.grant === "string" && handoff.body.grant.trim(), "Desktop handoff did not return a grant.");
  await ctx.control("auth.exchange-grant", { grant: handoff.body.grant, baseUrl: denApiBase(ctx) });
  await ctx.waitFor("Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim())", {
    timeoutMs: 45_000,
    label: "persisted den auth token",
  });
  await ctx.waitFor("Boolean((localStorage.getItem('openwork.den.activeOrgId') ?? '').trim())", {
    timeoutMs: 60_000,
    label: "active org resolved",
  });
}

async function createFreshWorkspace(ctx) {
  await ctx.waitFor(
    "Boolean(localStorage.getItem('openwork.server.port') && localStorage.getItem('openwork.server.token') && localStorage.getItem('openwork.server.hostToken'))",
    { timeoutMs: 60_000, label: "OpenWork server auth" },
  );
  const created = await ctx.eval(`(async () => {
    const port = localStorage.getItem('openwork.server.port');
    const token = localStorage.getItem('openwork.server.token');
    const hostToken = localStorage.getItem('openwork.server.hostToken');
    const base = 'http://127.0.0.1:' + port;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'X-OpenWork-Host-Token': hostToken,
    };
    const response = await fetch(base + '/workspaces/local', {
      method: 'POST',
      headers,
      body: JSON.stringify({ folderPath: ${JSON.stringify(WORKSPACE_PATH)}, name: 'openwork-connect-pipeline', preset: 'starter' }),
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    if (!response.ok) return { ok: false, status: response.status, text };
    const workspace = (payload?.workspaces ?? []).find((item) => item.path === ${JSON.stringify(WORKSPACE_PATH)});
    const workspaceId = payload?.activeId ?? workspace?.id;
    if (!workspaceId) return { ok: false, status: response.status, text: 'workspace id missing' };
    const activate = await fetch(base + '/workspaces/' + encodeURIComponent(workspaceId) + '/activate?persist=true', { method: 'POST', headers });
    if (!activate.ok) return { ok: false, status: activate.status, text: await activate.text() };
    localStorage.setItem('openwork.react.activeWorkspace', workspaceId);
    localStorage.removeItem('openwork.den.mcp.sync');
    return { ok: true, workspaceId };
  })()`, { awaitPromise: true });
  ctx.assert(created?.ok === true && typeof created.workspaceId === "string", `Workspace setup failed: ${JSON.stringify(created)}`);
  state.workspaceId = created.workspaceId;
  await ctx.navigateHash(`/workspace/${state.workspaceId}/session`);
  await ctx.clickText("Continue with organization", { timeoutMs: 8_000 }).catch(() => {});
  await ctx.clickText("Continue to workspace", { timeoutMs: 8_000 }).catch(() => {});
  const needsFolder = await ctx.eval("Boolean(document.querySelector('input[placeholder=\"/workspace/my-project\"]'))").catch(() => false);
  if (needsFolder) {
    await ctx.fill('input[placeholder="/workspace/my-project"]', WORKSPACE_PATH);
    await ctx.clickText("Use this folder", { timeoutMs: 15_000 });
  }
  await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent.trim() === 'Continue without OpenWork Models');
    button?.click();
    return true;
  })()`);
  await ctx.waitFor(`window.location.hash.includes(${JSON.stringify(`/workspace/${state.workspaceId}`)})`, {
    timeoutMs: 60_000,
    label: "fresh workspace selected",
  });
}

async function openMcpSettings(ctx) {
  await ctx.navigateHash(`/workspace/${state.workspaceId}/settings/extensions/mcp`);
  await ctx.waitFor("window.location.hash.includes('/settings/extensions/mcp')", { timeoutMs: 30_000, label: "MCP settings route" });
  await ctx.waitForText("Add Custom App", { timeoutMs: 30_000 });
  await revealHidden(ctx);
}

async function readRuntimeCloudControlMcp(ctx) {
  return ctx.eval(`(async () => {
    const workspaceId = ${JSON.stringify(state.workspaceId)};
    const port = localStorage.getItem('openwork.server.port');
    const token = localStorage.getItem('openwork.server.token');
    const hostToken = localStorage.getItem('openwork.server.hostToken');
    if (!workspaceId || !port || !token) return { ok: false, reason: 'missing workspace/server auth', workspaceId, port: Boolean(port), token: Boolean(token) };
    const headers = { Authorization: 'Bearer ' + token };
    if (hostToken) headers['X-OpenWork-Host-Token'] = hostToken;
    const response = await fetch('http://127.0.0.1:' + port + '/workspace/' + encodeURIComponent(workspaceId) + '/mcp', { headers });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    if (!response.ok) return { ok: false, reason: 'mcp endpoint failed', status: response.status, text };
    const items = payload?.items ?? [];
    const matching = items.filter((item) => item.name === ${JSON.stringify(CLOUD_MCP_NAME)});
    const entry = matching[0] ?? null;
    const authorization = entry?.config?.headers?.Authorization ?? '';
    return {
      ok: Boolean(entry?.config?.url?.endsWith('/mcp/agent') && authorization && entry?.config?.oauth === false),
      workspaceId,
      matchingCount: matching.length,
      names: items.map((item) => item.name),
      engineSync: payload?.engineSync?.status ?? null,
      entry,
      authorization,
    };
  })()`, { awaitPromise: true });
}

async function waitForRuntimeCloudControlMcp(ctx, timeoutMs = 90_000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await readRuntimeCloudControlMcp(ctx).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    if (last?.ok) return last;
    await sleep(750);
  }
  ctx.assert(false, `Runtime OpenWork Cloud Control MCP did not become ready: ${JSON.stringify(last)}`);
}

function safeRuntimeSummary(runtime) {
  return {
    ok: runtime.ok,
    workspaceId: runtime.workspaceId,
    matchingCount: runtime.matchingCount,
    names: runtime.names,
    engineSync: runtime.engineSync,
    url: runtime.entry?.config?.url ?? null,
    oauth: runtime.entry?.config?.oauth ?? null,
    enabled: runtime.entry?.config?.enabled ?? null,
    hasAuthorizationHeader: Boolean(runtime.authorization),
  };
}

async function ensureMemberMcpToken(ctx) {
  if (state.memberMcpToken) return state.memberMcpToken;
  state.memberMcpToken = await mintMcpToken(state.memberSession, ctx);
  return state.memberMcpToken;
}

async function waitForMockToolCall(ctx, sinceIso) {
  const startedAt = Date.now();
  let fresh = [];
  while (Date.now() - startedAt < 60_000) {
    fresh = state.mockRequests.filter((entry) => (
      entry.method === "POST"
      && entry.path === "/mcp"
      && entry.rpcMethod === "tools/call"
      && entry.toolName === LOOKUP_TOOL
      && entry.at >= sinceIso
    ));
    if (fresh.length > 0) return fresh;
    await sleep(500);
  }
  ctx.assert(false, `No fresh ${LOOKUP_TOOL} tools/call reached the mock server after ${sinceIso}. Requests: ${JSON.stringify(state.mockRequests).slice(0, 1_200)}`);
}

async function pasteIntoComposer(ctx, text) {
  const pasted = await ctx.eval(`(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
      || document.querySelector('[contenteditable="true"]');
    if (!editor) return { ok: false, reason: 'composer not found' };
    editor.focus();
    const data = new DataTransfer();
    data.setData('text/plain', ${JSON.stringify(text)});
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    return { ok: true, text: editor.innerText };
  })()`);
  if (pasted?.ok) return;
  const controlled = await ctx.control("composer.set_text", { text }).then(() => ({ ok: true }), (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  ctx.assert(controlled.ok, `Composer was not ready: ${JSON.stringify(pasted)} ${JSON.stringify(controlled)}`);
}

async function startChatTurn(ctx) {
  await ctx.navigateHash(`/workspace/${state.workspaceId}/session`);
  await ctx.waitFor("window.location.hash.includes('/session')", { timeoutMs: 30_000, label: "session route" });
  const hasComposer = await ctx.eval("Boolean(document.querySelector('[contenteditable=\"true\"][data-lexical-editor=\"true\"]') || document.querySelector('[contenteditable=\"true\"]'))");
  if (!hasComposer) {
    await ctx.waitFor(
      "window.__openworkControl?.listActions?.().find((action) => action.id === 'session.create_task')?.disabled === false",
      { timeoutMs: 30_000, label: "session.create_task enabled" },
    );
    await ctx.control("session.create_task");
  }
  await ctx.waitFor(
    "Boolean(document.querySelector('[contenteditable=\"true\"][data-lexical-editor=\"true\"]') || document.querySelector('[contenteditable=\"true\"]'))",
    { timeoutMs: 30_000, label: "composer" },
  );
  const partNumber = `PIPE-${RUN_TAG}`;
  const prompt = `Use OpenWork Cloud Control to look up Acme part ${partNumber} in the organization's Acme Parts Pipeline tool. Reply with the exact result returned by that tool.`;
  state.chatStartedAt = new Date().toISOString();
  await pasteIntoComposer(ctx, prompt);
  const clicked = await ctx.clickText("Run task", { timeoutMs: 15_000 }).then(() => true, () => false);
  if (!clicked) {
    await ctx.waitFor(
      "window.__openworkControl?.listActions?.().find((action) => action.id === 'composer.send')?.disabled === false",
      { timeoutMs: 15_000, label: "composer.send enabled" },
    );
    await ctx.control("composer.send");
  }
}

export default {
  id: FLOW_ID,
  title: "OpenWork Connect exposes live organization MCP capabilities to the desktop agent",
  kind: "user-facing",
  suite: "nightly-connect",
  suiteOrder: 5.5,
  spec: "evals/voiceovers/openwork-connect-pipeline.md",
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_TOKEN", "OPENWORK_EVAL_DEN_WEB_URL"],
  steps: [
    {
      name: "Frame 1: admin adds a live MCP server",
      run: async (ctx) => {
        await ctx.prove("An admin-published MCP server is visible as an organization connection", {
          voiceover: vo[0],
          action: async () => {
            await setViewport(ctx);
            await startMockMcpServer(ctx);
            await ensureAdminContext(ctx);
            await cleanupConnections(ctx);
            await createConnection(ctx);
            await openDenConnectionsInNewTab(ctx);
          },
          assert: async () => {
            await ctx.expectText(CONNECTION_NAME, { timeoutMs: 30_000 });
            await ctx.expectText("Connected", { timeoutMs: 30_000 });
            ctx.output("created-connection", JSON.stringify({ connectionId: state.connectionId, name: CONNECTION_NAME, url: mockMcpUrl(), authType: "none", credentialMode: "shared" }, null, 2));
          },
          screenshot: {
            name: "connect-pipeline-admin-connection",
            claim: "The Den Connections page shows the admin-added live MCP server as connected.",
            requireText: [CONNECTION_NAME, "Connected"],
            rejectText: ["Something went wrong", "Connection failed"],
            targetUrlIncludes: "/dashboard/mcp-connections",
          },
        });
      },
    },
    {
      name: "Frame 2: live tools/list picks up a runtime tool",
      run: async (ctx) => {
        await ctx.prove("A tool added after connection creation appears in search without a Den re-sync", {
          voiceover: vo[1],
          action: async () => {
            ctx.assert(!state.tools.some((tool) => tool.name === RUNTIME_TOOL), `${RUNTIME_TOOL} was already present before the runtime mutation.`);
            state.liveToolAddedAt = new Date().toISOString();
            state.tools.push(runtimeToolDefinition());
          },
          assert: async () => {
            const { matches } = await searchCapabilities(ctx, state.adminMcpToken, "Acme Parts runtime calibration", 5, "mcp");
            const expectedName = externalCapabilityName(RUNTIME_TOOL);
            ctx.assert(matches.some((match) => match.name === expectedName), `Runtime-added tool ${expectedName} missing from search: ${JSON.stringify(matches)}`);
            const liveLists = state.mockRequests.filter((entry) => entry.rpcMethod === "tools/list" && entry.at >= state.liveToolAddedAt);
            ctx.assert(liveLists.length > 0, "search_capabilities did not live-list the mock MCP server after the runtime mutation.");
            ctx.output("runtime-tool-search", JSON.stringify({ expectedName, matches: matches.map((match) => ({ name: match.name, summary: match.summary, method: match.method })) }, null, 2));
          },
        });
      },
    },
    {
      name: "Frame 3: desktop sign-in injects OpenWork Cloud Control",
      run: async (ctx) => {
        await ctx.prove("Desktop cloud sign-in injects openwork-cloud with the minimal search/execute MCP surface", {
          voiceover: vo[2],
          action: async () => {
            if (state.denTabOpened) await ctx.switchBack();
            await configureDesktopForDen(ctx);
            await signDesktopIntoCloud(ctx);
            await createFreshWorkspace(ctx);
            await openMcpSettings(ctx);
            await ctx.waitFor("Boolean(localStorage.getItem('openwork.den.mcp.sync'))", { timeoutMs: 120_000, label: "openwork.den.mcp.sync marker" });
            await ensureMemberMcpToken(ctx);
          },
          assert: async () => {
            const runtime = await waitForRuntimeCloudControlMcp(ctx);
            state.cloudAuthorizationBeforeSignOut = runtime.authorization;
            ctx.assert(runtime.matchingCount === 1, `Expected one ${CLOUD_MCP_NAME} runtime entry, got ${runtime.matchingCount}: ${JSON.stringify(runtime.names)}`);
            ctx.assert(runtime.entry?.config?.oauth === false, "openwork-cloud runtime config is not oauth:false.");
            ctx.assert(runtime.entry?.config?.url?.endsWith("/mcp/agent"), `openwork-cloud URL does not end in /mcp/agent: ${runtime.entry?.config?.url}`);
            ctx.assert(runtime.authorization.startsWith("Bearer ow_mcp_at_"), "openwork-cloud runtime config is missing an ow_mcp_at bearer token.");
            const listed = await mcpAgentCall(state.memberMcpToken, "tools/list", {}, ctx);
            const names = (listed.tools ?? []).map((tool) => tool.name).sort();
            ctx.assert(names.join(",") === "execute_capability,search_capabilities", `Expected exactly execute_capability/search_capabilities, got ${names.join(", ")}`);
            ctx.output("desktop-openwork-cloud-runtime", JSON.stringify({ runtime: safeRuntimeSummary(runtime), agentTools: names }, null, 2));
            await ctx.expectText("OpenWork Cloud Control", { timeoutMs: 30_000 });
          },
          screenshot: {
            name: "connect-pipeline-desktop-cloud-control",
            claim: "The desktop Extensions settings reveal the auto-configured OpenWork Cloud Control connection.",
            requireText: ["OpenWork Cloud Control", "Showing hidden"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/mcp",
          },
        });
      },
    },
    {
      name: "Frame 4: search ranks external and native capabilities together",
      run: async (ctx) => {
        await ctx.prove("A natural search query returns the org MCP tool beside non-MCP OpenWork capabilities", {
          voiceover: vo[3],
          assert: async () => {
            const token = await ensureMemberMcpToken(ctx);
            const { matches } = await searchCapabilities(ctx, token, "Acme Parts lookup part draft", 10, "all");
            const expectedName = externalCapabilityName(LOOKUP_TOOL);
            const names = matches.map((match) => match.name);
            ctx.assert(names.includes(expectedName), `Expected ${expectedName} in search results, got ${names.join(", ")}`);
            ctx.assert(names.some((name) => !name.startsWith("mcp:")), `Expected at least one non-MCP capability beside ${expectedName}, got ${names.join(", ")}`);
            ctx.output("merged-search-results", JSON.stringify({ query: "Acme Parts lookup part draft", matches: matches.map((match) => ({ name: match.name, method: match.method, summary: match.summary })) }, null, 2));
          },
        });
      },
    },
    {
      name: "Frame 5: desktop chat executes the real external tool",
      run: async (ctx) => {
        await ctx.prove("A real desktop chat executes the org MCP tool through OpenWork Cloud Control", {
          voiceover: vo[4],
          action: async () => {
            await startChatTurn(ctx);
          },
          assert: async () => {
            await ctx.waitFor("Boolean([...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Stop'))", {
              timeoutMs: 30_000,
              label: "assistant started",
            }).catch(() => {});
            await ctx.waitFor("!Boolean([...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Stop'))", {
              timeoutMs: 240_000,
              label: "assistant finished",
            });
            await ctx.waitForText(LOOKUP_MARKER, { timeoutMs: 90_000 });
            const freshCalls = await waitForMockToolCall(ctx, state.chatStartedAt);
            ctx.output("external-server-tool-call", JSON.stringify({ since: state.chatStartedAt, calls: freshCalls }, null, 2));
          },
          screenshot: {
            name: "connect-pipeline-chat-execute",
            claim: "The desktop chat shows the distinctive result returned by the external MCP server.",
            requireText: [LOOKUP_MARKER],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 6: revoked access removes the MCP capability from search",
      run: async (ctx) => {
        await ctx.prove("Revoking the grant removes the external MCP capability from search", {
          voiceover: vo[5],
          action: async () => {
            await replaceConnectionAccess(ctx, { orgWide: false, memberIds: [], teamIds: [] });
          },
          assert: async () => {
            const token = await ensureMemberMcpToken(ctx);
            const { matches } = await searchCapabilities(ctx, token, "Acme Parts lookup part draft", 10, "all");
            const externalNames = matches.map((match) => match.name).filter((name) => name.startsWith(`mcp:${state.connectionId}:`));
            ctx.assert(externalNames.length === 0, `Revoked connection still appeared in search: ${externalNames.join(", ")}`);
            ctx.assert(!JSON.stringify(matches).includes(state.connectionId), "Revoked connection surfaced as a status row instead of disappearing for this member.");
            ctx.output("post-revoke-search", JSON.stringify({ matches: matches.map((match) => ({ name: match.name, kind: match.kind ?? "capability", status: match.status ?? null, hint: match.hint ?? null })), reduction: "The no-auth shared fixture cannot produce a per-member needs_connection hint, so this frame proves the grant boundary by absence only." }, null, 2));
          },
        });
      },
    },
    {
      name: "Frame 7: signed-out sync skips without rewriting the parked MCP",
      run: async (ctx) => {
        await ctx.prove("Signing out leaves the openwork-cloud runtime entry parked without minting a replacement token", {
          voiceover: vo[6],
          action: async () => {
            const before = await waitForRuntimeCloudControlMcp(ctx);
            state.cloudAuthorizationBeforeSignOut = before.authorization;
            await ctx.navigateHash(`/workspace/${state.workspaceId}/settings/cloud-account`);
            await ctx.waitForText("Sign out", { timeoutMs: 30_000 });
            await ctx.clickText("Sign out", { timeoutMs: 20_000 });
            await ctx.waitForText("Paste sign-in code", { timeoutMs: 45_000 });
            await openMcpSettings(ctx);
            await ctx.clickText("Refresh", { timeoutMs: 15_000 }).catch(() => {});
          },
          assert: async () => {
            const localToken = await ctx.eval("localStorage.getItem('openwork.den.authToken')");
            ctx.assert(!localToken, "Desktop auth token remained after sign-out.");
            const runtime = await waitForRuntimeCloudControlMcp(ctx);
            ctx.assert(runtime.authorization === state.cloudAuthorizationBeforeSignOut, "Signed-out sync minted or rewrote the openwork-cloud Authorization header.");
            ctx.assert(runtime.entry?.config?.oauth === false, "Parked openwork-cloud entry no longer has oauth:false.");
            ctx.assert(runtime.entry?.config?.url?.endsWith("/mcp/agent"), "Parked openwork-cloud entry no longer points at /mcp/agent.");
            const marker = await ctx.eval("localStorage.getItem('openwork.den.mcp.sync')");
            ctx.output("signed-out-parked-openwork-cloud", JSON.stringify({ authTokenPresent: Boolean(localToken), syncMarkerPresent: Boolean(marker), tokenUnchanged: true, runtime: safeRuntimeSummary(runtime) }, null, 2));
            await ctx.expectText("OpenWork Cloud Control", { timeoutMs: 30_000 });
          },
          screenshot: {
            name: "connect-pipeline-signed-out-parked",
            claim: "After sign-out, the OpenWork Cloud Control entry remains parked instead of being rewritten.",
            requireText: ["OpenWork Cloud Control", "Showing hidden"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/mcp",
          },
        });
      },
    },
    {
      name: "Cleanup",
      run: async (ctx) => {
        if (state.connectionId) {
          await adminFetch(ctx, `/v1/mcp-connections/${state.connectionId}`, { method: "DELETE" }, [200, 204]);
        }
        if (state.mockServer) {
          await new Promise((resolve) => state.mockServer.close(() => resolve()));
          state.mockServer = null;
        }
      },
    },
  ],
};
