import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { beforeAll, describe, expect, test } from "bun:test"

import type { OrgOAuthClientRow } from "../src/capability-sources/oauth-credentials.js"

const GOOGLE_WORKSPACE_BASE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/drive.file",
]

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
}

let registry: typeof import("../src/capability-sources/provider-registry.js")
let oauth: typeof import("../src/capability-sources/generic-oauth.js")

beforeAll(async () => {
  seedRequiredEnv()
  registry = await import("../src/capability-sources/provider-registry.js")
  oauth = await import("../src/capability-sources/generic-oauth.js")
})

function googleWorkspaceProvider() {
  const provider = registry.getNativeOAuthProvider("google-workspace")
  if (!provider) {
    throw new Error("google-workspace provider is missing")
  }
  return provider
}

describe("google-workspace native provider scopes", () => {
  test("defaultScopes matches the desktop base set", () => {
    expect(googleWorkspaceProvider().defaultScopes).toEqual(GOOGLE_WORKSPACE_BASE_SCOPES)
  })

  test("resolveProviderScopes adds selected feature scopes and dedupes", () => {
    const scopes = registry.resolveProviderScopes(googleWorkspaceProvider(), ["gmailRead", "calendarWrite", "gmailRead"])

    expect(scopes).toEqual([
      ...GOOGLE_WORKSPACE_BASE_SCOPES,
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ])
  })

  test("clientSelectedFeatures ignores unknown keys, non-strings, and absent extra", () => {
    const provider = googleWorkspaceProvider()

    expect(registry.clientSelectedFeatures(provider, null)).toEqual([])
    expect(registry.clientSelectedFeatures(provider, {})).toEqual([])
    expect(registry.clientSelectedFeatures(provider, {
      features: ["gmailRead", "unknown", 42, "calendarWrite", null],
    })).toEqual(["gmailRead", "calendarWrite"])
  })

  test("buildAuthorizeUrl includes base scopes plus selected optional feature scopes", () => {
    const client: OrgOAuthClientRow = {
      id: createDenTypeId("orgOAuthClient"),
      organizationId: createDenTypeId("organization"),
      providerId: "google-workspace",
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
      extra: { features: ["gmailRead", "calendarWrite"] },
      createdByOrgMembershipId: createDenTypeId("member"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }

    const authorizeUrl = oauth.buildAuthorizeUrl({
      provider: googleWorkspaceProvider(),
      client,
      state: "state-token",
      redirectUri: "http://127.0.0.1:8790/v1/oauth-providers/google-workspace/connect/callback",
      codeChallenge: "pkce-challenge",
    })
    const scopes = new URL(authorizeUrl).searchParams.get("scope")?.split(" ") ?? []

    expect(scopes).toEqual([
      ...GOOGLE_WORKSPACE_BASE_SCOPES,
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ])
  })
})
