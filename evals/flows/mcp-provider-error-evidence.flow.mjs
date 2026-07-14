/**
 * Internal demo: provider tool errors carry allowlisted evidence (PR #2757).
 *
 * A real Den external MCP connection points at a synthetic ServiceNow-style
 * server whose tools return HTTP 200 + `isError: true` results — exactly how
 * enterprise providers fail in the field. Before #2757 the provider's own
 * error text was discarded everywhere; this proves the diagnostic now carries
 * providerStatus / providerCode / providerRequestId / payloadBytes plus a
 * reference id, while the raw payload stays out of the model-visible message.
 *
 * Runs app-less against the real den-api (`--stack den`): the protagonist is
 * the agent-facing /mcp/agent surface, witnessed through real MCP calls.
 */
import http from "node:http";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "mcp-provider-error-evidence";
const CONNECTION_PREFIX = "Synthetic ServiceNow — provider evidence proof";
const RAW_SENTINEL = "raw-provider-payload-SNX42";
const REDIS_TEXT = "All slots are not covered by nodes. 0 of 16384 covered.";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const state = {
  server: null,
  observedMethods: [],
  connectionId: "",
  connectionName: "",
  mcpToken: "",
};

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual: actual === undefined ? undefined : JSON.stringify(actual).slice(0, 1_200),
  });
  ctx.assert(condition, `${assertion}${actual === undefined ? "" : `. Actual: ${JSON.stringify(actual).slice(0, 600)}`}`);
}

