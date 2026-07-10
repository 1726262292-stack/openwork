import { beforeAll, describe, expect, test } from "bun:test"

let oauth: typeof import("../src/capability-sources/generic-oauth.js")

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  oauth = await import("../src/capability-sources/generic-oauth.js")
})

describe("OAuth token response validation", () => {
  test("accepts the standard authorization and refresh response fields", () => {
    expect(oauth.parseOAuthTokenResponse({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3_600,
      token_type: "Bearer",
      scope: "openid Mail.Read",
      ignored_provider_extension: true,
    })).toEqual({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3_600,
      token_type: "Bearer",
      scope: "openid Mail.Read",
    })
  })

  test("rejects missing, blank, or incorrectly typed access tokens", () => {
    for (const response of [{}, { access_token: "" }, { access_token: 123 }]) {
      expect(() => oauth.parseOAuthTokenResponse(response)).toThrow(oauth.OAuthTokenExchangeError)
    }
  })
})
