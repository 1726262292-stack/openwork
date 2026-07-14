import http from "node:http";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Narration is loaded from the approved script (evals/voiceovers/cloud-mcp-reliability.md).
// The runner fails this flow if the narration drifts from that script.
const FLOW_ID = "cloud-mcp-reliability";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const CONNECTION_BASE_NAME = "Cloud Reliability Check";
const CONNECTION_NAME = `${CONNECTION_BASE_NAME} ${RUN_TAG}`;
const FIXTURE_TOOL_NAME = "record_reliability_check";
const RESULT_MARKER = `cloud-reliability-result-${RUN_TAG}`;
const WORKSPACE_PATH = join(tmpdir(), `openwork-cloud-mcp-reliability-${RUN_TAG}`);
const CLOUD_MCP_NAME = "openwork-cloud";
const EXPECTED_TOOL_IDS = [
  "openwork-cloud_search_capabilities",
  "openwork-cloud_execute_capability",
];
const EXPECTED_AGENT_TOOLS = ["execute_capability", "search_capabilities"];
const PLUGIN_CANARY = "openwork_docs_search";

const state = {
  fixtureServer: null,
  fixturePort: null,
  fixtureListenPort: null,
  fixturePublicUrl: null,
  fixtureExecutions: [],
  connectionId: null,
  workspaceId: null,
  workspacePath: WORKSPACE_PATH,
  org: null,
  model: null,
  serverAuth: null,
  degradedHealth: null,
  readyHealth: null,
  mcpToken: null,
  chatStartedAt: null,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function quoted(value) {
  return JSON.stringify(value);
}

function optionalEnv(ctx, name) {
  const value = ctx.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFixtureUrl(value) {
  const url = new URL(value);
  url.hash = "";
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/mcp") ? pathname : `${pathname}/mcp`;
  return url.toString();
}

function cleanBaseUrl(value) {
  const url = new URL(value.trim());
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

function desktopReachableBaseUrl(value) {
  const url = new URL(cleanBaseUrl(value));
  if (url.hostname === "127.0.0.1") url.hostname = "localhost";
  return cleanBaseUrl(url.toString());
}

function configureFixtureFromEnv(ctx) {
  const portText = optionalEnv(ctx, "OPENWORK_EVAL_MCP_FIXTURE_PORT");
  const listenPort = portText ? Number(portText) : 0;
  ctx.assert(Number.isInteger(listenPort) && listenPort >= 0 && listenPort <= 65535, `OPENWORK_EVAL_MCP_FIXTURE_PORT must be a TCP port, got ${quoted(portText)}.`);
  state.fixtureListenPort = listenPort;

  const publicUrl = optionalEnv(ctx, "OPENWORK_EVAL_MCP_FIXTURE_URL");
  state.fixturePublicUrl = publicUrl ? normalizeFixtureUrl(publicUrl) : null;
}

function denApiBase(ctx) {
  return cleanBaseUrl(ctx.env.OPENWORK_EVAL_DEN_API_URL);
}

function denWebBase(ctx) {
  const webBase = optionalEnv(ctx, "OPENWORK_EVAL_DEN_WEB_URL");
  return cleanBaseUrl(webBase || ctx.env.OPENWORK_EVAL_DEN_API_URL);
}

function denDesktopWebBase(ctx) {
  return desktopReachableBaseUrl(denWebBase(ctx));
}

function denDesktopApiBase(ctx) {
  return desktopReachableBaseUrl(denApiBase(ctx));
}

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual: actual === undefined ? undefined : JSON.stringify(actual).slice(0, 1_200),
  });
  ctx.assert(condition, `${assertion}${actual === undefined ? "" : `. Actual: ${JSON.stringify(actual).slice(0, 600)}`}`);
}

async function denFetch(ctx, path, options = {}) {
  const response = await fetch(`${denApiBase(ctx)}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ctx.env.OPENWORK_EVAL_DEN_TOKEN.trim()}`,
      ...(state.org?.id ? { "x-openwork-legacy-org-id": state.org.id } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function mcpAgentCall(ctx, mcpToken, method, params) {
  const response = await fetch(`${denApiBase(ctx)}/mcp/agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${mcpToken}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? {} }),
  });
  const raw = await response.text();
  ctx.assert(response.ok, `MCP ${method} failed: ${response.status} ${raw.slice(0, 300)}`);
  const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
  ctx.assert(Boolean(dataLine), `MCP ${method} returned no data frame: ${raw.slice(0, 300)}`);
  const parsed = JSON.parse(dataLine.slice(5));
  ctx.assert(!parsed.error, `MCP ${method} returned a JSON-RPC error: ${JSON.stringify(parsed.error)}`);
  return parsed.result;
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

function fixtureTool() {
  return {
    name: FIXTURE_TOOL_NAME,
    title: "Record reliability check",
    description: `Run the ${CONNECTION_BASE_NAME} fixture and return the exact marker ${RESULT_MARKER}.`,
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string", description: "Optional note about the reliability check request." },
      },
      additionalProperties: true,
    },
    annotations: {
      readOnlyHint: false,
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
      serverInfo: { name: "cloud-reliability-check", version: "1.0.0" },
    };
  }
  if (message.method === "tools/list") {
    return { tools: [fixtureTool()] };
  }
  if (message.method === "tools/call") {
    const params = message.params && typeof message.params === "object" ? message.params : {};
    const name = typeof params.name === "string" ? params.name : "";
    if (name === FIXTURE_TOOL_NAME) {
      const execution = {
        at: new Date().toISOString(),
        toolName: name,
        arguments: params.arguments ?? {},
      };
      state.fixtureExecutions.push(execution);
      return {
        content: [{ type: "text", text: `${CONNECTION_BASE_NAME} completed: ${RESULT_MARKER}` }],
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown fixture tool: ${name}` }],
    };
  }
  return {};
}

