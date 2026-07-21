import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"
import {
  createEnterpriseMcpMockServer,
  createGatewayAuthRecoveryScenario,
  gatewayAuthRecoveryDialectSchema,
  gatewayAuthRecoveryHostileGetModeSchema,
  getProviderProfile,
  type EnterpriseMcpScenario,
  type GatewayAuthRecoveryDialect,
} from "../src/index.js"

const dialects = gatewayAuthRecoveryDialectSchema.options
const hostileGetModes = gatewayAuthRecoveryHostileGetModeSchema.options
const provider = "northwind-itsm"

const rpcErrorEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  error: z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() }),
}).strict()
const rpcResultEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.unknown(),
}).strict()
const toolsListSchema = z.object({
  tools: z.array(z.object({ name: z.string(), description: z.string() }).passthrough()),
})
const stateSchema = z.object({
  connected: z.boolean(),
  dialect: gatewayAuthRecoveryDialectSchema,
  hostileGetMode: gatewayAuthRecoveryHostileGetModeSchema,
})
const toolResultSchema = z.object({
  isError: z.literal(false),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1),
  structuredContent: z.object({
    provider: z.literal(provider),
    records: z.array(z.object({
      number: z.string(),
      short_description: z.string(),
      priority: z.string(),
    })).min(1),
  }).passthrough(),
})

interface GatewaySession {
  readonly sessionId: string
  readonly protocolVersion: string
}

function connectUrl(baseUrl: string): string {
  const url = new URL("/connect/start", baseUrl)
  url.searchParams.set("provider", provider)
  return url.href
}

function authorizationMessage(baseUrl: string): string {
  const url = connectUrl(baseUrl)
  return `Authorization required — connect your Northwind ITSM account to use this connector. Open [${url}](${url}) in a browser, sign in, then retry this request.`
}

function expectedErrorBody(dialect: GatewayAuthRecoveryDialect, requestId: number, baseUrl: string): unknown {
  if (dialect === "rest_lookalike") return { error: { code: 500, message: "boom" } }
  if (dialect === "unknown_code") {
    return {
      jsonrpc: "2.0",
      id: requestId,
      error: {
        code: -32050,
        message: "Authorization required before synthetic incidents can be read",
        data: { provider, reason: "authorization_required" },
      },
    }
  }
  if (dialect === "url_elicitation") {
    return {
      jsonrpc: "2.0",
      id: requestId,
      error: { code: -32042, message: authorizationMessage(baseUrl), data: { url: connectUrl(baseUrl) } },
    }
  }
  return {
    jsonrpc: "2.0",
    id: dialect === "uncorrelated" ? null : requestId,
    error: {
      code: -32001,
      message: authorizationMessage(baseUrl),
      data: { connect_url: connectUrl(baseUrl), provider },
    },
  }
}

async function json(response: Response): Promise<unknown> {
  const parsed: unknown = JSON.parse(await response.text())
  return parsed
}

function mcpUrl(baseUrl: string, scenario: EnterpriseMcpScenario): URL {
  const profile = getProviderProfile(scenario.profileId)
  return new URL(profile.endpointPath, baseUrl)
}

function rpcHeaders(baseUrl: string): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    origin: new URL(baseUrl).origin,
  }
}

function sessionHeaders(baseUrl: string, session: GatewaySession): Record<string, string> {
  return {
    ...rpcHeaders(baseUrl),
    "mcp-session-id": session.sessionId,
    "mcp-protocol-version": session.protocolVersion,
  }
}

async function initializeSession(baseUrl: string, scenario: EnterpriseMcpScenario): Promise<GatewaySession> {
  const response = await fetch(mcpUrl(baseUrl, scenario), {
    method: "POST",
    headers: rpcHeaders(baseUrl),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: scenario.protocol.version,
        capabilities: {},
        clientInfo: { name: "gateway-auth-recovery-wire-test", version: "1" },
      },
    }),
  })
  assert.equal(response.status, 200)
  const envelope = rpcResultEnvelopeSchema.parse(await json(response))
  assert.equal(envelope.id, 1)
  const sessionId = response.headers.get("mcp-session-id")
  const protocolVersion = response.headers.get("mcp-protocol-version")
  assert.ok(sessionId)
  assert.ok(protocolVersion)
  const initialized = await fetch(mcpUrl(baseUrl, scenario), {
    method: "POST",
    headers: sessionHeaders(baseUrl, { sessionId, protocolVersion }),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  })
  assert.equal(initialized.status, 202)
  return { sessionId, protocolVersion }
}

async function callRpc(
  baseUrl: string,
  scenario: EnterpriseMcpScenario,
  session: GatewaySession,
  id: number,
  method: string,
  params: unknown,
): Promise<{ readonly response: Response; readonly body: unknown }> {
  const response = await fetch(mcpUrl(baseUrl, scenario), {
    method: "POST",
    headers: sessionHeaders(baseUrl, session),
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  })
  return { response, body: await json(response) }
}

function assertSameHostLink(body: unknown, dialect: GatewayAuthRecoveryDialect, baseUrl: string): void {
  if (dialect === "rest_lookalike" || dialect === "unknown_code") return
  const envelope = rpcErrorEnvelopeSchema.parse(body)
  const linked = dialect === "url_elicitation"
    ? z.object({ url: z.url() }).parse(envelope.error.data).url
    : z.object({ connect_url: z.url(), provider: z.literal(provider) }).parse(envelope.error.data).connect_url
  assert.equal(new URL(linked).origin, new URL(baseUrl).origin)
}

