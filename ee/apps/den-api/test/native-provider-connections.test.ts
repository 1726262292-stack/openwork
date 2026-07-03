import { beforeAll, describe, expect, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
}

let mod: typeof import("../src/capability-sources/native-provider-connections.js")
let registry: typeof import("../src/capability-sources/provider-registry.js")

beforeAll(async () => {
  seedRequiredEnv()
  mod = await import("../src/capability-sources/native-provider-connections.js")
  registry = await import("../src/capability-sources/provider-registry.js")
})

describe("buildNativeProviderEntry", () => {
  test("no org client configured means no entry — the org has not enrolled", () => {
    const provider = registry.getNativeOAuthProvider("google-workspace")!
    expect(mod.buildNativeProviderEntry(provider, { clientConfigured: false, connectedForMe: false })).toBeNull()
  })

  test("a configured provider renders as a per-member, connectable entry", () => {
    const provider = registry.getNativeOAuthProvider("google-workspace")!
    expect(mod.buildNativeProviderEntry(provider, { clientConfigured: true, connectedForMe: false })).toEqual({
      id: "google-workspace",
      name: "Google Workspace",
      url: "https://workspace.google.com",
      authType: "oauth",
      credentialMode: "per_member",
      connected: true,
      connectedAt: null,
      connectedForMe: false,
      access: null,
    })
  })

  test("the calling member's own connection state flips connectedForMe only", () => {
    const provider = registry.getNativeOAuthProvider("google-workspace")!
    const entry = mod.buildNativeProviderEntry(provider, { clientConfigured: true, connectedForMe: true })!
    expect(entry.connectedForMe).toBe(true)
    expect(entry.connected).toBe(true)
    expect(entry.credentialMode).toBe("per_member")
  })
})