async function startFixtureServer(ctx) {
  configureFixtureFromEnv(ctx);
  if (state.fixtureServer) return;
  state.fixtureServer = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname === "/health") {
        json(response, 200, { ok: true, connectionName: CONNECTION_NAME, resultMarker: RESULT_MARKER });
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
        if (message && typeof message === "object" && message.id !== undefined) {
          replies.push({ jsonrpc: "2.0", id: message.id, result: mcpFixtureResult(message) });
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
    state.fixtureServer.once("error", reject);
    const listenPort = state.fixtureListenPort ?? 0;
    state.fixtureServer.listen(listenPort, listenPort > 0 ? "0.0.0.0" : "127.0.0.1", resolve);
  });
  state.fixtureServer.unref();
  const address = state.fixtureServer.address();
  if (!address || typeof address === "string") throw new Error("Fixture server has no TCP address.");
  state.fixturePort = address.port;
}

function fixtureUrl() {
  if (!state.fixturePort) throw new Error("Fixture server is not started.");
  return state.fixturePublicUrl ?? `http://127.0.0.1:${state.fixturePort}/mcp`;
}

async function setViewport(ctx) {
  if (!ctx.client?.send) return;
  await ctx.client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function waitForControl(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 90_000, label: "control API" });
}

async function runSetupStage(ctx, stage, operation) {
  ctx.log(`Cloud reliability setup stage started: ${stage}`);
  try {
    const result = await operation();
    ctx.log(`Cloud reliability setup stage succeeded: ${stage}`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`Cloud reliability setup failed during ${stage}: ${message}`);
    if (error instanceof Error && error.stack) {
      wrapped.stack = `${wrapped.message}\nOriginal stack:\n${error.stack}`;
    }
    throw wrapped;
  }
}

async function configureDesktopForDen(ctx) {
  const baseUrl = denDesktopWebBase(ctx);
  const apiBaseUrl = denDesktopApiBase(ctx);
  const written = await ctx.eval(`(async () => {
    const bridge = window.__OPENWORK_ELECTRON__?.invokeDesktop;
    if (!bridge) return { ok: false, reason: "desktop bridge missing" };
    await bridge("setDesktopBootstrapConfig", { baseUrl: ${quoted(baseUrl)}, apiBaseUrl: ${quoted(apiBaseUrl)}, requireSignin: false, handoff: null });
    localStorage.setItem("openwork.den.baseUrl", ${quoted(baseUrl)});
    localStorage.setItem("openwork.den.apiBaseUrl", ${quoted(apiBaseUrl)});
    return { ok: true };
  })()`, { awaitPromise: true });
  witness(ctx, written?.ok === true, "The desktop bootstrap points at the local Den stack.", written);
  await ctx.eval("location.reload()");
  await waitForControl(ctx);
}

async function loadOrg(ctx) {
  const orgsPayload = await denFetch(ctx, "/v1/me/orgs");
  const orgs = Array.isArray(orgsPayload?.orgs) ? orgsPayload.orgs : [];
  const selected = orgs.find((org) => org.id === orgsPayload.activeOrgId) ?? orgs[0];
  ctx.assert(selected?.id, `No organization returned by Den: ${JSON.stringify(orgsPayload)}`);
  state.org = { id: selected.id, slug: selected.slug ?? null, name: selected.name ?? null };
  await denFetch(ctx, "/v1/me/active-organization", {
    method: "POST",
    body: JSON.stringify({ organizationId: state.org.id }),
  });
}

async function signInWithFreshHandoff(ctx) {
  await loadOrg(ctx);
  await ctx.eval(`(() => {
    localStorage.removeItem("openwork.den.authToken");
    localStorage.removeItem("openwork.den.activeOrgId");
    localStorage.removeItem("openwork.den.activeOrgSlug");
    localStorage.removeItem("openwork.den.activeOrgName");
    localStorage.removeItem("openwork.den.mcp.sync");
    return true;
  })()`);
  const handoff = await denFetch(ctx, "/v1/auth/desktop-handoff", {
    method: "POST",
    body: JSON.stringify({ desktopScheme: "openwork" }),
  });
  ctx.assert(typeof handoff?.grant === "string" && handoff.grant.trim(), "Desktop handoff did not return a grant.");
  await ctx.control("auth.exchange-grant", { grant: handoff.grant, baseUrl: denDesktopWebBase(ctx) });
  await ctx.eval(`(() => {
    localStorage.setItem("openwork.den.activeOrgId", ${quoted(state.org.id)});
    ${state.org.slug ? `localStorage.setItem("openwork.den.activeOrgSlug", ${quoted(state.org.slug)});` : "localStorage.removeItem(\"openwork.den.activeOrgSlug\");"}
    ${state.org.name ? `localStorage.setItem("openwork.den.activeOrgName", ${quoted(state.org.name)});` : "localStorage.removeItem(\"openwork.den.activeOrgName\");"}
    window.dispatchEvent(new Event("openwork:den-settings-changed"));
    window.dispatchEvent(new Event("openwork:den-session-updated"));
    return true;
  })()`);
  await ctx.waitFor(
    `Boolean((localStorage.getItem("openwork.den.authToken") ?? "").trim()) && localStorage.getItem("openwork.den.activeOrgId") === ${quoted(state.org.id)}`,
    { timeoutMs: 45_000, label: "fresh Den handoff signed in with active org" },
  );
  witness(ctx, true, "A fresh Den desktop handoff was exchanged and the eval organization is active.", state.org);
}