function json(response, status, body) {
  response.writeHead(status, { "access-control-allow-origin": "*", "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      try { resolve(raw.trim() ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

const TOOLS = [
  {
    name: "lookup_incident_records",
    title: "Look up incident records",
    description: "Look up incident records by number.",
    inputSchema: {
      type: "object",
      properties: { incident_number: { type: "string", description: "Incident number, e.g. INC0777015." } },
      required: ["incident_number"],
      additionalProperties: false,
    },
  },
  {
    name: "redis_backed_lookup",
    title: "Redis-backed lookup",
    description: "Lookup served by a Redis-backed provider component.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function mcpResult(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "synthetic-servicenow-evidence", version: "1.0.0" },
    };
  }
  if (message.method === "tools/list") return { tools: TOOLS };
  if (message.method === "tools/call") {
    const tool = message.params?.name;
    if (tool === "lookup_incident_records") {
      // ServiceNow-style: HTTP 200, isError tool result, error details in TEXT
      // content (no structuredContent). The sentinel must never surface.
      return {
        isError: true,
        content: [{
          type: "text",
          text: JSON.stringify({
            status: 403,
            error: "insufficient_acl",
            requestId: "TXN-93001",
            detail: RAW_SENTINEL,
          }),
        }],
      };
    }
    if (tool === "redis_backed_lookup") {
      return { isError: true, content: [{ type: "text", text: REDIS_TEXT }] };
    }
    return { isError: true, content: [{ type: "text", text: "unknown tool" }] };
  }
  return {};
}

async function startMcpServer() {
  if (state.server) return;
  state.server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname !== "/mcp" || request.method !== "POST") {
        json(response, 404, { error: "not_found" });
        return;
      }
      const body = await readJson(request);
      const messages = Array.isArray(body) ? body : [body];
      const replies = [];
      for (const message of messages) {
        if (message && typeof message === "object" && typeof message.method === "string") {
          state.observedMethods.push(message.method);
        }
        if (message && typeof message === "object" && message.id !== undefined) {
          replies.push({ jsonrpc: "2.0", id: message.id, result: mcpResult(message) });
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
    state.server.once("error", reject);
    state.server.listen(0, "127.0.0.1", resolve);
  });
  state.server.unref();
}

function mcpUrl() {
  const address = state.server?.address();
  if (!address || typeof address === "string") throw new Error("Mock MCP server has no TCP address.");
  return `http://127.0.0.1:${address.port}/mcp`;
}

async function denFetch(ctx, path, options = {}) {
  const base = ctx.env.OPENWORK_EVAL_DEN_API_URL.trim().replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

/** Den /mcp/agent speaks MCP-over-streamable-HTTP; unwrap the SSE data frame. */
async function mcpAgentCall(ctx, method, params) {
  const base = ctx.env.OPENWORK_EVAL_DEN_API_URL.trim().replace(/\/+$/, "");
  const response = await fetch(`${base}/mcp/agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${state.mcpToken}`,
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

async function executeCapability(ctx, args) {
  const result = await mcpAgentCall(ctx, "tools/call", {
    name: "execute_capability",
    arguments: args,
  });
  const text = result.content?.[0]?.text ?? "";
  return { isError: result.isError === true, text, payload: JSON.parse(text) };
}

async function ensureConnection(ctx) {
  if (state.connectionId) return;
  await startMcpServer();
  const token = ctx.env.OPENWORK_EVAL_DEN_TOKEN.trim();

  const existing = await denFetch(ctx, "/v1/mcp-connections?scope=manageable", {
    headers: { authorization: `Bearer ${token}` },
  });
  witness(ctx, existing.response.ok, "The demo owner can list manageable MCP connections.", { status: existing.response.status });
  for (const connection of existing.body.connections ?? []) {
    if (connection.name.startsWith(CONNECTION_PREFIX)) {
      await denFetch(ctx, `/v1/mcp-connections/${connection.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
    }
  }

  state.connectionName = `${CONNECTION_PREFIX} ${Date.now()}`;
  const created = await denFetch(ctx, "/v1/mcp-connections", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: state.connectionName,
      url: mcpUrl(),
      authType: "none",
      credentialMode: "shared",
      access: { orgWide: true, memberIds: [], teamIds: [] },
    }),
  });
  witness(
    ctx,
    created.response.ok && typeof created.body?.id === "string" && created.body?.connected === true,
    "Den validates and connects the synthetic ServiceNow-style MCP server.",
    { status: created.response.status, id: created.body?.id, connected: created.body?.connected },
  );
  state.connectionId = created.body.id;

  const minted = await denFetch(ctx, "/v1/mcp/token", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  witness(ctx, typeof minted.body?.token === "string" && minted.body.token.startsWith("ow_mcp_at_"), "A real org-scoped MCP token was minted.", { organizationId: minted.body?.organizationId });
  state.mcpToken = minted.body.token;
}

async function cleanup(ctx) {
  if (!state.connectionId) return;
  const token = ctx.env.OPENWORK_EVAL_DEN_TOKEN.trim();
  await denFetch(ctx, `/v1/mcp-connections/${state.connectionId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  state.connectionId = "";
}

export default {
  id: FLOW_ID,
  title: "Provider tool errors carry allowlisted evidence instead of collapsing into a generic failure",
  kind: "internal",
  requiresApp: false,
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_TOKEN"],
  steps: [
    {
      name: "A synthetic ServiceNow-style provider is connected for real",
      run: async (ctx) => {
        await ctx.prove("Den connects the synthetic provider whose tools fail like real enterprise providers", {
          voiceover: vo[0],
          action: async () => {
            await ensureConnection(ctx);
          },
          assert: async () => {
            witness(ctx, state.observedMethods.includes("initialize"), "Den completed a real MCP initialize against the synthetic provider.", state.observedMethods);
            ctx.output("synthetic provider tools", TOOLS.map((tool) => `${tool.name} — ${tool.description}`).join("\n"));
            ctx.output("failure modes", [
              "lookup_incident_records -> HTTP 200 + isError tool result with a 403 JSON body in TEXT content (no structuredContent)",
              `redis_backed_lookup    -> HTTP 200 + isError tool result with plain text: ${REDIS_TEXT}`,
            ].join("\n"));
          },
        });
      },
    },
    {
      name: "A provider-side 403 surfaces as allowlisted evidence",
      run: async (ctx) => {
        await ctx.prove("execute_capability returns MCP_PROVIDER_HTTP_403 with providerStatus/providerCode/providerRequestId/payloadBytes and no raw payload", {
          voiceover: vo[1],
          action: async () => {
            state.observedMethods.length = 0;
            ctx.lookupResult = await executeCapability(ctx, {
              name: `mcp:${state.connectionId}:lookup_incident_records`,
              body: { incident_number: "INC0777015" },
            });
          },
          assert: async () => {
            const { isError, text, payload } = ctx.lookupResult;
            witness(ctx, state.observedMethods.includes("tools/call"), "The provider really executed the tool call.", state.observedMethods);
            witness(ctx, isError, "The execute result is an error tool result.");
            witness(ctx, payload.error === "provider_error", "The failure is classified as provider_error.", payload.error);
            const diagnostic = payload.diagnostic ?? {};
            witness(ctx, diagnostic.code === "MCP_PROVIDER_HTTP_403", "The diagnostic classifies the provider's own 403 from text content.", diagnostic.code);
            witness(ctx, diagnostic.phase === "PROVIDER_AUTHORIZATION", "The failing phase is provider authorization — not OpenWork, not the network.", diagnostic.phase);
            witness(ctx, diagnostic.providerStatus === 403, "providerStatus carries the provider's HTTP-style status.", diagnostic.providerStatus);
            witness(ctx, diagnostic.providerCode === "insufficient_acl", "providerCode carries the provider's error code.", diagnostic.providerCode);
            witness(ctx, diagnostic.providerRequestId === "TXN-93001", "providerRequestId carries the provider transaction id for the support case.", diagnostic.providerRequestId);
            witness(ctx, typeof diagnostic.payloadBytes === "number" && diagnostic.payloadBytes > 0, "payloadBytes proves the provider returned a body.", diagnostic.payloadBytes);
            witness(ctx, typeof diagnostic.referenceId === "string" && diagnostic.referenceId.length > 0, "A diagnostic reference id is attached for support.", diagnostic.referenceId);
            witness(ctx, diagnostic.actionOwner === "provider_admin", "The action owner names who must fix it: the provider admin.", diagnostic.actionOwner);
            witness(ctx, !text.includes(RAW_SENTINEL), "The provider's raw payload is withheld from the model-visible response.");
            witness(ctx, typeof diagnostic.message === "string" && diagnostic.message.includes("provider status 403"), "The safe message names the provider status without quoting the payload.", diagnostic.message);
            ctx.output("execute_capability error payload (sanitized, as the agent sees it)", JSON.stringify(payload, null, 2).slice(0, 2_000));
          },
        });
      },
    },
    {
      name: "A Redis-style backend failure still yields payload evidence",
      run: async (ctx) => {
        await ctx.prove("An unparseable provider failure classifies as MCP_PROVIDER_TOOL_ERROR with payloadBytes, withholding the raw text", {
          voiceover: vo[2],
          action: async () => {
            state.observedMethods.length = 0;
            ctx.redisResult = await executeCapability(ctx, {
              name: `mcp:${state.connectionId}:redis_backed_lookup`,
              body: {},
            });
          },
          assert: async () => {
            const { isError, text, payload } = ctx.redisResult;
            witness(ctx, state.observedMethods.includes("tools/call"), "The provider really executed the Redis-backed tool.", state.observedMethods);
            witness(ctx, isError, "The execute result is an error tool result.");
            const diagnostic = payload.diagnostic ?? {};
            witness(ctx, diagnostic.code === "MCP_PROVIDER_TOOL_ERROR", "Without a parseable status the failure stays a classified provider tool error.", diagnostic.code);
            witness(ctx, diagnostic.phase === "PROVIDER_EXECUTION", "The failing phase is provider execution.", diagnostic.phase);
            witness(ctx, typeof diagnostic.payloadBytes === "number" && diagnostic.payloadBytes > 0, "payloadBytes proves the provider answered with a body.", diagnostic.payloadBytes);
            witness(ctx, diagnostic.providerStatus === undefined, "No provider status is invented from prose text.", diagnostic.providerStatus ?? null);
            witness(ctx, !text.includes("16384"), "The raw Redis error text is withheld from the model-visible response.");
            witness(ctx, typeof diagnostic.referenceId === "string" && diagnostic.referenceId.length > 0, "A diagnostic reference id is attached for support.", diagnostic.referenceId);
            ctx.output("execute_capability error payload (sanitized, as the agent sees it)", JSON.stringify(payload, null, 2).slice(0, 2_000));
            await cleanup(ctx);
          },
        });
      },
    },
  ],
};
