import { expect, test } from "bun:test"
import {
  externalMcpIdentityBinding,
  type ExternalMcpOAuthStateIdentitySource,
} from "../src/capability-sources/external-mcp-oauth-state-identity.js"

test("OAuth state identity binding excludes connection credentials", () => {
  const connection = {
    id: "emc_01identitybinding",
    kind: "external_mcp",
    url: "https://mcp.example.test/api/",
    authType: "oauth",
    credentialMode: "per_member",
    apiKey: "secret-api-key",
    accessToken: "secret-access-token",
    refreshToken: "secret-refresh-token",
  } satisfies ExternalMcpOAuthStateIdentitySource & {
    apiKey: string
    accessToken: string
    refreshToken: string
  }

  const binding = externalMcpIdentityBinding(connection)
  expect(externalMcpIdentityBinding({
    ...connection,
    apiKey: "different-api-key",
    accessToken: "different-access-token",
    refreshToken: "different-refresh-token",
  })).toBe(binding)
  expect(externalMcpIdentityBinding({ ...connection, url: "https://other.example.test/api" })).not.toBe(binding)
  expect(binding).toMatch(/^[A-Za-z0-9_-]+$/)
  expect(Buffer.from(binding, "base64url").toString("utf8")).not.toContain("secret")
})
