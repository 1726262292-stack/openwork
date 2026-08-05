import { createHash } from "node:crypto"
import { beforeAll, expect, test } from "bun:test"

let loginOptionsRateLimitKeys: typeof import("../src/routes/auth/index.js").loginOptionsRateLimitKeys
let ssoResolveRateLimitKeys: typeof import("../src/routes/org/core.js").ssoResolveRateLimitKeys

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"

  const [authRoutes, orgRoutes] = await Promise.all([
    import("../src/routes/auth/index.js"),
    import("../src/routes/org/core.js"),
  ])
  loginOptionsRateLimitKeys = authRoutes.loginOptionsRateLimitKeys
  ssoResolveRateLimitKeys = orgRoutes.ssoResolveRateLimitKeys
})

test("login options rate-limit keys include only the IP and email", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.42, 10.0.0.1" })
  const keys = loginOptionsRateLimitKeys(headers, "jordan@company.test")

  expect(keys).toEqual([
    `auth-login-options:ip:${sha256Hex("203.0.113.42")}`,
    `auth-login-options:email:${sha256Hex("jordan@company.test")}`,
  ])
  expect(keys.some((key) => key.includes(":domain:"))).toBe(false)
})

test("SSO resolution rate-limit keys include only the IP and normalized email", () => {
  const headers = new Headers({ "x-real-ip": "203.0.113.43" })
  const keys = ssoResolveRateLimitKeys(headers, " Jordan@Company.Test ")

  expect(keys).toEqual([
    `org-sso-resolve:ip:${sha256Hex("203.0.113.43")}`,
    `org-sso-resolve:email:${sha256Hex("jordan@company.test")}`,
  ])
  expect(keys.some((key) => key.includes(":domain:"))).toBe(false)
})

test("coworkers at one domain have distinct endpoint key sets", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.44" })
  const firstLoginKeys = loginOptionsRateLimitKeys(headers, "first@company.test")
  const secondLoginKeys = loginOptionsRateLimitKeys(headers, "second@company.test")
  const firstSsoKeys = ssoResolveRateLimitKeys(headers, "first@company.test")
  const secondSsoKeys = ssoResolveRateLimitKeys(headers, "second@company.test")

  expect(firstLoginKeys).not.toEqual(secondLoginKeys)
  expect(firstSsoKeys).not.toEqual(secondSsoKeys)
  expect(firstLoginKeys[0]).toBe(secondLoginKeys[0])
  expect(firstSsoKeys[0]).toBe(secondSsoKeys[0])
  expect(firstLoginKeys[1]).not.toBe(secondLoginKeys[1])
  expect(firstSsoKeys[1]).not.toBe(secondSsoKeys[1])
})
