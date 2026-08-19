import { expect, test } from "bun:test"
import { StreamableHTTPTransport } from "@hono/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Hono } from "hono"
import { normalizeMcpProtocolVersionHeader } from "../src/mcp/protocol-version.js"

function requestHeaders(protocolVersion?: string) {
  const request = new Request("https://api.example.com/mcp/agent", {
    method: "POST",
    headers: protocolVersion === undefined
      ? { "content-type": "application/json" }
      : { "content-type": "application/json", "mcp-protocol-version": protocolVersion },
    body: "{}",
  })
  return request.headers
}

test("supported and missing protocol versions pass through untouched", () => {
  const supported = requestHeaders("2025-06-18")
  normalizeMcpProtocolVersionHeader(supported, "agent", "req_supported")
  expect(supported.get("mcp-protocol-version")).toBe("2025-06-18")

  const missing = requestHeaders()
  normalizeMcpProtocolVersionHeader(missing, "agent", "req_missing")
  expect(missing.get("mcp-protocol-version")).toBeNull()
})

test("duplicated copies of a negotiated version collapse to one value", () => {
  const headers = requestHeaders("2025-06-18")
  headers.append("mcp-protocol-version", "2025-06-18")
  expect(headers.get("mcp-protocol-version")).toBe("2025-06-18, 2025-06-18")

  normalizeMcpProtocolVersionHeader(headers, "agent", "req_duplicated")
  expect(headers.get("mcp-protocol-version")).toBe("2025-06-18")
})

test("unknown protocol versions are removed from request-guarded headers", () => {
  const headers = requestHeaders("2026-03-26")
  normalizeMcpProtocolVersionHeader(headers, "agent", "req_unknown")
  expect(headers.get("mcp-protocol-version")).toBeNull()
})

function statelessMcpApp(normalize: boolean) {
  const app = new Hono()
  app.all("/mcp/agent", async (c) => {
    if (normalize) {
      normalizeMcpProtocolVersionHeader(c.req.raw.headers, "agent", "req_transport")
    }
    const server = new McpServer({ name: "witness", version: "1.0.0" })
    const transport = new StreamableHTTPTransport()
    await server.connect(transport)
    const response = await transport.handleRequest(c)
    return response ?? new Response(null, { status: 204 })
  })
  return app
}

function initializedNotification(protocolVersion: string) {
  return new Request("https://api.example.com/mcp/agent", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": protocolVersion,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  })
}

test("without normalization a newer negotiated version fails stateless requests with 404", async () => {
  const response = await statelessMcpApp(false).request(initializedNotification("2026-03-26"))
  expect(response.status).toBe(404)
  const body: unknown = await response.json()
  expect(JSON.stringify(body)).toContain("Unsupported protocol version")
})

test("with normalization the same request is accepted", async () => {
  const response = await statelessMcpApp(true).request(initializedNotification("2026-03-26"))
  expect(response.status).toBe(202)
})
