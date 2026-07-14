import { beforeAll, describe, expect, test } from "bun:test"

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"

let normalizeExternalMcpUrl = (value: string): string => value
let normalizeExternalMcpIdentityUrl = (value: string): string => value

beforeAll(async () => {
  const module = await import("../src/capability-sources/external-mcp-connections.js")
  normalizeExternalMcpUrl = module.normalizeExternalMcpUrl
  normalizeExternalMcpIdentityUrl = module.normalizeExternalMcpIdentityUrl
})

describe("normalizeExternalMcpUrl", () => {
  test("strips a trailing hostname dot", () => {
    expect(normalizeExternalMcpUrl("https://us.posthog.com./mcp")).toBe("https://us.posthog.com/mcp")
  })

  test("strips multiple trailing hostname dots", () => {
    expect(normalizeExternalMcpUrl("https://us.posthog.com.../mcp")).toBe("https://us.posthog.com/mcp")
  })

  test("normalizes hostname case through the URL parser", () => {
    expect(normalizeExternalMcpUrl("HTTPS://US.PostHog.COM./mcp")).toBe("https://us.posthog.com/mcp")
  })

  test("preserves path, query, and non-default port", () => {
    expect(normalizeExternalMcpUrl("https://US.PostHog.COM.:8443/mcp/v1/?feature=a%2Fb&flag=1")).toBe(
      "https://us.posthog.com:8443/mcp/v1/?feature=a%2Fb&flag=1",
    )
  })

  test("leaves already canonical URLs unchanged", () => {
    expect(normalizeExternalMcpUrl("https://us.posthog.com/mcp?feature=analytics")).toBe(
      "https://us.posthog.com/mcp?feature=analytics",
    )
    expect(normalizeExternalMcpUrl("https://us.posthog.com")).toBe("https://us.posthog.com")
  })
})

describe("normalizeExternalMcpIdentityUrl", () => {
  test("treats trailing-dot and canonical hostnames as the same identity", () => {
    expect(normalizeExternalMcpIdentityUrl("https://x.com./mcp")).toBe(
      normalizeExternalMcpIdentityUrl("https://x.com/mcp"),
    )
  })
})
