import { describe, expect, test } from "bun:test"
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js"
import {
  ExternalMcpDiagnosticTracker,
  createExternalMcpDiagnosticFetch,
  externalMcpDiagnosticForLog,
  safeExternalMcpCauseChain,
} from "../src/capability-sources/external-mcp-diagnostics.js"

describe("Slack MCP diagnostic compatibility", () => {
  test("preserves the SDK StreamableHTTPError name and numeric status code", () => {
    const error = new StreamableHTTPError(400, "provider rejected initialize")

    expect(safeExternalMcpCauseChain(error)).toEqual([{
      name: "StreamableHTTPError",
      code: "400",
    }])
  })

  test("logs a bounded, redacted provider body excerpt for a non-2xx MCP response", async () => {
    const tracker = new ExternalMcpDiagnosticTracker("req_slack_excerpt")
    const diagnosticFetch = createExternalMcpDiagnosticFetch({
      endpoint: "https://provider.example.test/mcp",
      tracker,
      fetch: async () => Response.json({
        error: "unsupported_protocol_version",
        access_token: "xoxp-must-not-appear",
        client_secret: "also-must-not-appear",
      }, { status: 400 }),
    })

    const response = await diagnosticFetch("https://provider.example.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    })
    expect(await response.json()).toEqual({
      error: "unsupported_protocol_version",
      access_token: "xoxp-must-not-appear",
      client_secret: "also-must-not-appear",
    })

    const diagnosticError = tracker.error(
      new StreamableHTTPError(400, "provider rejected initialize"),
      "MCP_INITIALIZE",
    )
    const logged = externalMcpDiagnosticForLog(diagnosticError, "ignored", "MCP_INITIALIZE")
    expect(logged.diagnostic.providerResponseExcerpt).toContain("[redacted]")
    expect(logged.diagnostic.providerResponseExcerpt?.length).toBeLessThanOrEqual(600)
    expect(JSON.stringify(logged)).not.toContain("xoxp-must-not-appear")
    expect(JSON.stringify(logged)).not.toContain("also-must-not-appear")
    expect(logged.causeChain).toEqual([{ name: "StreamableHTTPError", code: "400" }])
  })

  test("surfaces a bounded SDK OAuth error description in the diagnostic message", () => {
    const providerError = new InvalidGrantError(
      'Slack-style provider error: invalid_refresh_token {"access_token":"must-not-appear"}',
    )
    const wrapped = new Error("Enterprise MCP refresh failed", { cause: providerError })
    const diagnostic = new ExternalMcpDiagnosticTracker("req_slack_refresh").error(
      wrapped,
      "CONTINUITY_REFRESH",
    ).diagnostic
    const serialized = JSON.stringify(diagnostic)

    expect(diagnostic.message).toContain("InvalidGrantError")
    expect(diagnostic.message).toContain("invalid_refresh_token")
    expect(serialized).toContain("invalid_refresh_token")
    expect(serialized).not.toContain("must-not-appear")
    expect(diagnostic.providerErrorMessage?.length).toBeLessThanOrEqual(300)
  })

  test("retains an HTTP-200 provider token error when a later OAuth contract error wins classification", async () => {
    const tracker = new ExternalMcpDiagnosticTracker("req_slack_refresh_response")
    const diagnosticFetch = createExternalMcpDiagnosticFetch({
      endpoint: "https://provider.example.test/mcp",
      tracker,
      fetch: async () => Response.json({
        ok: false,
        error: "invalid_refresh_token",
        refresh_token: "must-not-appear",
      }),
    })
    await diagnosticFetch("https://provider.example.test/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "expired" }),
    })

    const finalError = new Error("A signed authorization transaction is required")
    Object.defineProperty(finalError, "code", { value: "MCP_OAUTH_AUTHORIZATION_ID_REQUIRED" })
    const diagnostic = tracker.error(finalError, "CONTINUITY_REFRESH").diagnostic

    expect(diagnostic.message).toContain("invalid_refresh_token")
    expect(JSON.stringify(diagnostic)).not.toContain("must-not-appear")
  })
})
