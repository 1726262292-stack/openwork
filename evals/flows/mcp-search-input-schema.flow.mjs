/**
 * Internal demo: capability search exposes bounded input schemas and execute
 * refuses un-constructible calls (PR #2758).
 *
 * A real Den external MCP connection points at a synthetic incident server.
 * Before #2758 `search_capabilities` reduced its tools to name/description/
 * hasBody, so agents guessed arguments and providers received empty payloads
 * ("SyntaxError: Empty JSON string" class failures). This proves matches now
 * carry `inputSummary` + `schemaHash`, oversized schemas stay bounded, and an
 * empty-args execute is refused before the provider is ever called.
 *
 * Runs app-less against the real den-api (`--stack den`).
 */
import http from "node:http";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "mcp-search-input-schema";
const CONNECTION_PREFIX = "Synthetic incident MCP — input schema proof";
const SUCCESS_TEXT = "INC0777015 — Printer on fire (synthetic demo record)";
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

function wideProperties() {
  const properties = {};
  for (let index = 1; index <= 30; index += 1) {
    properties[`export_option_${String(index).padStart(2, "0")}`] = {
      type: "string",
      description: `Configuration export option ${index}. ${"This description is intentionally long so the bounded summary must cap it. ".repeat(4)}`,
    };
  }
  properties.format = { type: "string", enum: ["csv", "json", "xml", "xlsx", "pdf", "html", "yaml", "toml", "parquet", "avro", "orc", "proto"] };
  return properties;
}

const TOOLS = [
  {
    name: "lookup_incident_records",
    title: "Look up incident records",
    description: "Look up incident records by number with optional notes.",
    inputSchema: {
      type: "object",
      properties: {
        incident_number: { type: "string", description: "Incident number, e.g. INC0777015." },
        include_notes: { type: "boolean", description: "Include work notes in the result." },
        priority: { type: "integer", enum: [1, 2, 3] },
      },
      required: ["incident_number"],
      additionalProperties: false,
    },
  },
  {
    name: "wide_config_export",
    title: "Wide configuration export",
    description: "Export configuration with an enormous option surface.",
    inputSchema: {
      type: "object",
      properties: wideProperties(),
      required: ["format"],
      additionalProperties: false,
    },
  },
];

