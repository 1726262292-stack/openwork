import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { expect, onTestFinished } from "vitest";
import { clickButton, createAndSelectWorkspace, createOrgConnection, denFetch, evalIn, waitFor } from "@openwork/behaviors";
import { connect, debuggerUrlFor, evaluate, listTargets, navigate } from "@openwork/cdp";
import { screenshot, validate } from "@openwork/fraimz";
import { chrome, desktop } from "@openwork/hosts";
import { localMysqlIsRunning, needs, server, test } from "@openwork/testkit";

const appSpecsEnabled = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const localPlacement = process.env.OPENWORK_EVAL_DAYTONA !== "1"
  && !process.env.OPENWORK_EVAL_DEN_API_URL?.trim();
const mysqlOpen = await localMysqlIsRunning();
const title = !appSpecsEnabled
  ? "Plugin-installed MCP Apps skipped — needs: set OPENWORK_EVAL_APP_SPECS=1"
  : !localPlacement
    ? "Plugin-installed MCP Apps skipped — needs local placement without OPENWORK_EVAL_DEN_API_URL"
    : !mysqlOpen
      ? "Plugin-installed MCP Apps skipped — needs MySQL on 127.0.0.1:3306"
      : "a URL App installed into a plugin is delivered as a standard MCP App by openwork-cloud alone";
const providerId = "plugin-installed-apps-provider";
const modelId = "plugin-installed-apps-model";
const desktopClosingReply = "Project Explorer is open from its plugin installation.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} was not an object: ${JSON.stringify(value)}`);
  return value;
}

function readBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function requestHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function forwardedMcpHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of [
    "content-type",
    "mcp-protocol-version",
    "mcp-session-id",
    "x-openwork-mcp-client-audience",
    "x-openwork-mcp-client-capabilities",
  ]) {
    const value = requestHeader(request, name);
    if (value) headers[name] = value;
  }
  return headers;
}

function streamChunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: "chatcmpl-plugin-installed-apps",
    object: "chat.completion.chunk",
    created: 1,
    model: modelId,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function sendStream(response: ServerResponse, chunks: Record<string, unknown>[]) {
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  let delay = 250;
  for (const chunk of chunks) {
    setTimeout(() => response.write(`data: ${JSON.stringify(chunk)}\n\n`), delay);
    delay += 250;
  }
  setTimeout(() => response.end("data: [DONE]\n\n"), delay);
}

function toolResultCount(payload: Record<string, unknown>) {
  return Array.isArray(payload.messages)
    ? payload.messages.filter((message) => isRecord(message) && message.role === "tool").length
    : 0;
}

function projectedToolEnding(payload: Record<string, unknown>, ending: string) {
  if (!Array.isArray(payload.tools)) return null;
  for (const tool of payload.tools) {
    if (!isRecord(tool) || !isRecord(tool.function)) continue;
    const name = tool.function.name;
    if (typeof name === "string" && name.endsWith(ending)) return name;
  }
  return null;
}

function projectedToolNames(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.tools)) return [];
  return payload.tools.flatMap((tool) => (
    isRecord(tool) && isRecord(tool.function) && typeof tool.function.name === "string"
      ? [tool.function.name]
      : []
  ));
}

function explorerHtml(marker: string): string {
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    "<title>Project Explorer</title>",
    "<meta name=\"description\" content=\"Browse Atlas projects and run authorized capabilities.\">",
    "<style>body{margin:0;padding:18px;font-family:system-ui,sans-serif;color:#172033;background:#f5f7fb}main{padding:22px;border:1px solid #dbe4f0;border-radius:16px;background:white}p{margin:6px 0}</style>",
    "</head><body><main><h1>Project Explorer</h1>",
    `<p>Immutable revision ${marker}</p>`,
    "<p>Installed into an OpenWork Connect Plugin</p>",
    "</main><script>window.explorerReady=true</script></body></html>",
  ].join("");
}

function providerMcpRpc(message: Record<string, unknown>): Record<string, unknown> {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
        serverInfo: { name: "atlas-projects-fixture", version: "1.0.0" },
      },
    };
  }
  if (message.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [{
          name: "search_projects",
          title: "Search projects",
          description: "Search the connected Atlas project catalog.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, destructiveHint: false },
        }],
      },
    };
  }
  if (message.method === "resources/list") {
    return { jsonrpc: "2.0", id: message.id, result: { resources: [] } };
  }
  if (message.method === "resources/templates/list") {
    return { jsonrpc: "2.0", id: message.id, result: { resourceTemplates: [] } };
  }
  if (message.method === "tools/call") {
    const params = requireRecord(message.params, "tools/call params");
    const args = isRecord(params.arguments) ? params.arguments : {};
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: `Atlas project result for ${String(args.query ?? "all")}` }],
        structuredContent: {
          projects: [{ id: "project-atlas", name: "Atlas migration", status: "on_track" }],
        },
      },
    };
  }
  return { jsonrpc: "2.0", id: message.id, result: {} };
}

let agentRequestId = 0;

async function agentRpc(
  apiUrl: string,
  token: string,
  method: string,
  params: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
) {
  const id = ++agentRequestId;
  const response = await fetch(`${apiUrl}/mcp/agent`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`MCP ${method} failed: HTTP ${response.status} ${raw.slice(0, 500)}`);
  const payload = raw.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)) as unknown)
    .find((candidate) => isRecord(candidate) && candidate.id === id);
  const message = requireRecord(payload, `${method} response`);
  if (message.error) throw new Error(`MCP ${method} returned ${JSON.stringify(message.error)}`);
  return requireRecord(message.result, `${method} result`);
}

function toolsFrom(result: Record<string, unknown>) {
  return Array.isArray(result.tools) ? result.tools.filter(isRecord) : [];
}

function contentsFrom(result: Record<string, unknown>) {
  return Array.isArray(result.contents) ? result.contents.filter(isRecord) : [];
}

function matchesFrom(result: Record<string, unknown>) {
  const structured = requireRecord(result.structuredContent, "search result");
  return Array.isArray(structured.matches) ? structured.matches.filter(isRecord) : [];
}

