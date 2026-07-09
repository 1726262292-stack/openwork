import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { beforeAll, expect, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
}

seedRequiredEnv()

let externalCapabilities: typeof import("../src/mcp/external-capabilities.js")

beforeAll(async () => {
  seedRequiredEnv()
  externalCapabilities = await import("../src/mcp/external-capabilities.js")
})

test("upstreamErrorMessage unwraps JSON-RPC errors from the SDK wrapper", () => {
  const message = externalCapabilities.upstreamErrorMessage(new Error('Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"App is not installed on this workspace"}}'))

  expect(message).toContain("App is not installed on this workspace")
  expect(message).toContain("-32600")
  expect(message).not.toContain("Streamable HTTP error")
})

test("upstreamErrorMessage caps non-JSON long messages at 300 characters plus ellipsis", () => {
  const raw = "x".repeat(350)
  const message = externalCapabilities.upstreamErrorMessage(new Error(raw))

  expect(message).toBe(`${"x".repeat(300)}...`)
  expect(message.length).toBe(303)
})

test("upstreamErrorMessage falls back without throwing when JSON-looking content is unparseable", () => {
  const raw = `Streamable HTTP error: {${"not-json".repeat(60)}`
  const message = externalCapabilities.upstreamErrorMessage(new Error(raw))

  expect(message).toBe(`${raw.slice(0, 300)}...`)
})

test("upstreamErrorMessage handles non-Error inputs", () => {
  expect(externalCapabilities.upstreamErrorMessage("plain failure")).toBe("plain failure")
})

test("externalConnectionErrorHint gives reconnect guidance for HTTP auth errors", () => {
  const hint = externalCapabilities.externalConnectionErrorHint("Acme MCP", new StreamableHTTPError(401, "Unauthorized"))

  expect(hint).toContain("The stored credential looks invalid or expired")
  expect(hint).toContain('Reconnect "Acme MCP"')
  expect(hint).toContain("This is a live probe, not a cached result")
})

test("externalConnectionErrorHint gives provider-admin guidance for JSON-RPC rejections", () => {
  const error = new Error('Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"App is not installed on this workspace"}}')
  const hint = externalCapabilities.externalConnectionErrorHint("Acme MCP", error)

  expect(hint).toContain("The provider's server rejected the request")
  expect(hint).toContain("App is not installed on this workspace")
  expect(hint).toContain("-32600")
  expect(hint).toContain("provider's own admin console")
  expect(hint).toContain("This is a live probe, not a cached result")
  expect(hint).not.toContain("expired")
})
