import { describe, expect, test } from "bun:test"
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js"
import {
  ExternalMcpDiagnosticTracker,
  createExternalMcpDiagnosticFetch,
  externalMcpDiagnosticForLog,
  safeExternalMcpCauseChain,
} from "../src/capability-sources/external-mcp-diagnostics.js"

const SAFE_SLACK_ERROR = "Slack-style provider error: invalid_refresh_token"
const AUTHORIZATION_CODE = "SECRETVALUE123"
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signatureABCD"
const SLACK_REFRESH_TOKEN = "xoxe-1-1234567890-abcdef"
const BEARER_TOKEN = "Bearer abcdefghijklmnopqrstuvwx"
const GITHUB_TOKEN = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"
const OPAQUE_TOKEN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn"

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
        weird_field: "xoxp-secret-under-arbitrary-key",
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
      weird_field: "xoxp-secret-under-arbitrary-key",
    })

    const diagnosticError = tracker.error(
      new StreamableHTTPError(400, "provider rejected initialize"),
      "MCP_INITIALIZE",
    )
    const logged = externalMcpDiagnosticForLog(diagnosticError, "ignored", "MCP_INITIALIZE")
    expect(logged.diagnostic.providerResponseExcerpt).toBe('{"error":"unsupported_protocol_version"}')
    expect(logged.diagnostic.providerResponseExcerpt?.length).toBeLessThanOrEqual(600)
    expect(logged.diagnostic.providerResponseExcerpt).not.toContain("weird_field")
    expect(logged.providerResponseLogExcerpt).toContain("weird_field")
    expect(logged.providerResponseLogExcerpt).toContain("[redacted]")
    expect(JSON.stringify(logged)).not.toContain("xoxp-must-not-appear")
    expect(JSON.stringify(logged)).not.toContain("also-must-not-appear")
    expect(JSON.stringify(logged)).not.toContain("xoxp-secret-under-arbitrary-key")
    expect(logged.causeChain).toEqual([{ name: "StreamableHTTPError", code: "400" }])
  })

  test("omits non-JSON response bodies from member diagnostics but keeps a redacted log excerpt", async () => {
    const tracker = new ExternalMcpDiagnosticTracker("req_html_excerpt")
    const diagnosticFetch = createExternalMcpDiagnosticFetch({
      endpoint: "https://provider.example.test/mcp",
      tracker,
      fetch: async () => new Response(
        `<html>provider failed with xoxp-secret-under-arbitrary-key</html>`,
        { status: 500, headers: { "content-type": "text/html" } },
      ),
    })
    await diagnosticFetch("https://provider.example.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    })
    const diagnosticError = tracker.error(
      new StreamableHTTPError(500, "provider rejected initialize"),
      "MCP_INITIALIZE",
    )
    const logged = externalMcpDiagnosticForLog(diagnosticError, "ignored", "MCP_INITIALIZE")

    expect(logged.diagnostic.providerResponseExcerpt).toBeUndefined()
    expect(logged.providerResponseLogExcerpt).toContain("<html>")
    expect(logged.providerResponseLogExcerpt).toContain("[redacted]")
    expect(logged.providerResponseLogExcerpt).not.toContain("xoxp-secret-under-arbitrary-key")
  })

  test("surfaces a bounded SDK OAuth error description in the diagnostic message", () => {
    const providerError = new InvalidGrantError(
      `${SAFE_SLACK_ERROR}; authorization_code=${AUTHORIZATION_CODE}; ${JWT}; ${SLACK_REFRESH_TOKEN}; {"access_token":"must-not-appear"}`,
    )
    const wrapped = new Error("Enterprise MCP refresh failed", { cause: providerError })
    const diagnostic = new ExternalMcpDiagnosticTracker("req_slack_refresh").error(
      wrapped,
      "CONTINUITY_REFRESH",
    ).diagnostic
    const serialized = JSON.stringify(diagnostic)

    expect(diagnostic.message).toContain("InvalidGrantError")
    expect(diagnostic.message).toContain(SAFE_SLACK_ERROR)
    expect(diagnostic.message).toContain("authorization_code=[redacted]")
    expect(serialized).toContain(SAFE_SLACK_ERROR)
    expect(serialized).not.toContain(AUTHORIZATION_CODE)
    expect(serialized).not.toContain(JWT)
    expect(serialized).not.toContain(SLACK_REFRESH_TOKEN)
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
        error_description: [
          SAFE_SLACK_ERROR,
          `authorization_code=${AUTHORIZATION_CODE}`,
          JWT,
          SLACK_REFRESH_TOKEN,
          BEARER_TOKEN,
          GITHUB_TOKEN,
          OPAQUE_TOKEN,
        ].join("; "),
        refresh_token: "must-not-appear",
        weird_field: "xoxp-secret-under-arbitrary-key",
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
    const serialized = JSON.stringify(diagnostic)

    expect(diagnostic.message).toContain(SAFE_SLACK_ERROR)
    expect(diagnostic.message).toContain("authorization_code=[redacted]")
    expect(diagnostic.providerResponseExcerpt).toContain('"error":"invalid_refresh_token"')
    expect(diagnostic.providerResponseExcerpt).toContain('"error_description"')
    expect(diagnostic.providerResponseExcerpt).not.toContain("weird_field")
    expect(serialized).not.toContain("must-not-appear")
    expect(serialized).not.toContain("xoxp-secret-under-arbitrary-key")
    for (const secret of [
      AUTHORIZATION_CODE,
      JWT,
      SLACK_REFRESH_TOKEN,
      "abcdefghijklmnopqrstuvwx",
      GITHUB_TOKEN,
      OPAQUE_TOKEN,
    ]) {
      expect(serialized).not.toContain(secret)
    }
    expect(diagnostic.providerResponseExcerpt?.length).toBeLessThanOrEqual(600)
    expect(diagnostic.providerErrorMessage?.length).toBeLessThanOrEqual(300)
  })
})