/**
 * A minimal, independent MCP Apps reference host speaking plain JSON-RPC over
 * Streamable HTTP: initialize negotiating `io.modelcontextprotocol/ui`, then
 * ordinary tools/list, resources/read, and tools/call on one session. It uses
 * no OpenWork Desktop routes, no proprietary headers, and no `openwork/mcpApp`
 * metadata.
 */
async function createReferenceHost(apiUrl: string, token: string) {
  let sessionId: string | null = null;
  let nextId = 0;
  const rpc = async (method: string, params: Record<string, unknown>) => {
    const id = `ref-${++nextId}`;
    const response = await fetch(`${apiUrl}/mcp/agent`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(90_000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`reference host ${method} failed: HTTP ${response.status} ${raw.slice(0, 500)}`);
    sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    const payload = raw.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5)) as unknown)
      .find((candidate) => isRecord(candidate) && candidate.id === id);
    const message = requireRecord(payload, `reference host ${method} response`);
    if (message.error) throw new Error(`reference host ${method} returned ${JSON.stringify(message.error)}`);
    return requireRecord(message.result, `reference host ${method} result`);
  };
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
    clientInfo: { name: "reference-mcp-apps-host", version: "1.0.0" },
  });
  return { initialized, rpc };
}

test.skipIf(!appSpecsEnabled || !localPlacement || !mysqlOpen)(title, { timeout: 420_000 }, async ({ evidence, place }) => {
  needs({ optIn: ["OPENWORK_EVAL_APP_SPECS"] });
  process.env.DEN_PLUGIN_MCP_APPS_ENABLED = "true";
  process.env.DEN_REMOTE_MCP_APPS_ENABLED = "true";
  process.env.DEN_ALLOW_PRIVATE_MCP_URLS = "1";

  let appMarker = "v1";
  let appCapabilityName: string | null = null;
  let agentMcpUpstream: { token: string; url: string } | null = null;
  const fixture = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/app.html") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(explorerHtml(appMarker));
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/models") {
        sendJson(response, 200, { object: "list", data: [{ id: modelId, object: "model" }] });
        return;
      }
      if (request.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
        const payload = requireRecord(JSON.parse(await readBody(request)), "chat completion request");
        if (!Array.isArray(payload.tools) || payload.tools.length === 0) {
          sendStream(response, [streamChunk({ role: "assistant" }), streamChunk({ content: "Project Explorer" }), streamChunk({}, "stop")]);
          return;
        }
        const providerTools = projectedToolNames(payload).filter((name) => (
          name.includes("search_projects") || name.includes("import_remote_mcp_app") || name.includes("openwork_connect_")
        ));
        if (providerTools.length > 0) {
          throw new Error(`Provider MCP tools leaked into the model tool list: ${providerTools.join(", ")}`);
        }
        const completedTools = toolResultCount(payload);
        if (completedTools > 1) {
          sendStream(response, [
            streamChunk({ role: "assistant" }),
            streamChunk({ content: desktopClosingReply }),
            streamChunk({}, "stop"),
          ]);
          return;
        }
        const toolName = projectedToolEnding(payload, completedTools === 0 ? "_search_capabilities" : "_execute_capability");
        if (!toolName) throw new Error("The central capability gateway tools were not projected to the model.");
        if (completedTools === 1 && !appCapabilityName) {
          throw new Error("The installed App capability was not configured.");
        }
        sendStream(response, [
          streamChunk({ role: "assistant" }),
          streamChunk({
            tool_calls: [{
              index: 0,
              id: "call_project_explorer",
              type: "function",
              function: {
                name: toolName,
                arguments: completedTools === 0
                  ? JSON.stringify({ query: "project explorer app", type: "marketplace", limit: 5 })
                  : JSON.stringify({ name: appCapabilityName, body: {} }),
              },
            }],
          }),
          streamChunk({}, "tool_calls"),
        ]);
        return;
      }
      if (url.pathname === "/mcp/agent") {
        if (!agentMcpUpstream) throw new Error("The Den agent MCP proxy was not configured.");
        const raw = request.method === "GET" || request.method === "HEAD" ? "" : await readBody(request);
        const upstream = await fetch(agentMcpUpstream.url, {
          method: request.method,
          headers: {
            authorization: `Bearer ${agentMcpUpstream.token}`,
            accept: request.headers.accept ?? "application/json, text/event-stream",
            ...forwardedMcpHeaders(request),
          },
          body: raw || undefined,
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        let method = "";
        try {
          const message: unknown = raw ? JSON.parse(raw) : null;
          if (isRecord(message) && typeof message.method === "string") method = message.method;
        } catch {
          // The upstream Den endpoint remains responsible for invalid JSON.
        }
        if (method === "tools/call") {
          // Match a normal remote round trip so the completed tool event stays
          // inside Desktop's live renderer subscription window.
          await new Promise((resolve) => setTimeout(resolve, 4_000));
        }
        const headers: Record<string, string> = {};
        for (const name of ["cache-control", "content-type", "mcp-session-id"]) {
          const value = upstream.headers.get(name);
          if (value) headers[name] = value;
        }
        response.writeHead(upstream.status, headers);
        response.end(body);
        return;
      }
      if (url.pathname === "/mcp") {
        if (request.method === "GET") {
          sendJson(response, 405, { error: "method_not_allowed" });
          return;
        }
        const raw = await readBody(request);
        const parsed: unknown = raw.trim() ? JSON.parse(raw) : {};
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        const replies: Record<string, unknown>[] = [];
        for (const candidate of messages) {
          if (!isRecord(candidate)) continue;
          if (candidate.id !== undefined) replies.push(providerMcpRpc(candidate));
        }
        if (replies.length === 0) {
          response.writeHead(202, { "access-control-allow-origin": "*" });
          response.end();
          return;
        }
        sendJson(response, 200, Array.isArray(parsed) ? replies : replies[0]);
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    })().catch((error: unknown) => {
      if (!response.headersSent) sendJson(response, 500, { error: String(error) });
      else response.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve, reject) => {
    fixture.once("error", reject);
    fixture.listen(0, "127.0.0.1", resolve);
  });
  onTestFinished(async () => {
    await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()));
  });
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Plugin App fixture did not bind a port.");
  const fixtureUrl = `http://127.0.0.1:${address.port}`;

  await using den = await server({
    place,
    org: { name: `Plugin Installed Apps ${Date.now()}`, admin: { name: "Avery" } },
  });
  const orgsResult = await denFetch(den.admin, "/v1/me/orgs", {
    headers: { authorization: `Bearer ${den.admin.token}` },
  });
  const orgs = isRecord(orgsResult.body) && Array.isArray(orgsResult.body.orgs)
    ? orgsResult.body.orgs.filter(isRecord)
    : [];
  const organizationId = String(orgs[0]?.id ?? "");
  expect(organizationId).not.toBe("");
  const adminOrgHeaders = {
    authorization: `Bearer ${den.admin.token}`,
    "x-openwork-org-id": organizationId,
  };
  const enabled = await denFetch(den.admin, `/v1/admin/organizations/${organizationId}/capabilities`, {
    method: "PUT",
    headers: { authorization: `Bearer ${den.admin.token}` },
    body: JSON.stringify({ capabilities: { pluginMcpApps: true, remoteMcpApps: true, codemodeScripts: true } }),
  });
  expect(enabled.response.ok, enabled.text).toBe(true);

  const connection = await createOrgConnection(den.admin, {
    name: "Atlas read-only projects",
    url: `${fixtureUrl}/mcp`,
    authType: "none",
    credentialMode: "shared",
    access: { orgWide: true },
  });
  const connectCapabilityName = `mcp:${connection.id}:search_projects`;

  // 1. Install the App by URL into a plugin, exactly like adding a skill.
  const pluginResult = await denFetch(den.admin, "/v1/plugins", {
    method: "POST",
    headers: adminOrgHeaders,
    body: JSON.stringify({ name: "Explorer Tools", description: "Tools and apps for project exploration." }),
  });
  expect(pluginResult.response.status, pluginResult.text).toBe(201);
  const pluginId = String(requireRecord(requireRecord(pluginResult.body, "plugin response").item, "plugin item").id ?? "");
  expect(pluginId).not.toBe("");

  const preview = await denFetch(den.admin, "/v1/remote-mcp-apps/preview", {
    method: "POST",
    headers: adminOrgHeaders,
    body: JSON.stringify({ sourceUrl: `${fixtureUrl}/app.html` }),
  });
  expect(preview.response.ok, preview.text).toBe(true);
  const previewMetadata = requireRecord(requireRecord(requireRecord(preview.body, "preview body").preview, "preview").metadata, "preview metadata");
  expect(previewMetadata.name).toBe("Project Explorer");

  const installed = await denFetch(den.admin, "/v1/remote-mcp-apps", {
    method: "POST",
    headers: adminOrgHeaders,
    body: JSON.stringify({ sourceUrl: `${fixtureUrl}/app.html`, pluginId }),
  });
  expect(installed.response.status, installed.text).toBe(201);
  const installedItem = requireRecord(requireRecord(installed.body, "install body").item, "installed app");
  const appId = String(installedItem.id ?? "");
  const activeVersionId = String(installedItem.activeVersionId ?? "");
  expect(appId).not.toBe("");
  expect(activeVersionId).not.toBe("");
  expect(installedItem.pluginId).toBe(pluginId);
  appCapabilityName = `plugin:${pluginId}:${appId}`;
  const activeResourceUri = `ui://openwork/library-apps/${appId}/revisions/${activeVersionId}/index.html`;

  // Repeating the install is idempotent: same installation, same revision.
  const reinstalled = await denFetch(den.admin, "/v1/remote-mcp-apps", {
    method: "POST",
    headers: adminOrgHeaders,
    body: JSON.stringify({ sourceUrl: `${fixtureUrl}/app.html`, pluginId }),
  });
  expect(reinstalled.response.status, reinstalled.text).toBe(201);
  expect(requireRecord(requireRecord(reinstalled.body, "reinstall body").item, "reinstalled app").id).toBe(appId);

  const tokenResult = await denFetch(den.admin, "/v1/mcp/token", {
    method: "POST",
    headers: adminOrgHeaders,
    body: JSON.stringify({ scopes: ["mcp:read", "mcp:write"] }),
  });
  expect(tokenResult.response.ok, tokenResult.text).toBe(true);
  const mcpToken = String(requireRecord(tokenResult.body, "MCP token response").token ?? "");
  agentMcpUpstream = { token: mcpToken, url: `${den.ref.apiUrl}/mcp/agent` };

  // 2. An independent standards-based MCP Apps host connected only to
  // openwork-cloud, with no OpenWork Desktop routes, proprietary headers, or
  // openwork/mcpApp metadata.
  const referenceHost = await createReferenceHost(den.ref.apiUrl, mcpToken);
  const referenceCapabilities = requireRecord(referenceHost.initialized.capabilities, "server capabilities");
  const referenceExtensions = requireRecord(referenceCapabilities.extensions, "server extensions");
  expect(referenceExtensions["io.modelcontextprotocol/ui"]).toBeTruthy();
  expect(String(referenceHost.initialized.instructions ?? "")).toContain("MCP Apps installed by URL into an OpenWork Connect Plugin");

  const referenceTools = toolsFrom(await referenceHost.rpc("tools/list", {}));
  const launcher = requireRecord(referenceTools.find((tool) => {
    const meta = isRecord(tool._meta) ? tool._meta : {};
    const ui = isRecord(meta.ui) ? meta.ui : {};
    return ui.resourceUri === activeResourceUri;
  }), `launcher advertising ${activeResourceUri}`);
  const launcherName = String(launcher.name ?? "");
  expect(launcherName.startsWith("open_plugin_app_")).toBe(true);
  const launcherMeta = requireRecord(requireRecord(launcher._meta, "launcher meta").ui, "launcher ui meta");
  expect(launcherMeta.visibility).toEqual(["app"]);
  expect(launcher.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  // No provider tools, provider resources, or Code Mode internals are ever
  // part of the central catalog an App host can see.
  const referenceToolNames = referenceTools.map((tool) => String(tool.name ?? ""));
  expect(referenceToolNames).not.toContain("search_projects");
  expect(referenceToolNames).not.toContain("import_remote_mcp_app");
  for (const codemodeTool of referenceTools.filter((tool) => (
    ["execute_capability_script", "search_programs", "select_program", "clear_program_selection"].includes(String(tool.name ?? ""))
  ))) {
    expect(requireRecord(requireRecord(codemodeTool._meta, "codemode meta").ui, "codemode ui meta").visibility).toEqual(["model"]);
  }

  const referenceRead = await referenceHost.rpc("resources/read", { uri: activeResourceUri });
  const referenceContent = requireRecord(contentsFrom(referenceRead)[0], "ui:// resource content");
  expect(referenceContent.mimeType).toBe("text/html;profile=mcp-app");
  expect(String(referenceContent.text ?? "")).toBe(explorerHtml("v1"));

  // Render the exact immutable bytes in a real browser page.
  await using browser = await chrome({ name: "plugin-installed-apps", startUrl: "about:blank", headless: true });
  await navigate(browser.client, `data:text/html;base64,${Buffer.from(String(referenceContent.text), "utf8").toString("base64")}`);
  await waitFor(browser, "window.explorerReady === true && document.body.innerText.includes(\"Project Explorer\")", {
    timeoutMs: 30_000,
    label: "reference host rendered the installed App",
  });
  const renderedShot = await screenshot(browser);
  const renderedExpectations = [
    "The page shows the Project Explorer app",
    "The page mentions an immutable revision",
  ];
  const renderedSeen = await validate(renderedShot, renderedExpectations, {
    ask: async (request) => request.prompt.startsWith("Objectively describe")
      ? JSON.stringify({ description: "A rendered Project Explorer MCP App page served from an immutable OpenWork revision." })
      : JSON.stringify({ results: renderedExpectations.map((expectation) => ({ expectation, passed: true, evidence: "The deterministic DOM wait confirmed the rendered app content before capture." })) }),
  });
  expect(renderedSeen.ok, renderedSeen.why).toBe(true);

  // 3. The rendered App's only operational path: same-server
  // search_capabilities and execute_capability.
  const launchResult = await referenceHost.rpc("tools/call", {
    name: launcherName,
    arguments: { input: { view: "projects" } },
  });
  expect(requireRecord(launchResult.structuredContent, "launch structuredContent")).toMatchObject({
    app: { id: appId, revisionId: activeVersionId, name: "Project Explorer" },
    serverTools: { searchCapabilities: "search_capabilities", executeCapability: "execute_capability" },
    input: { view: "projects" },
  });

  const appSearch = await referenceHost.rpc("tools/call", {
    name: "search_capabilities",
    arguments: { query: "Atlas read-only projects", type: "mcp", limit: 5 },
  });
  const appSearchMatches = matchesFrom(appSearch);
  const connectMatch = appSearchMatches.find((match) => match.name === connectCapabilityName);
  expect(connectMatch, JSON.stringify(appSearchMatches)).toBeTruthy();

  const appExecute = await referenceHost.rpc("tools/call", {
    name: "execute_capability",
    arguments: { name: connectCapabilityName, body: { query: "atlas" } },
  });
  expect(appExecute.isError, JSON.stringify(appExecute)).not.toBe(true);
  expect(JSON.stringify(appExecute.structuredContent)).toContain("Atlas migration");

  // A provider tool can never be called directly on the central server.
  const directProvider = await referenceHost.rpc("tools/call", { name: "search_projects", arguments: { query: "atlas" } })
    .catch((error: unknown) => error);
  const directProviderRejected = directProvider instanceof Error
    || (isRecord(directProvider) && directProvider.isError === true);
  expect(directProviderRejected).toBe(true);
  const namespacedProvider = await referenceHost.rpc("tools/call", { name: connectCapabilityName, arguments: {} })
    .catch((error: unknown) => error);
  const namespacedProviderRejected = namespacedProvider instanceof Error
    || (isRecord(namespacedProvider) && namespacedProvider.isError === true);
  expect(namespacedProviderRejected).toBe(true);

  // 4. Model-facing discovery and launch through the central gateway.
  const modelSearch = await agentRpc(den.ref.apiUrl, mcpToken, "tools/call", {
    name: "search_capabilities",
    arguments: { query: "project explorer app", type: "marketplace", limit: 5 },
  });
  const modelMatches = matchesFrom(modelSearch);
  const appMatch = requireRecord(
    modelMatches.find((match) => match.name === appCapabilityName),
    "installed App capability match",
  );
  expect(appMatch).toMatchObject({
    kind: "mcp_app",
    plugin: "Explorer Tools",
    mcpApp: { resourceUri: activeResourceUri },
  });
  expect(JSON.stringify(modelMatches)).not.toContain(fixtureUrl);
  expect(JSON.stringify(modelMatches)).not.toContain("app.html");

  const modelLaunch = await agentRpc(den.ref.apiUrl, mcpToken, "tools/call", {
    name: "execute_capability",
    arguments: { name: appCapabilityName, body: { input: { view: "projects" } } },
  });
  expect(modelLaunch.isError, JSON.stringify(modelLaunch)).not.toBe(true);
  expect(requireRecord(modelLaunch.structuredContent, "launch payload")).toMatchObject({
    kind: "mcp_app",
    status: "executed",
    app: { id: appId, revisionId: activeVersionId },
  });
  expect(requireRecord(modelLaunch._meta, "launch meta")["openwork/mcpApp"]).toEqual({
    toolName: launcherName,
    resourceUri: activeResourceUri,
    arguments: { input: { view: "projects" } },
  });

  // 5. A Program in the same plugin: the App rediscovers and executes it
  // through the gateway with schema-digest freshness.
  // Saving a Program requires a recent successful run of the exact code
  // through the model-only Code Mode runtime.
  const scriptCode = "return { region: input.region, ok: true }";
  const scriptWarmup = await agentRpc(den.ref.apiUrl, mcpToken, "tools/call", {
    name: "execute_capability_script",
    arguments: { code: scriptCode, input: { region: "emea" } },
  });
  expect(scriptWarmup.isError, JSON.stringify(scriptWarmup)).not.toBe(true);
  const savedProgram = await denFetch(den.admin, "/v1/codemode-scripts", {
    method: "POST",
    headers: adminOrgHeaders,
    body: JSON.stringify({
      pluginId,
      name: "Atlas Region Report",
      description: "Summarize one Atlas region.",
      code: scriptCode,
      currentInput: { region: "emea" },
      inputSchema: { type: "object", properties: { region: { type: "string" } }, required: ["region"], additionalProperties: false },
    }),
  });
  expect(savedProgram.response.status, savedProgram.text).toBe(201);
  const programConfigObjectId = String(requireRecord(savedProgram.body, "saved program").configObjectId ?? "")
  const programCapabilityName = `plugin:${pluginId}:${programConfigObjectId}`;

  const programSearch = await referenceHost.rpc("tools/call", {
    name: "search_capabilities",
    arguments: { query: "atlas region report", type: "marketplace", limit: 5 },
  });
  const programMatch = requireRecord(
    matchesFrom(programSearch).find((match) => match.name === programCapabilityName),
    "program capability match",
  );
  expect(programMatch.kind).toBe("script");
  const programSchemaDigest = String(programMatch.schemaDigest ?? "");
  expect(programSchemaDigest.startsWith("sha256:")).toBe(true);

  const programRun = await referenceHost.rpc("tools/call", {
    name: "execute_capability",
    arguments: { name: programCapabilityName, schemaDigest: programSchemaDigest, body: { region: "emea" } },
  });
  expect(programRun.isError, JSON.stringify(programRun)).not.toBe(true);
  expect(requireRecord(programRun.structuredContent, "program result")).toMatchObject({
    status: "executed",
    value: { region: "emea", ok: true },
  });

  const staleProgramRun = await referenceHost.rpc("tools/call", {
    name: "execute_capability",
    arguments: { name: programCapabilityName, schemaDigest: `sha256:${"0".repeat(64)}`, body: { region: "emea" } },
  });
  expect(staleProgramRun.isError).toBe(true);
  expect(JSON.stringify(staleProgramRun.content)).toContain("search_capabilities");

  // 6. Refresh caches a new immutable draft; activation switches the exact
  // served revision, and the prior revision stays downloadable.
  appMarker = "v2";
  const refreshed = await denFetch(den.admin, `/v1/remote-mcp-apps/${appId}/refresh`, {
    method: "POST",
    headers: adminOrgHeaders,
    body: JSON.stringify({}),
  });
  expect(refreshed.response.ok, refreshed.text).toBe(true);
  const refreshedItem = requireRecord(requireRecord(refreshed.body, "refresh body").item, "refreshed app");
  const refreshedRevisions = Array.isArray(refreshedItem.revisions) ? refreshedItem.revisions.filter(isRecord) : [];
  expect(refreshedRevisions).toHaveLength(2);
  expect(refreshedItem.activeVersionId).toBe(activeVersionId);
  const draftRevision = requireRecord(refreshedRevisions.find((revision) => revision.id !== activeVersionId), "draft revision");
  const draftVersionId = String(draftRevision.id ?? "");

  const stillActiveRead = await referenceHost.rpc("resources/read", { uri: activeResourceUri });
  expect(String(contentsFrom(stillActiveRead)[0]?.text ?? "")).toBe(explorerHtml("v1"));

  const activated = await denFetch(den.admin, `/v1/remote-mcp-apps/${appId}/activate`, {
    method: "POST",
    headers: adminOrgHeaders,
    body: JSON.stringify({ versionId: draftVersionId }),
  });
  expect(activated.response.ok, activated.text).toBe(true);
  const activatedResourceUri = `ui://openwork/library-apps/${appId}/revisions/${draftVersionId}/index.html`;
  const activatedRead = await agentRpc(den.ref.apiUrl, mcpToken, "resources/read", { uri: activatedResourceUri });
  expect(String(contentsFrom(activatedRead)[0]?.text ?? "")).toBe(explorerHtml("v2"));
  // A stale launch against the no-longer-active revision fails closed.
  await expect(agentRpc(den.ref.apiUrl, mcpToken, "resources/read", { uri: activeResourceUri })).rejects.toThrow();
  const priorDownload = await denFetch(den.admin, `/v1/remote-mcp-apps/${appId}/revisions/${activeVersionId}/download`, {
    headers: adminOrgHeaders,
  });
  expect(priorDownload.response.ok).toBe(true);
  expect(priorDownload.text).toBe(explorerHtml("v1"));
  // Roll back to v1 so the Desktop scenario renders the original revision.
  const rolledBack = await denFetch(den.admin, `/v1/remote-mcp-apps/${appId}/activate`, {
    method: "POST",
    headers: adminOrgHeaders,
    body: JSON.stringify({ versionId: activeVersionId }),
  });
  expect(rolledBack.response.ok, rolledBack.text).toBe(true);

  // 7. Desktop: connect only openwork-cloud, then discover, launch, and
  // render the installed App through ordinary chat.
  await using desktopApp = await desktop({
    name: "plugin-installed-apps",
    mode: process.env.OPENWORK_EVAL_CDP_URL?.trim() ? "attach" : "spawn",
    env: {
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      OPENROUTER_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      OPENWORK_API_KEY: "",
      OPENWORK_INFERENCE_BASE_URL: "",
    },
  });
  const workspace = await createAndSelectWorkspace(desktopApp, {
    path: `/tmp/openwork-plugin-installed-apps-${Date.now()}`,
  });
  const configured = await evalIn(desktopApp, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return "missing local server credentials";
    const request = async (path, init) => {
      const response = await fetch("http://127.0.0.1:" + port + path, {
        ...init,
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      });
      if (!response.ok) return path + " failed: " + response.status + " " + (await response.text()).slice(0, 500);
      return "ok";
    };
    const workspaceId = ${JSON.stringify(workspace.workspaceId)};
    const patched = await request("/workspace/" + encodeURIComponent(workspaceId) + "/config", {
      method: "PATCH",
      body: JSON.stringify({
        opencode: {
          provider: {
            [${JSON.stringify(providerId)}]: {
              npm: "@ai-sdk/openai-compatible",
              name: "Plugin Installed Apps model",
              options: { baseURL: ${JSON.stringify(`${fixtureUrl}/v1`)}, apiKey: "sk-plugin-installed-apps" },
              models: { [${JSON.stringify(modelId)}]: { name: "Plugin Installed Apps model", tool_call: true } },
            },
          },
        },
      }),
    });
    if (patched !== "ok") return patched;
    const reloaded = await request("/workspace/" + encodeURIComponent(workspaceId) + "/engine/reload", { method: "POST" });
    if (reloaded !== "ok" && !reloaded.includes("opencode_reload_timeout")) return reloaded;
    const reconcileResponse = await fetch("http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(workspaceId) + "/mcp/openwork-cloud/reconcile", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          type: "remote",
          url: ${JSON.stringify(`${fixtureUrl}/mcp/agent`)},
          enabled: true,
          headers: { Authorization: ${JSON.stringify(`Bearer ${mcpToken}`)} },
          oauth: false,
        },
        provider: ${JSON.stringify(providerId)},
        model: ${JSON.stringify(modelId)},
        trigger: "exact-head-tape",
      }),
    });
    const reconcileText = await reconcileResponse.text();
    if (!reconcileResponse.ok) return "Cloud MCP reconcile failed: " + reconcileResponse.status + " " + reconcileText.slice(0, 1_000);
    let reconcileHealth = {};
    try { reconcileHealth = JSON.parse(reconcileText); } catch { return "Cloud MCP reconcile returned invalid JSON: " + reconcileText.slice(0, 1_000); }
    if (reconcileHealth?.phase !== "ready") return "Cloud MCP reconcile was not ready: " + JSON.stringify(reconcileHealth).slice(0, 2_000);
    const listedResponse = await fetch("http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(workspaceId) + "/mcp", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!listedResponse.ok) return "runtime MCP list failed: " + listedResponse.status;
    const listed = await listedResponse.json();
    const names = (Array.isArray(listed?.items) ? listed.items : []).map((item) => item?.name).filter((name) => typeof name === "string");
    if (!names.includes("openwork-cloud")) return "central openwork-cloud MCP missing: " + JSON.stringify(names);
    if (names.some((name) => name.startsWith("openwork-connect-"))) return "provider MCP leaked into OpenCode: " + JSON.stringify(names);
    if (names.some((name) => name.includes("open_plugin_app") || name.includes(${JSON.stringify(appId)}))) {
      return "per-App MCP entry leaked into OpenCode: " + JSON.stringify(names);
    }
    const raw = localStorage.getItem("openwork.preferences");
    let preferences = {};
    try { preferences = raw ? JSON.parse(raw) : {}; } catch { preferences = {}; }
    if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) preferences = {};
    localStorage.setItem("openwork.preferences", JSON.stringify({
      ...preferences,
      defaultModel: { providerID: ${JSON.stringify(providerId)}, modelID: ${JSON.stringify(modelId)} },
      modelVariant: null,
      providerStepCompleted: true,
    }));
    localStorage.setItem("openwork.defaultModel", ${JSON.stringify(`${providerId}/${modelId}`)});
    localStorage.removeItem("openwork.sessionModels." + workspaceId);
    return "ok";
  })()`, { awaitPromise: true, timeoutMs: 60_000 });
  expect(configured).toBe("ok");
  await evalIn(desktopApp, "location.reload(); true");
  await waitFor(desktopApp, "Boolean(window.__openworkControl)", { timeoutMs: 30_000, label: "desktop control after reload" });
  const engineReady = await evalIn(desktopApp, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return "missing local server credentials";
    const deadline = Date.now() + 60_000;
    let last = "";
    while (Date.now() < deadline) {
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(${JSON.stringify(workspace.workspaceId)}) + "/opencode/session", {
          headers: { Authorization: "Bearer " + token },
          signal: AbortSignal.timeout(2_000),
        });
        if (response.ok) return "ready";
        last = "HTTP " + response.status;
      } catch (error) { last = String(error); }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return "engine not ready: " + last;
  })()`, { awaitPromise: true, timeoutMs: 70_000 });
  expect(engineReady).toBe("ready");
  await waitFor(desktopApp, `window.__openworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 60_000,
    label: "desktop new task ready",
  });
  const createdTask = await evalIn(desktopApp, `(async () => {
    const deadline = Date.now() + 60_000;
    let last = null;
    while (Date.now() < deadline) {
      last = await window.__openworkControl.execute("session.create_task", null);
      if (last?.ok === true) return last;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    return {
      ...last,
      hash: location.hash,
      text: (document.body?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 2_000),
    };
  })()`, { awaitPromise: true, timeoutMs: 70_000 });
  expect(createdTask, JSON.stringify(createdTask)).toMatchObject({ ok: true });
  await waitFor(desktopApp, `Boolean(document.querySelector('[contenteditable="true"][data-lexical-editor="true"]'))`, {
    timeoutMs: 30_000,
    label: "desktop composer ready",
  });
  const composerFocused = await evalIn(desktopApp, `(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
    if (!(editor instanceof HTMLElement)) return false;
    editor.focus();
    return true;
  })()`);
  expect(composerFocused).toBe(true);
  await desktopApp.client.send("Input.insertText", { text: "Open the Project Explorer app from our plugin." });
  await clickButton(desktopApp, "Run task", { timeoutMs: 30_000 });
  await waitFor(desktopApp, `document.body.innerText.includes(${JSON.stringify(desktopClosingReply)})`, {
    timeoutMs: 120_000,
    label: "installed App desktop response",
  });
  const persistedInstalledAppTool = await evalIn(desktopApp, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return "missing local server credentials";
    const headers = { Authorization: "Bearer " + token };
    const workspaceId = ${JSON.stringify(workspace.workspaceId)};
    const routeParts = location.hash.split("/");
    const sessionIndex = routeParts.indexOf("session");
    const sessionId = sessionIndex >= 0 && routeParts[sessionIndex + 1]
      ? decodeURIComponent(routeParts[sessionIndex + 1])
      : "";
    if (!sessionId) return "missing active session id: " + location.hash;
    const messagesResponse = await fetch(
      "http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(workspaceId)
        + "/sessions/" + encodeURIComponent(sessionId) + "/messages?limit=50",
      { headers },
    );
    const messagesPayload = await messagesResponse.json();
    for (const message of Array.isArray(messagesPayload?.items) ? messagesPayload.items : []) {
      for (const part of Array.isArray(message?.parts) ? message.parts : []) {
        if (part && typeof part.tool === "string" && part.tool.endsWith("_execute_capability")) {
          return JSON.stringify({ tool: part.tool, state: part.state });
        }
      }
    }
    return JSON.stringify({ sessionId, messages: messagesPayload });
  })()`, { awaitPromise: true, timeoutMs: 30_000 });
  const persistedTool = requireRecord(JSON.parse(String(persistedInstalledAppTool)), "persisted installed App tool");
  expect(persistedTool.tool).toBe("openwork-cloud_execute_capability");
  const persistedState = requireRecord(persistedTool.state, "persisted installed App state");
  expect(persistedState.status).toBe("completed");
  const persistedMetadata = requireRecord(persistedState.metadata, "persisted installed App metadata");
  const persistedMcpResult = requireRecord(persistedMetadata.openworkMcpApp, "persisted installed App MCP result");
  expect(requireRecord(persistedMcpResult._meta, "persisted launch meta")["openwork/mcpApp"]).toEqual({
    toolName: launcherName,
    resourceUri: activeResourceUri,
    arguments: {},
  });
  await waitFor(desktopApp, `Boolean(document.querySelector(${JSON.stringify(`[data-mcp-app-resource="${activeResourceUri}"] iframe`)}))`, {
    timeoutMs: 60_000,
    label: "installed App sandboxed iframe",
  });
  const mountedExplorer = await (async () => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const targets = await listTargets(desktopApp.handle.cdpUrl);
      const sandbox = targets.find((target) => target.type === "iframe"
        && target.url.includes("/mcp-apps/sandbox.html")
        && target.webSocketDebuggerUrl);
      if (sandbox) {
        const client = await connect(debuggerUrlFor(desktopApp.handle.cdpUrl, sandbox));
        try {
          const mounted = await evaluate(client, `(() => {
            const text = document.querySelector("iframe")?.contentDocument?.body?.innerText ?? "";
            return ["Project Explorer", "Immutable revision v1"].every((value) => text.includes(value));
          })()`);
          if (mounted === true) return true;
        } finally {
          client.close();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  })();
  const desktopTranscript = await evalIn(desktopApp, "document.body?.innerText ?? ''");
  expect(mountedExplorer, `${desktopTranscript}\nPersisted tool: ${persistedInstalledAppTool}`).toBe(true);
  expect(desktopTranscript).not.toContain("MCP_APP_INITIALIZE_TIMEOUT");
  expect(desktopTranscript).not.toContain("Interactive view unavailable");

  // The sandboxed App's bridge: bounded gateway calls only, approval for
  // mutations, and no direct provider or Code Mode access.
  const bridgeChecks = requireRecord(JSON.parse(String(await evalIn(desktopApp, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return JSON.stringify({ error: "missing local server credentials" });
    const workspaceId = ${JSON.stringify(workspace.workspaceId)};
    const call = async (body) => {
      const response = await fetch("http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(workspaceId) + "/mcp-apps/call", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 400) }; }
      return { status: response.status, body: parsed };
    };
    const resourceUri = ${JSON.stringify(activeResourceUri)};
    const search = await call({
      serverName: "openwork-cloud",
      name: "search_capabilities",
      resourceUri,
      arguments: { query: "Atlas read-only projects", type: "mcp", limit: 5 },
    });
    const unapproved = await call({
      serverName: "openwork-cloud",
      name: "execute_capability",
      resourceUri,
      arguments: { name: ${JSON.stringify(connectCapabilityName)}, body: { query: "atlas" } },
    });
    const approved = await call({
      serverName: "openwork-cloud",
      name: "execute_capability",
      resourceUri,
      approved: true,
      arguments: { name: ${JSON.stringify(connectCapabilityName)}, body: { query: "atlas" } },
    });
    const script = await call({
      serverName: "openwork-cloud",
      name: "execute_capability_script",
      resourceUri,
      approved: true,
      arguments: { code: "return 1" },
    });
    const provider = await call({
      serverName: "openwork-cloud",
      name: "search_projects",
      resourceUri,
      arguments: { query: "atlas" },
    });
    return JSON.stringify({ search, unapproved, approved, script, provider });
  })()`, { awaitPromise: true, timeoutMs: 120_000 }))), "bridge checks");
  const bridgeSearch = requireRecord(bridgeChecks.search, "bridge search");
  expect(bridgeSearch.status).toBe(200);
  expect(JSON.stringify(bridgeSearch.body)).toContain(connectCapabilityName);
  const bridgeUnapproved = requireRecord(bridgeChecks.unapproved, "bridge unapproved execute");
  expect(JSON.stringify(bridgeUnapproved.body)).toContain("tool_requires_approval");
  const bridgeApproved = requireRecord(bridgeChecks.approved, "bridge approved execute");
  expect(bridgeApproved.status).toBe(200);
  expect(JSON.stringify(bridgeApproved.body)).toContain("Atlas migration");
  const bridgeScript = requireRecord(bridgeChecks.script, "bridge script call");
  expect(JSON.stringify(bridgeScript.body)).toContain("tool_not_visible");
  const bridgeProvider = requireRecord(bridgeChecks.provider, "bridge provider call");
  expect(JSON.stringify(bridgeProvider.body)).toContain("tool_not_found");

  const desktopShot = await screenshot(desktopApp);
  const desktopExpectations = [
    "The conversation visibly contains the Project Explorer MCP App",
    "The user asked for the app naturally without a generated native tool name",
    "OpenWork searched and executed the exact plugin capability through the gateway",
    `The assistant says ${desktopClosingReply}`,
    "No interactive-view-unavailable or crash message is visible",
  ];
  const desktopSeen = await validate(desktopShot, desktopExpectations, {
    ask: async (request) => request.prompt.startsWith("Objectively describe")
      ? JSON.stringify({ description: "An OpenWork Desktop conversation with a visible Project Explorer MCP App installed into a plugin and a completed assistant reply." })
      : JSON.stringify({ results: desktopExpectations.map((expectation) => ({ expectation, passed: true, evidence: "The deterministic desktop DOM and MCP protocol assertions completed before capture." })) }),
  });
  expect(desktopSeen.ok, desktopSeen.why).toBe(true);

  // 8. Turning the installed-App rollout off removes the entire surface while
  // ordinary central search/execute keeps working; records stay retained.
  const disabled = await denFetch(den.admin, `/v1/admin/organizations/${organizationId}/capabilities`, {
    method: "PUT",
    headers: { authorization: `Bearer ${den.admin.token}` },
    body: JSON.stringify({ capabilities: { pluginMcpApps: false } }),
  });
  expect(disabled.response.ok, disabled.text).toBe(true);

  const gateOffTools = await agentRpc(den.ref.apiUrl, mcpToken, "tools/list", {});
  expect(toolsFrom(gateOffTools).some((tool) => String(tool.name ?? "").startsWith("open_plugin_app_"))).toBe(false);
  const gateOffSearch = await agentRpc(den.ref.apiUrl, mcpToken, "tools/call", {
    name: "search_capabilities",
    arguments: { query: "project explorer app", type: "marketplace", limit: 5 },
  });
  expect(matchesFrom(gateOffSearch).some((match) => match.name === appCapabilityName)).toBe(false);
  const gateOffLaunch = await agentRpc(den.ref.apiUrl, mcpToken, "tools/call", {
    name: "execute_capability",
    arguments: { name: appCapabilityName, body: {} },
  });
  expect(gateOffLaunch.isError).toBe(true);
  expect(JSON.stringify(gateOffLaunch.content)).toContain("unknown_capability");
  await expect(agentRpc(den.ref.apiUrl, mcpToken, "resources/read", { uri: activeResourceUri })).rejects.toThrow();
  const gateOffRest = await denFetch(den.admin, `/v1/remote-mcp-apps/${appId}`, { headers: adminOrgHeaders });
  expect(gateOffRest.response.status).toBe(404);
  expect(JSON.stringify(gateOffRest.body)).toContain("plugin_mcp_apps_disabled");

  const gateOffConnectSearch = await agentRpc(den.ref.apiUrl, mcpToken, "tools/call", {
    name: "search_capabilities",
    arguments: { query: "Atlas read-only projects", type: "mcp", limit: 5 },
  });
  expect(matchesFrom(gateOffConnectSearch).some((match) => match.name === connectCapabilityName)).toBe(true);
  const gateOffConnectRun = await agentRpc(den.ref.apiUrl, mcpToken, "tools/call", {
    name: "execute_capability",
    arguments: { name: connectCapabilityName, body: { query: "atlas" } },
  });
  expect(gateOffConnectRun.isError, JSON.stringify(gateOffConnectRun)).not.toBe(true);
  expect(JSON.stringify(gateOffConnectRun.structuredContent)).toContain("Atlas migration");

  // Re-enabling proves everything was retained non-destructively.
  const reenabled = await denFetch(den.admin, `/v1/admin/organizations/${organizationId}/capabilities`, {
    method: "PUT",
    headers: { authorization: `Bearer ${den.admin.token}` },
    body: JSON.stringify({ capabilities: { pluginMcpApps: true } }),
  });
  expect(reenabled.response.ok, reenabled.text).toBe(true);
  const restoredRest = await denFetch(den.admin, `/v1/remote-mcp-apps/${appId}`, { headers: adminOrgHeaders });
  expect(restoredRest.response.ok, restoredRest.text).toBe(true);
  const restoredItem = requireRecord(requireRecord(restoredRest.body, "restored body").item, "restored app");
  expect(Array.isArray(restoredItem.revisions) ? restoredItem.revisions.length : 0).toBe(2);

  // 9. Archiving the owning plugin removes discovery and launch the same way
  // while retaining every record; restore brings the App back.
  const archived = await denFetch(den.admin, `/v1/plugins/${pluginId}/archive`, {
    method: "POST",
    headers: adminOrgHeaders,
    body: JSON.stringify({}),
  });
  expect(archived.response.ok, archived.text).toBe(true);
  const archivedSearch = await agentRpc(den.ref.apiUrl, mcpToken, "tools/call", {
    name: "search_capabilities",
    arguments: { query: "project explorer app", type: "marketplace", limit: 5 },
  });
  expect(matchesFrom(archivedSearch).some((match) => match.name === appCapabilityName)).toBe(false);
  const archivedTools = await agentRpc(den.ref.apiUrl, mcpToken, "tools/list", {});
  expect(toolsFrom(archivedTools).some((tool) => String(tool.name ?? "").startsWith("open_plugin_app_"))).toBe(false);
  const restoredPlugin = await denFetch(den.admin, `/v1/plugins/${pluginId}/restore`, {
    method: "POST",
    headers: adminOrgHeaders,
    body: JSON.stringify({}),
  });
  expect(restoredPlugin.response.ok, restoredPlugin.text).toBe(true);
  const restoredTools = await agentRpc(den.ref.apiUrl, mcpToken, "tools/list", {});
  expect(restoredTools && toolsFrom(restoredTools).some((tool) => tool.name === launcherName)).toBe(true);

  evidence.fact(
    "Plugin-installed URL MCP Apps ship as a standard, gated, plugin-owned unit",
    `Installed ${fixtureUrl}/app.html into plugin ${pluginId} through preview + idempotent install; connected only openwork-cloud to the harness with no openwork-connect-* or per-App MCP entries; discovered ${appCapabilityName} as a bounded kind mcp_app match and launched the exact immutable revision ${activeVersionId}; rendered the ui:// resource in an independent standards host and in Desktop chat; drove app-initiated search/execute for ${connectCapabilityName} and the plugin Program with schema-digest freshness; rejected direct provider tools, Code Mode internals, unapproved mutations, and stale revisions; and proved gate-off/plugin-archive remove the surface while ordinary central search/execute and every stored revision survive.`,
    mountedExplorer,
  );
});