async function getServerAuth(ctx, requireWorkspace = false) {
  const auth = await ctx.eval(`(() => {
    const hash = window.location.hash;
    // Keep this template-safe: regex literals lose backslashes inside the outer eval string.
    const workspaceFromHash = (hash.match(new RegExp("/workspace/([^/]+)")) ?? [])[1] ?? "";
    return {
      port: (localStorage.getItem("openwork.server.port") ?? "").trim(),
      token: (localStorage.getItem("openwork.server.token") ?? "").trim(),
      hostToken: (localStorage.getItem("openwork.server.hostToken") ?? "").trim(),
      workspaceId: workspaceFromHash || (localStorage.getItem("openwork.react.activeWorkspace") ?? "").trim(),
    };
  })()`);
  ctx.assert(auth?.port && auth.token, `OpenWork server credentials missing: ${JSON.stringify(auth)}`);
  if (requireWorkspace) ctx.assert(auth.workspaceId, `Workspace id missing from desktop state: ${JSON.stringify(auth)}`);
  state.serverAuth = auth;
  return auth;
}

async function serverFetchJson(ctx, path, options = {}) {
  const auth = state.serverAuth ?? await getServerAuth(ctx);
  const response = await fetch(`http://127.0.0.1:${auth.port}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${auth.token}`,
      ...(auth.hostToken ? { "x-openwork-host-token": auth.hostToken } : {}),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function createFreshWorkspace(ctx) {
  await mkdir(WORKSPACE_PATH, { recursive: true });
  await getServerAuth(ctx);
  const created = await serverFetchJson(ctx, "/workspaces/local", {
    method: "POST",
    body: { folderPath: WORKSPACE_PATH, name: `cloud-mcp-reliability-${RUN_TAG}`, preset: "starter" },
  });
  const workspaceId = created?.activeId ?? created?.selectedId ?? created?.workspaces?.find((workspace) => workspace.path === WORKSPACE_PATH)?.id;
  ctx.assert(typeof workspaceId === "string" && workspaceId.trim(), `Workspace create did not return an id: ${JSON.stringify(created)}`);
  state.workspaceId = workspaceId;
  await serverFetchJson(ctx, `/workspaces/${encodeURIComponent(workspaceId)}/activate?persist=true`, { method: "POST" });
  await ctx.eval(`(() => {
    localStorage.setItem("openwork.react.activeWorkspace", ${quoted(workspaceId)});
    const prefs = JSON.parse(localStorage.getItem("openwork.preferences") || "{}");
    localStorage.setItem("openwork.preferences", JSON.stringify({ ...prefs, hasCompletedOnboarding: true, providerStepCompleted: true, selectedAgent: "openwork" }));
    return true;
  })()`);
  await ctx.navigateHash(`/workspace/${workspaceId}/session`);
  await ctx.waitFor(`window.location.hash.includes(${quoted(`/workspace/${workspaceId}`)})`, { timeoutMs: 45_000, label: "fresh workspace route" });
  await getServerAuth(ctx, true);
  witness(ctx, true, "A fresh local workspace is active for this proof.", { workspaceId, workspacePath: WORKSPACE_PATH });
}

async function ensureUsableModel(ctx) {
  await ctx.navigateHash(`/workspace/${state.workspaceId}/session`);
  await ctx.waitFor(`window.location.hash.includes(${quoted(`/workspace/${state.workspaceId}/session`)})`, { timeoutMs: 45_000, label: "session route for model discovery" });
  await ctx.waitFor(
    `window.__openworkControl?.listActions?.().some((item) => item.id === "eval.model_not_available.seed" && !item.disabled)`,
    { timeoutMs: 60_000, label: "available model eval seed action" },
  );
  const seeded = await ctx.control("eval.model_not_available.seed");
  const available = seeded?.availableModel;
  ctx.assert(available?.providerID && available?.modelID, `No available connected model found: ${JSON.stringify(seeded)}`);
  state.model = { provider: available.providerID, model: available.modelID, title: available.title ?? available.modelID };
  await ctx.eval(`(() => {
    const prefs = JSON.parse(localStorage.getItem("openwork.preferences") || "{}");
    localStorage.setItem("openwork.preferences", JSON.stringify({
      ...prefs,
      defaultModel: { providerID: ${quoted(state.model.provider)}, modelID: ${quoted(state.model.model)} },
      modelVariant: null,
      selectedAgent: "openwork",
      providerStepCompleted: true,
      hasCompletedOnboarding: true,
    }));
    return true;
  })()`);
  await ctx.eval("location.reload()");
  await waitForControl(ctx);
  await ctx.navigateHash(`/workspace/${state.workspaceId}/session`);
  await ctx.waitFor(
    `(() => {
      const prefs = JSON.parse(localStorage.getItem("openwork.preferences") || "{}");
      return prefs.defaultModel?.providerID === ${quoted(state.model.provider)} && prefs.defaultModel?.modelID === ${quoted(state.model.model)};
    })()`,
    { timeoutMs: 20_000, label: "selected eval model persisted" },
  );
  witness(ctx, true, "A connected provider/model is selected for provider projection and the real task.", state.model);
}

async function cleanupExistingFixtureConnections(ctx) {
  const manageable = await denFetch(ctx, "/v1/mcp-connections?scope=manageable");
  const connections = Array.isArray(manageable?.connections) ? manageable.connections : [];
  for (const connection of connections) {
    if (typeof connection?.name === "string" && connection.name.startsWith(CONNECTION_BASE_NAME)) {
      await denFetch(ctx, `/v1/mcp-connections/${encodeURIComponent(connection.id)}`, { method: "DELETE" }).catch(() => null);
    }
  }
}

async function createFixtureConnection(ctx) {
  await startFixtureServer(ctx);
  await cleanupExistingFixtureConnections(ctx);
  const created = await denFetch(ctx, "/v1/mcp-connections", {
    method: "POST",
    body: JSON.stringify({
      name: CONNECTION_NAME,
      url: fixtureUrl(),
      authType: "none",
      credentialMode: "shared",
      access: { orgWide: true, memberIds: [], teamIds: [] },
    }),
  });
  ctx.assert(typeof created?.id === "string" && created.connected === true, `Fixture connection was not connected: ${JSON.stringify(created)}`);
  state.connectionId = created.id;
  witness(ctx, true, "A real no-auth external MCP fixture is registered through Den and connected.", {
    connectionId: state.connectionId,
    connectionName: CONNECTION_NAME,
  });
}

async function mintDenMcpToken(ctx) {
  const minted = await denFetch(ctx, "/v1/mcp/token", {
    method: "POST",
    body: JSON.stringify({ scopes: ["mcp:read", "mcp:write"] }),
  });
  ctx.assert(typeof minted?.token === "string" && minted.token.startsWith("ow_mcp_at_"), "Den did not mint a first-party MCP token.");
  state.mcpToken = minted.token;
  return minted;
}

function mcpAgentUrlFromResource(ctx, resource) {
  const trimmed = typeof resource === "string" ? resource.trim() : "";
  if (!trimmed) return `${denApiBase(ctx)}/mcp/agent`;
  const baseUrl = cleanBaseUrl(trimmed);
  return baseUrl.endsWith("/agent") ? baseUrl : `${baseUrl}/agent`;
}

async function initialStrictReconcile(ctx) {
  const minted = await mintDenMcpToken(ctx);
  const payload = {
    workspaceId: state.workspaceId,
    name: CLOUD_MCP_NAME,
    config: {
      type: "remote",
      enabled: true,
      url: mcpAgentUrlFromResource(ctx, minted.resource),
      headers: { Authorization: `Bearer ${minted.token}` },
      oauth: false,
    },
    tokenMetadata: {
      organizationId: minted.organizationId,
      expiresAt: minted.expiresAt,
      resource: minted.resource,
      scopes: minted.scopes.join(" "),
    },
    org: { id: state.org.id, slug: state.org.slug, name: state.org.name },
    connectCatalogEnabled: true,
    trigger: "fraimz-initial-strict-reconcile",
    ...(state.model ? { provider: state.model.provider, model: state.model.model } : {}),
  };
  const health = await serverFetchJson(ctx, `/workspace/${encodeURIComponent(state.workspaceId)}/mcp/openwork-cloud/reconcile`, {
    method: "POST",
    body: payload,
  });
  ctx.assert(health?.workspace?.id === state.workspaceId, "Initial reconcile returned a different workspace.");
  ctx.assert(health.usable === true && health.firstFailure === null, `Initial strict reconcile did not become usable: ${JSON.stringify(health.firstFailure)}`);
  witness(ctx, true, "Initial strict Cloud reconcile succeeded before inducing degradation.", {
    workspaceId: health.workspace.id,
    desiredRevision: health.desired.revision,
    engine: health.engine.status,
  });
}

async function deleteCloudRuntimeConfig(ctx) {
  await ctx.navigateHash(`/workspace/${state.workspaceId}/settings/general`);
  await ctx.waitFor(`window.location.hash.includes(${quoted(`/workspace/${state.workspaceId}/settings/general`)})`, { timeoutMs: 30_000, label: "settings route before deletion" });
  await serverFetchJson(ctx, `/workspace/${encodeURIComponent(state.workspaceId)}/mcp/${encodeURIComponent(CLOUD_MCP_NAME)}`, { method: "DELETE" });
  await ctx.eval(`(() => {
    localStorage.removeItem("openwork.den.mcp.sync");
    return true;
  })()`);
  state.degradedHealth = await waitForHealth(ctx, (health) => (
    health?.workspace?.id === state.workspaceId &&
    health.usable === false &&
    health.firstFailure?.stage === "desired_config" &&
    health.firstFailure?.code === "cloud_mcp_missing"
  ), "desired_config cloud_mcp_missing after deleting runtime config");
  witness(ctx, true, "Deleting only this workspace's openwork-cloud runtime config makes direct health unusable with desired_config/cloud_mcp_missing.", {
    workspaceId: state.degradedHealth.workspace.id,
    firstFailure: state.degradedHealth.firstFailure,
  });
}

async function getHealth(ctx) {
  const query = new URLSearchParams();
  if (state.model?.provider && state.model.model) {
    query.set("provider", state.model.provider);
    query.set("model", state.model.model);
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  return serverFetchJson(ctx, `/workspace/${encodeURIComponent(state.workspaceId)}/mcp/openwork-cloud/health${suffix}`);
}

async function waitForHealth(ctx, predicate, label, timeoutMs = 90_000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      last = await getHealth(ctx);
      if (predicate(last)) return last;
    } catch (error) {
      last = { error: error instanceof Error ? error.message : String(error) };
    }
    await sleep(1_000);
  }
  ctx.assert(false, `Timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

async function openConnect(ctx) {
  await ctx.navigateHash(`/workspace/${state.workspaceId}/settings/connect`);
  await ctx.expectHashIncludes("/settings/connect");
  await ctx.waitForText("Agent access to connected services", { timeoutMs: 60_000 });
  await ctx.waitForText(CONNECTION_NAME, { timeoutMs: 60_000 });
}

async function scrollToText(ctx, text) {
  await ctx.eval(`(() => {
    const candidates = [...document.querySelectorAll('button, [data-testid], [data-slot], summary, pre, code, h1, h2, h3, p, span, div')]
      .filter((node) => (node.textContent || "").includes(${quoted(text)}));
    const target = candidates.find((node) => [...node.children].every((child) => !(child.textContent || "").includes(${quoted(text)})))
      || candidates[candidates.length - 1];
    target?.scrollIntoView({ block: "center", inline: "nearest" });
    return Boolean(target);
  })()`);
}

async function installNetworkProbe(ctx, label) {
  const result = await ctx.eval(`(() => {
    const key = "__cloudMcpReliabilityProbe";
    if (!window[key]) {
      const originalFetch = window.fetch.bind(window);
      const bridge = window.__OPENWORK_ELECTRON__;
      const originalInvoke = bridge?.invokeDesktop?.bind(bridge) ?? null;
      const probe = { requests: [], desktopFetches: [], originalFetch, originalInvoke, label: ${quoted(label)}, installedAt: Date.now(), desktopPatched: false };
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input?.url || String(input);
        const method = (init?.method || input?.method || "GET").toUpperCase();
        const body = typeof init?.body === "string" ? init.body : null;
        probe.requests.push({ at: Date.now(), url, method, body });
        return originalFetch(input, init);
      };
      if (bridge && originalInvoke) {
        try {
          bridge.invokeDesktop = async (command, ...args) => {
            if (command === "__fetch") {
              const init = args[1] && typeof args[1] === "object" ? args[1] : {};
              probe.desktopFetches.push({ at: Date.now(), url: String(args[0] || ""), method: String(init.method || "GET").toUpperCase() });
            }
            return originalInvoke(command, ...args);
          };
          probe.desktopPatched = true;
        } catch {
          probe.desktopPatched = false;
        }
      }
      window[key] = probe;
    }
    window[key].requests.length = 0;
    window[key].desktopFetches.length = 0;
    window[key].label = ${quoted(label)};
    return { ok: true, desktopPatched: window[key].desktopPatched };
  })()`);
  witness(ctx, result?.ok === true && result.desktopPatched === true, "Renderer network probe is installed for fetch and desktop __fetch calls.", result);
}

async function networkSummary(ctx) {
  return ctx.eval(`(() => {
    const probe = window.__cloudMcpReliabilityProbe;
    if (!probe) return null;
    const sanitizeRequest = (request) => {
      let parsedBody = null;
      try {
        const raw = typeof request.body === "string" ? JSON.parse(request.body) : null;
        if (raw && typeof raw === "object") {
          parsedBody = {
            workspaceId: raw.workspaceId ?? null,
            name: raw.name ?? null,
            trigger: raw.trigger ?? null,
            provider: raw.provider ?? null,
            model: raw.model ?? null,
            configUrl: raw.config?.url ?? null,
            hasAuthorization: Boolean(raw.config?.headers?.Authorization),
          };
        }
      } catch {}
      return { at: request.at, method: request.method, url: request.url, body: parsedBody };
    };
    return {
      label: probe.label,
      requests: probe.requests.map(sanitizeRequest),
      desktopFetches: probe.desktopFetches.map((request) => ({ at: request.at, method: request.method, url: request.url })),
    };
  })()`);
}

async function readMarker(ctx) {
  return ctx.eval("localStorage.getItem('openwork.den.mcp.sync')");
}

async function clickAgentAccessButton(ctx, label) {
  const clicked = await ctx.eval(`(() => {
    const card = document.querySelector('[data-testid="agent-access-card"]');
    const button = [...(card?.querySelectorAll('button') ?? [])].find((candidate) => (candidate.textContent || "").trim() === ${quoted(label)} && !candidate.disabled);
    button?.scrollIntoView({ block: "center", inline: "nearest" });
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(clicked, `Could not click Agent access button: ${label}`);
}

async function waitForAgentButton(ctx, label) {
  await ctx.waitFor(`(() => {
    const card = document.querySelector('[data-testid="agent-access-card"]');
    return [...(card?.querySelectorAll('button') ?? [])].some((button) => (button.textContent || "").trim() === ${quoted(label)} && !button.disabled);
  })()`, { timeoutMs: 90_000, label: `Agent access ${label} button enabled` });
}

function assertExpectedTools(ctx, actual, label) {
  for (const tool of EXPECTED_TOOL_IDS) {
    ctx.assert(actual.includes(tool), `${label} missing ${tool}: ${actual.join(", ")}`);
  }
}

function assertNoSecretText(ctx, text, secrets) {
  for (const secret of secrets.filter((value) => typeof value === "string" && value.trim().length >= 8)) {
    ctx.assert(!text.includes(secret), "Sanitized diagnostic leaked a live secret value.");
  }
  ctx.assert(!/Bearer\s+[A-Za-z0-9._~+\-/]+=*/.test(text), "Sanitized diagnostic leaked a Bearer token.");
  ctx.assert(!/ow_mcp_at_[A-Za-z0-9_-]+/.test(text), "Sanitized diagnostic leaked a raw Den MCP token.");
}

async function setupProof(ctx) {
  await runSetupStage(ctx, "setViewport", () => setViewport(ctx));
  await runSetupStage(ctx, "control wait", () => waitForControl(ctx));
  await runSetupStage(ctx, "bootstrap", () => configureDesktopForDen(ctx));
  await runSetupStage(ctx, "handoff", () => signInWithFreshHandoff(ctx));
  await runSetupStage(ctx, "create workspace", () => createFreshWorkspace(ctx));
  await runSetupStage(ctx, "model", () => ensureUsableModel(ctx));
  await runSetupStage(ctx, "fixture", () => createFixtureConnection(ctx));
  await runSetupStage(ctx, "reconcile", () => initialStrictReconcile(ctx));
  await runSetupStage(ctx, "degradation", () => deleteCloudRuntimeConfig(ctx));
}

export default {
  id: FLOW_ID,
  title: "Users can verify, repair, diagnose, and use Cloud agent access per workspace",
  kind: "user-facing",
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_TOKEN"],
  steps: [
    {
      name: "Setup: fresh Den handoff, workspace, fixture, and degraded state",
      run: async (ctx) => {
        await setupProof(ctx);
      },
    },
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("Settings → Connect separates the real connected service row from the Agent access readiness card", {
          voiceover: vo[0],
          action: async () => {
            await openConnect(ctx);
            await scrollToText(ctx, CONNECTION_NAME);
          },
          assert: async () => {
            const separation = await ctx.eval(`(() => {
              const card = document.querySelector('[data-testid="agent-access-card"]');
              const rows = [...document.querySelectorAll('[data-testid="connect-organization-row"]')];
              const row = rows.find((entry) => (entry.textContent || "").includes(${quoted(CONNECTION_NAME)}));
              return {
                hasCard: Boolean(card),
                hasRow: Boolean(row),
                rowInsideCard: Boolean(card && row && card.contains(row)),
                rowKind: row?.getAttribute('data-connect-row-kind') ?? null,
                sectionExists: Boolean(document.querySelector('[data-testid="connect-organization-section"]')),
              };
            })()`);
            witness(ctx, separation.hasCard && separation.hasRow && separation.sectionExists && separation.rowInsideCard === false, "The connected service row is in the organization section, not nested inside the Agent access card.", separation);
            await ctx.expectText("Agent access to connected services");
            await ctx.expectText(CONNECTION_NAME);
            await ctx.expectText("From your organization");
          },
          screenshot: {
            name: "frame-1-connect-separation",
            requireText: ["Agent access to connected services", "From your organization", CONNECTION_NAME],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/connect",
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("The Agent access card reports Degraded with the first failing stage and Repair and test guidance", {
          voiceover: vo[1],
          action: async () => {
            await scrollToText(ctx, "Agent access to connected services");
            await ctx.waitForText("Degraded", { timeoutMs: 60_000 });
            await ctx.waitForText("Use Repair and test to apply agent access for this workspace.", { timeoutMs: 60_000 });
          },
          assert: async () => {
            state.degradedHealth = await waitForHealth(ctx, (health) => (
              health.usable === false &&
              health.workspace.id === state.workspaceId &&
              health.firstFailure?.stage === "desired_config" &&
              health.firstFailure?.code === "cloud_mcp_missing"
            ), "visible degraded desired_config health");
            witness(ctx, true, "Live health firstFailure is desired_config/cloud_mcp_missing for the exact workspace.", {
              workspaceId: state.degradedHealth.workspace.id,
              firstFailure: state.degradedHealth.firstFailure,
            });
            await ctx.expectText("Degraded");
            await ctx.expectText("First issue");
            await ctx.expectText("Recommended action");
          },
          screenshot: {
            name: "frame-2-degraded-first-issue",
            requireText: ["Degraded", "First issue", "Recommended action", "Use Repair and test"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/connect",
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("Test now performs a read-only live health GET and leaves the degraded state untouched", {
          voiceover: vo[2],
          action: async () => {
            await installNetworkProbe(ctx, "test-now");
            state.markerBeforeTest = await readMarker(ctx);
            await clickAgentAccessButton(ctx, "Test now");
            await waitForAgentButton(ctx, "Test now");
            await scrollToText(ctx, "Recommended action");
          },
          assert: async () => {
            const summary = await networkSummary(ctx);
            const healthGets = summary.requests.filter((request) => request.method === "GET" && request.url.includes(`/workspace/${state.workspaceId}/mcp/openwork-cloud/health`));
            const reconcilePosts = summary.requests.filter((request) => request.method === "POST" && request.url.includes("/mcp/openwork-cloud/reconcile"));
            const tokenMints = summary.desktopFetches.filter((request) => request.method === "POST" && request.url.includes("/v1/mcp/token"));
            witness(ctx, healthGets.length >= 1 && reconcilePosts.length === 0 && tokenMints.length === 0, "Test now made GET health requests only: no reconcile POST and no Den MCP token mint.", {
              healthGets: healthGets.length,
              reconcilePosts: reconcilePosts.length,
              tokenMints: tokenMints.length,
            });
            const markerAfter = await readMarker(ctx);
            witness(ctx, markerAfter === state.markerBeforeTest, "Test now did not write or change the Cloud MCP sync marker.", { before: state.markerBeforeTest, after: markerAfter });
            const health = await getHealth(ctx);
            witness(ctx, health.usable === false && health.firstFailure?.code === "cloud_mcp_missing", "The exact workspace remains degraded after the read-only test.", { firstFailure: health.firstFailure });
          },
          screenshot: {
            name: "frame-3-test-now-read-only",
            requireText: ["Degraded", "Test now", "Repair and test"],
            rejectText: ["Something went wrong", "Repairing…"],
            hashIncludes: "/settings/connect",
          },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("Repair and test reconciles exactly this workspace, writes the marker only after usable health, and connects the engine", {
          voiceover: vo[3],
          action: async () => {
            await installNetworkProbe(ctx, "repair-and-test");
            state.markerBeforeRepair = await readMarker(ctx);
            await clickAgentAccessButton(ctx, "Repair and test");
            await ctx.waitForText("Ready", { timeoutMs: 120_000 });
            await waitForAgentButton(ctx, "Repair and test");
            await scrollToText(ctx, "Agent access to connected services");
          },
          assert: async () => {
            const summary = await networkSummary(ctx);
            const posts = summary.requests.filter((request) => request.method === "POST" && request.url.includes(`/workspace/${state.workspaceId}/mcp/openwork-cloud/reconcile`));
            witness(ctx, posts.length === 1 && posts[0].body?.workspaceId === state.workspaceId && posts[0].body?.name === CLOUD_MCP_NAME && posts[0].body?.hasAuthorization === true, "Repair posted one sanitized reconcile request to the exact workspace route and body.", posts.map((post) => post.body));
            const tokenMints = summary.desktopFetches.filter((request) => request.method === "POST" && request.url.includes("/v1/mcp/token"));
            witness(ctx, tokenMints.length === 1, "Repair minted one Den MCP token through the desktop fetch bridge.", { tokenMints: tokenMints.length });
            state.readyHealth = await waitForHealth(ctx, (health) => health.usable === true && health.workspace.id === state.workspaceId && health.firstFailure === null, "usable health after repair");
            const markerAfter = await readMarker(ctx);
            witness(ctx, !state.markerBeforeRepair && typeof markerAfter === "string" && markerAfter.includes(state.workspaceId), "The sync marker was absent before repair and written only after usable health returned.", { before: state.markerBeforeRepair, afterPresent: Boolean(markerAfter) });
            witness(ctx, state.readyHealth.delivery.desiredRevision === state.readyHealth.delivery.appliedRevision && state.readyHealth.engine.status === "connected", "Health shows desired/applied revisions match and the engine is connected.", {
              desiredRevision: state.readyHealth.delivery.desiredRevision,
              appliedRevision: state.readyHealth.delivery.appliedRevision,
              engine: state.readyHealth.engine.status,
            });
          },
          screenshot: {
            name: "frame-4-repair-ready",
            requireText: ["Ready", "No action needed.", "Repair and test"],
            rejectText: ["Degraded", "Something went wrong"],
            hashIncludes: "/settings/connect",
          },
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        await ctx.prove("Ready health exposes both OpenWork Cloud tools to the selected model and Den /mcp/agent exposes exactly two unprefixed tools", {
          voiceover: vo[4],
          action: async () => {
            await scrollToText(ctx, EXPECTED_TOOL_IDS[0]);
          },
          assert: async () => {
            const health = await getHealth(ctx);
            witness(ctx, health.workspace.id === state.workspaceId && health.usable === true && health.firstFailure === null, "Live health is usable for the exact workspace with no firstFailure.", {
              workspaceId: health.workspace.id,
              firstFailure: health.firstFailure,
            });
            assertExpectedTools(ctx, health.tools.present, "health.tools.present");
            witness(ctx, health.tools.missing.length === 0, "No expected OpenWork Cloud tools are missing.", { missing: health.tools.missing });
            if (state.model) {
              witness(ctx, health.tools.providerProjection.checked === true && health.tools.providerProjection.provider === state.model.provider && health.tools.providerProjection.model === state.model.model, "Provider projection was checked for the selected provider/model.", health.tools.providerProjection);
              assertExpectedTools(ctx, health.tools.providerProjection.present, "providerProjection.present");
              witness(ctx, health.tools.providerProjection.missing.length === 0, "Provider projection has no missing Cloud tools.", { missing: health.tools.providerProjection.missing });
            }
            witness(ctx, health.pluginCanaries.present.includes(PLUGIN_CANARY) && health.pluginCanaries.missing.length === 0, "Plugin canary tools are present and not missing.", health.pluginCanaries);
            const listed = await serverFetchJson(ctx, `/workspace/${encodeURIComponent(state.workspaceId)}/mcp`);
            const cloud = listed.items.find((item) => item.name === CLOUD_MCP_NAME);
            witness(ctx, Boolean(cloud) && listed.engineSync?.status === "ok", "Workspace MCP status includes openwork-cloud and engine sync is ok.", {
              names: listed.items.map((item) => item.name),
              engineSync: listed.engineSync,
            });
            const minted = await mintDenMcpToken(ctx);
            const agentTools = await mcpAgentCall(ctx, minted.token, "tools/list", {});
            const names = agentTools.tools.map((tool) => tool.name).sort();
            witness(ctx, names.length === 2 && names.join(",") === EXPECTED_AGENT_TOOLS.join(","), "Den /mcp/agent tools/list exposes exactly the two unprefixed agent tools.", { tools: names });
            const search = await mcpAgentCall(ctx, minted.token, "tools/call", { name: "search_capabilities", arguments: { query: CONNECTION_BASE_NAME, type: "mcp", limit: 5 } });
            const parsed = JSON.parse(search.content?.[0]?.text ?? "{}");
            const expectedCapability = `mcp:${state.connectionId}:${FIXTURE_TOOL_NAME}`;
            witness(ctx, (parsed.matches ?? []).some((match) => match.name === expectedCapability), "Den agent capability search can discover the connected fixture before chat uses it.", { expectedCapability, matches: (parsed.matches ?? []).map((match) => match.name) });
            state.readyHealth = health;
          },
          screenshot: {
            name: "frame-5-tool-ids-ready",
            requireText: [EXPECTED_TOOL_IDS[0], EXPECTED_TOOL_IDS[1], "Current model can use these Cloud tools."],
            rejectText: ["Something went wrong", "Current model cannot use"],
            hashIncludes: "/settings/connect",
          },
        });
      },
    },
    {
      name: "Frame 6",
      run: async (ctx) => {
        await ctx.prove("Advanced Settings shows safe Cloud MCP diagnostics and copies a sanitized report without credentials", {
          voiceover: vo[5],
          action: async () => {
            await ctx.navigateHash(`/workspace/${state.workspaceId}/settings/advanced`);
            await ctx.expectHashIncludes("/settings/advanced");
            await ctx.waitForText("Agent access diagnostics", { timeoutMs: 60_000 });
            const hasHealth = await ctx.eval("document.body.innerText.includes('Active workspace')");
            if (!hasHealth) {
              await ctx.eval(`(() => {
                const section = [...document.querySelectorAll('section, div')].find((entry) => (entry.textContent || '').includes('Agent access diagnostics'));
                const button = [...(section?.querySelectorAll('button') ?? [])].find((entry) => (entry.textContent || '').trim() === 'Refresh');
                button?.click();
                return Boolean(button);
              })()`);
            }
            await ctx.waitForText("Active workspace", { timeoutMs: 60_000 });
            await scrollToText(ctx, "Plugin hashes");
            await ctx.clickText("Copy sanitized diagnostic", { timeoutMs: 30_000 });
            await ctx.waitForText("Copied sanitized Cloud diagnostic.", { timeoutMs: 15_000 });
          },
          assert: async () => {
            const clipboard = await ctx.eval("navigator.clipboard.readText()", { awaitPromise: true });
            ctx.assert(typeof clipboard === "string" && clipboard.trim().startsWith("{"), "Clipboard did not contain JSON diagnostics.");
            const parsed = JSON.parse(clipboard);
            const health = parsed.cloudMcpHealth;
            ctx.assert(health?.workspace?.id === state.workspaceId, "Diagnostic workspace id was not preserved.");
            ctx.assert(health.desired?.revision === state.readyHealth.desired.revision, "Diagnostic desired revision was not preserved.");
            ctx.assert(health.delivery?.appliedRevision === state.readyHealth.delivery.appliedRevision, "Diagnostic applied revision was not preserved.");
            assertExpectedTools(ctx, health.tools?.present ?? [], "diagnostic tools.present");
            const secrets = [
              state.serverAuth?.token,
              state.serverAuth?.hostToken,
              state.mcpToken,
              await ctx.eval("localStorage.getItem('openwork.den.authToken')"),
            ];
            assertNoSecretText(ctx, clipboard, secrets);
            witness(ctx, true, "Copied diagnostic preserves safe workspace/revision/tool IDs and excludes Den/MCP/server/host tokens.", {
              workspaceId: health.workspace.id,
              desiredRevision: health.desired.revision,
              appliedRevision: health.delivery.appliedRevision,
              tools: health.tools.present,
            });
          },
          screenshot: {
            name: "frame-6-advanced-sanitized-diagnostic",
            requireText: ["Agent access diagnostics", "Active workspace", "Desired revision", "Applied revision", "Delivery", "OpenWork versions", "OpenCode compatibility", "Plugin hashes", "Copied sanitized Cloud diagnostic."],
            rejectText: ["Bearer ", "ow_mcp_at_", "No Cloud MCP health"],
            hashIncludes: "/settings/advanced",
          },
        });
      },
    },
    {
      name: "Frame 7",
      run: async (ctx) => {
        await ctx.prove("A fresh real task searches Cloud capabilities before executing the connected fixture and does not substitute docs search", {
          voiceover: vo[6],
          action: async () => {
            await ctx.navigateHash(`/workspace/${state.workspaceId}/session`);
            await ctx.waitFor(`window.location.hash.includes(${quoted(`/workspace/${state.workspaceId}/session`)})`, { timeoutMs: 45_000, label: "session route" });
            await ctx.waitFor(
              "window.__openworkControl?.listActions?.().find((item) => item.id === 'session.create_task' && !item.disabled)",
              { timeoutMs: 45_000, label: "session.create_task enabled" },
            );
            await ctx.control("session.create_task");
            await ctx.waitFor("window.location.hash.includes('/session/ses_')", { timeoutMs: 45_000, label: "fresh task session" });
            state.chatStartedAt = new Date().toISOString();
            const prompt = `Please run the reliability check in my connected service named ${CONNECTION_BASE_NAME}. Reply with the exact marker it returns.`;
            await ctx.control("composer.set_text", { text: prompt });
            await ctx.waitFor(
              "window.__openworkControl?.listActions?.().find((item) => item.id === 'composer.send' && !item.disabled)",
              { timeoutMs: 30_000, label: "composer.send enabled" },
            );
            await ctx.control("composer.send");
          },
          assert: async () => {
            await ctx.waitFor("!Boolean([...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Stop'))", { timeoutMs: 240_000, label: "assistant finished" });
            await ctx.waitForText(RESULT_MARKER, { timeoutMs: 60_000 });
            const transcript = await ctx.control("session.read_transcript", { count: 30 });
            const transcriptText = (transcript.messages ?? []).map((message) => message.text).join("\n---\n");
            const searchIndex = transcriptText.indexOf("[tool:openwork-cloud_search_capabilities]");
            const executeIndex = transcriptText.indexOf("[tool:openwork-cloud_execute_capability]");
            witness(ctx, searchIndex >= 0 && executeIndex > searchIndex, "Transcript tool order is openwork-cloud_search_capabilities before openwork-cloud_execute_capability.", { searchIndex, executeIndex });
            witness(ctx, !transcriptText.includes(PLUGIN_CANARY), "Transcript did not substitute OpenWork documentation search for the connected-service action.", { containsDocsSearch: transcriptText.includes(PLUGIN_CANARY) });
            const freshExecutions = state.fixtureExecutions.filter((entry) => !state.chatStartedAt || entry.at >= state.chatStartedAt);
            witness(ctx, freshExecutions.length >= 1, "The external Cloud Reliability Check fixture observed a real tools/call execution from the task.", freshExecutions.map((entry) => ({ at: entry.at, toolName: entry.toolName })));
            const latest = await ctx.control("session.latest_message");
            witness(ctx, latest.role === "assistant" && latest.text.includes(RESULT_MARKER), "The final visible task output includes the unique fixture result marker.", { role: latest.role, includesMarker: latest.text.includes(RESULT_MARKER) });
            await ctx.control("session.scroll_bottom");
          },
          screenshot: {
            name: "frame-7-real-task-fixture-executed",
            requireText: [RESULT_MARKER, CONNECTION_BASE_NAME],
            rejectText: ["openwork_docs_search", "Something went wrong"],
            hashIncludes: "/session",
          },
        });
      },
    },
    {
      name: "Cleanup fixture resources",
      run: async (ctx) => {
        if (state.connectionId) {
          await denFetch(ctx, `/v1/mcp-connections/${encodeURIComponent(state.connectionId)}`, { method: "DELETE" }).catch((error) => {
            ctx.log(`Fixture connection cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        if (state.fixtureServer) {
          state.fixtureServer.close();
          state.fixtureServer = null;
        }
        await ctx.eval(`(() => {
          const probe = window.__cloudMcpReliabilityProbe;
          if (probe?.originalFetch) window.fetch = probe.originalFetch;
          if (probe?.originalInvoke && window.__OPENWORK_ELECTRON__) window.__OPENWORK_ELECTRON__.invokeDesktop = probe.originalInvoke;
          delete window.__cloudMcpReliabilityProbe;
          return true;
        })()`).catch(() => null);
      },
    },
  ],
};
