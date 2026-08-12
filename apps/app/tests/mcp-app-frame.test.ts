import { describe, expect, test } from "bun:test"

import type { OpenworkMcpAppResource } from "../src/app/lib/openwork-server"
import { buildMcpAppCsp, secureMcpAppHtml } from "../src/components/chat/mcp-app-frame"

function fixture(overrides: Partial<OpenworkMcpAppResource> = {}): OpenworkMcpAppResource {
  return {
    serverName: "fixture",
    toolName: "render",
    resourceUri: "ui://fixture/view.html",
    html: "<!doctype html><html><head><title>Fixture</title></head><body>ok</body></html>",
    csp: {
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [],
      baseUriDomains: [],
    },
    prefersBorder: true,
    ...overrides,
  }
}

describe("MCP App iframe policy", () => {
  test("defaults every ambient capability closed", () => {
    const csp = buildMcpAppCsp(fixture())
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("form-action 'none'")
  })

  test("injects the host-enforced CSP before resource markup runs", () => {
    const html = secureMcpAppHtml(fixture())
    const policy = html.indexOf('http-equiv="Content-Security-Policy"')
    const title = html.indexOf("<title>")
    expect(policy).toBeGreaterThan(-1)
    expect(policy).toBeLessThan(title)
  })

  test("creates a valid policy-bearing head when the resource omits one", () => {
    const html = secureMcpAppHtml(fixture({ html: "<html><body>headless resource</body></html>" }))
    expect(html).toContain('<html><head><meta http-equiv="Content-Security-Policy"')
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<body>"))

    const fragment = secureMcpAppHtml(fixture({ html: "<main>fragment resource</main>" }))
    expect(fragment).toStartWith('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"')
    expect(fragment).toContain("<body><main>fragment resource</main></body>")
  })

  test("rejects executable markup before an existing document policy", () => {
    expect(() => secureMcpAppHtml(fixture({
      html: "<script>globalThis.beforePolicy = true</script><html><head></head><body>bad</body></html>",
    }))).toThrow("executable markup before its HTML root")
    expect(() => secureMcpAppHtml(fixture({
      html: "<html><script>globalThis.beforePolicy = true</script><head></head><body>bad</body></html>",
    }))).toThrow("markup before its policy-bearing head")
  })

  test("allows only the server-declared origins in each directive", () => {
    const csp = buildMcpAppCsp(fixture({
      csp: {
        connectDomains: ["https://api.example.com"],
        resourceDomains: ["https://static.example.com"],
        frameDomains: ["https://embed.example.com"],
        baseUriDomains: [],
      },
    }))
    expect(csp).toContain("connect-src https://api.example.com")
    expect(csp).toContain("script-src 'unsafe-inline' https://static.example.com")
    expect(csp).toContain("frame-src https://embed.example.com")
  })
})