function assertDialectError(body: unknown, dialect: GatewayAuthRecoveryDialect, requestId: number, baseUrl: string): void {
  assert.deepEqual(body, expectedErrorBody(dialect, requestId, baseUrl))
  assertSameHostLink(body, dialect, baseUrl)
  if (dialect === "unknown_code") {
    const serialized = JSON.stringify(body)
    assert.equal(serialized.includes("/connect/start"), false)
    assert.equal(serialized.includes(new URL(baseUrl).origin), false)
  }
}

test("gateway-auth-recovery dialects expose exact wire bodies and recover through connect/reset", async (context) => {
  for (const dialect of dialects) {
    await context.test(dialect, async () => {
      const scenario = createGatewayAuthRecoveryScenario({ dialect })
      const server = createEnterpriseMcpMockServer({ scenario, secrets: { oauthClientSecret: "" } })
      await server.start()
      try {
        const stateBefore = stateSchema.parse(await json(await fetch(new URL("/__scenario/state", server.baseUrl))))
        assert.equal(stateBefore.connected, false)
        assert.equal(stateBefore.dialect, dialect)
        assert.equal(stateBefore.hostileGetMode, "405")

        const session = await initializeSession(server.baseUrl, scenario)
        const list = await callRpc(server.baseUrl, scenario, session, 10, "tools/list", {})
        assert.equal(list.response.status, 200)
        const listEnvelope = rpcResultEnvelopeSchema.parse(list.body)
        const listedTools = toolsListSchema.parse(listEnvelope.result).tools
        assert.deepEqual(listedTools.map((tool) => tool.name), ["get_incidents"])
        assert.match(listedTools[0]?.description ?? "", /synthetic Northwind ITSM system/)

        const firstError = await callRpc(server.baseUrl, scenario, session, 99, "tools/call", { name: "get_incidents", arguments: {} })
        assert.equal(firstError.response.status, 200)
        assertDialectError(firstError.body, dialect, 99, server.baseUrl)

        const startResponse = await fetch(new URL("/connect/start?source=test", server.baseUrl))
        assert.equal(startResponse.status, 200)
        const startHtml = await startResponse.text()
        assert.match(startHtml, /Northwind ITSM/)
        assert.match(startHtml, /Sign in and authorize/)
        assert.match(startHtml, /represents no specific vendor/)

        const completeResponse = await fetch(new URL("/connect/complete", server.baseUrl), { method: "POST" })
        assert.equal(completeResponse.status, 200)
        assert.match(await completeResponse.text(), /Connected — return to the app/)
        const stateConnected = stateSchema.parse(await json(await fetch(new URL("/__scenario/state", server.baseUrl))))
        assert.equal(stateConnected.connected, true)

        const success = await callRpc(server.baseUrl, scenario, session, 100, "tools/call", { name: "get_incidents", arguments: {} })
        assert.equal(success.response.status, 200)
        const successEnvelope = rpcResultEnvelopeSchema.parse(success.body)
        const toolResult = toolResultSchema.parse(successEnvelope.result)
        assert.equal(toolResult.structuredContent.records[0]?.number, "INC0010023")
        assert.equal(toolResult.structuredContent.records[0]?.short_description, "printer down")
        assert.equal(toolResult.structuredContent.records[0]?.priority, "P3")
        assert.match(toolResult.content[0]?.text ?? "", /INC0010023/)

        const resetResponse = await fetch(new URL("/__scenario/reset", server.baseUrl), { method: "POST" })
        assert.equal(resetResponse.status, 200)
        const stateReset = stateSchema.parse(await json(resetResponse))
        assert.equal(stateReset.connected, false)

        if (dialect === "correlated") {
          const completeGetResponse = await fetch(new URL("/connect/complete", server.baseUrl))
          assert.equal(completeGetResponse.status, 200)
          assert.equal(stateSchema.parse(await json(await fetch(new URL("/__scenario/state", server.baseUrl)))).connected, true)
          assert.equal((await fetch(new URL("/__scenario/reset", server.baseUrl), { method: "POST" })).status, 200)
        }

        const errorAfterReset = await callRpc(server.baseUrl, scenario, session, 101, "tools/call", { name: "get_incidents", arguments: {} })
        assert.equal(errorAfterReset.response.status, 200)
        assertDialectError(errorAfterReset.body, dialect, 101, server.baseUrl)
      } finally {
        await server.stop()
      }
    })
  }
})

test("gateway-auth-recovery hostile MCP GET mode is configurable", async (context) => {
  for (const hostileGetMode of hostileGetModes) {
    await context.test(hostileGetMode, async () => {
      const scenario = createGatewayAuthRecoveryScenario({ dialect: "uncorrelated", hostileGetMode })
      const server = createEnterpriseMcpMockServer({ scenario, secrets: { oauthClientSecret: "" } })
      await server.start()
      try {
        if (hostileGetMode === "405") {
          const response = await fetch(server.mcpUrl, { method: "GET" })
          assert.equal(response.status, 405)
        } else {
          let rejected = false
          try {
            await fetch(server.mcpUrl, { method: "GET" })
          } catch {
            rejected = true
          }
          assert.equal(rejected, true)
        }
        assert.equal((await fetch(new URL("/health", server.baseUrl))).status, 200)
      } finally {
        await server.stop()
      }
    })
  }
})