function mcpResult(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "synthetic-incident-schema", version: "1.0.0" },
    };
  }
  if (message.method === "tools/list") return { tools: TOOLS };
  if (message.method === "tools/call") {
    if (message.params?.name === "lookup_incident_records") {
      return { content: [{ type: "text", text: SUCCESS_TEXT }] };
    }
    return { content: [{ type: "text", text: "ok" }] };
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

async function searchCapabilities(ctx, query) {
  const result = await mcpAgentCall(ctx, "tools/call", {
    name: "search_capabilities",
    arguments: { query, limit: 10, type: "mcp" },
  });
  const parsed = JSON.parse(result.content?.[0]?.text ?? "{}");
  return parsed.matches ?? [];
}

async function executeCapability(ctx, args) {
  const result = await mcpAgentCall(ctx, "tools/call", {
    name: "execute_capability",
    arguments: args,
  });
  const text = result.content?.[0]?.text ?? "";
  let payload;
  try { payload = JSON.parse(text); } catch { payload = null; }
  return { isError: result.isError === true, text, payload };
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
    "Den validates and connects the synthetic incident MCP server.",
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
  title: "Capability search exposes bounded input schemas; execute refuses un-constructible calls",
  kind: "internal",
  requiresApp: false,
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_TOKEN"],
  steps: [
    {
      name: "Search returns the tool with a bounded input summary and schema hash",
      run: async (ctx) => {
        await ctx.prove("The incident tool's match carries inputSummary (required/types/descriptions) plus schemaHash", {
          voiceover: vo[0],
          action: async () => {
            await ensureConnection(ctx);
            ctx.matches = await searchCapabilities(ctx, "lookup incident records");
          },
          assert: async () => {
            const match = ctx.matches.find((entry) => entry.name === `mcp:${state.connectionId}:lookup_incident_records`);
            witness(ctx, Boolean(match), "The synthetic incident tool is ranked for its natural query.", ctx.matches.map((entry) => entry.name));
            witness(ctx, Array.isArray(match.inputSummary?.required) && match.inputSummary.required.includes("incident_number"), "inputSummary names the required field.", match.inputSummary?.required);
            witness(ctx, match.inputSummary?.properties?.incident_number?.type === "string", "inputSummary types the required argument.", match.inputSummary?.properties?.incident_number);
            witness(ctx, typeof match.inputSummary?.properties?.incident_number?.description === "string" && match.inputSummary.properties.incident_number.description.length > 0, "inputSummary keeps the provider's argument description.");
            witness(ctx, match.inputSummary?.properties?.priority?.enum?.length === 3, "Enum values survive in the summary.", match.inputSummary?.properties?.priority);
            witness(ctx, typeof match.schemaHash === "string" && /^[0-9a-f]{12}$/.test(match.schemaHash), "schemaHash is a stable 12-hex fingerprint of the provider schema.", match.schemaHash);
            witness(ctx, match.inputSummary?.truncated === undefined, "A small schema is complete — not truncated.", match.inputSummary?.truncated ?? null);
            ctx.lookupMatch = match;
            ctx.output("search match (as the agent sees it)", JSON.stringify(match, null, 2).slice(0, 2_000));
          },
        });
      },
    },
    {
      name: "An enormous schema stays bounded and marks itself truncated",
      run: async (ctx) => {
        await ctx.prove("The wide tool's summary caps properties and enums and sets truncated", {
          voiceover: vo[1],
          action: async () => {
            ctx.wideMatches = await searchCapabilities(ctx, "wide configuration export");
          },
          assert: async () => {
            const match = ctx.wideMatches.find((entry) => entry.name === `mcp:${state.connectionId}:wide_config_export`);
            witness(ctx, Boolean(match), "The wide tool is ranked for its query.", ctx.wideMatches.map((entry) => entry.name));
            witness(ctx, match.inputSummary?.truncated === true, "The summary marks itself truncated instead of flooding context.", match.inputSummary?.truncated);
            const propertyCount = Object.keys(match.inputSummary?.properties ?? {}).length;
            witness(ctx, propertyCount <= 24, "Properties are capped.", propertyCount);
            witness(ctx, Array.isArray(match.inputSummary?.required) && match.inputSummary.required.includes("format"), "Required fields survive the cap.", match.inputSummary?.required);
            const enumLength = match.inputSummary?.properties?.format?.enum?.length ?? 0;
            witness(ctx, enumLength <= 8, "Enums are capped.", enumLength);
            const serialized = JSON.stringify(match.inputSummary);
            witness(ctx, serialized.length <= 2_048, "The whole summary stays within the context budget.", serialized.length);
            ctx.output("bounded summary size", `${serialized.length} bytes for a 31-property provider schema (truncated: true, ${propertyCount} properties kept)`);
          },
        });
      },
    },
    {
      name: "Empty-args execution is refused before the provider is called",
      run: async (ctx) => {
        await ctx.prove("execute_capability with no body returns missing_required_arguments and the provider sees no tools/call", {
          voiceover: vo[2],
          action: async () => {
            state.observedMethods.length = 0;
            ctx.refusal = await executeCapability(ctx, { name: `mcp:${state.connectionId}:lookup_incident_records` });
          },
          assert: async () => {
            const { isError, payload } = ctx.refusal;
            witness(ctx, isError, "The empty-args execute is an error tool result.");
            witness(ctx, payload?.error === "missing_required_arguments", "The refusal is structured as missing_required_arguments.", payload?.error);
            witness(ctx, typeof payload?.message === "string" && payload.message.includes("incident_number"), "The refusal names the missing field.", payload?.message);
            witness(ctx, Array.isArray(payload?.inputSummary?.required) && payload.inputSummary.required.includes("incident_number"), "The refusal hands back the input summary for a correct retry.", payload?.inputSummary?.required);
            witness(ctx, typeof payload?.schemaHash === "string" && /^[0-9a-f]{12}$/.test(payload.schemaHash), "The refusal carries the schema fingerprint.", payload?.schemaHash);
            witness(ctx, !state.observedMethods.includes("tools/call"), "The provider never received a tool call.", state.observedMethods);
            ctx.output("structured refusal (as the agent sees it)", JSON.stringify(payload, null, 2).slice(0, 2_000));
          },
        });
      },
    },
    {
      name: "Correct arguments still execute for real",
      run: async (ctx) => {
        await ctx.prove("The same tool with incident_number supplied returns the provider's genuine result", {
          voiceover: vo[3],
          action: async () => {
            state.observedMethods.length = 0;
            ctx.success = await executeCapability(ctx, {
              name: `mcp:${state.connectionId}:lookup_incident_records`,
              body: { incident_number: "INC0777015" },
            });
          },
          assert: async () => {
            witness(ctx, !ctx.success.isError, "The execute succeeds.");
            witness(ctx, ctx.success.text.includes(SUCCESS_TEXT), "The provider's genuine result is returned to the agent.", ctx.success.text.slice(0, 200));
            witness(ctx, state.observedMethods.filter((method) => method === "tools/call").length === 1, "The provider received exactly one tool call.", state.observedMethods);
            ctx.output("provider result", ctx.success.text.slice(0, 400));
            await cleanup(ctx);
          },
        });
      },
    },
  ],
};
