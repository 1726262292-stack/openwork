import { expect, test } from "bun:test"
import { buildStaleBetterAuthSessionCookieClearHeaders, normalizeLoginEmail, resolveLoginOptionKind } from "../src/auth-login-options.js"

test("login option resolution normalizes email input", () => {
  expect(normalizeLoginEmail(" User@Example.COM ")).toBe("user@example.com")
})

test("login option resolution prioritizes SSO before account providers", () => {
  expect(resolveLoginOptionKind({
    requireSso: true,
    accounts: [
      { providerId: "google", hasPassword: false },
      { providerId: "credential", hasPassword: true },
    ],
  })).toBe("sso")
})

test("login option resolution prefers Google, then password, then GitHub compatibility", () => {
  expect(resolveLoginOptionKind({
    requireSso: false,
    accounts: [
      { providerId: "credential", hasPassword: true },
      { providerId: "google", hasPassword: false },
    ],
  })).toBe("google")

  expect(resolveLoginOptionKind({
    requireSso: false,
    accounts: [
      { providerId: "github", hasPassword: false },
      { providerId: "credential", hasPassword: true },
    ],
  })).toBe("password")

  expect(resolveLoginOptionKind({
    requireSso: false,
    accounts: [{ providerId: "github", hasPassword: false }],
  })).toBe("github")
})

test("login option resolution returns new account when no existing auth method matches", () => {
  expect(resolveLoginOptionKind({ requireSso: false, accounts: [] })).toBe("new_account")
})

test("login option resolution keeps private single-org unknown users in sign-in", () => {
  expect(resolveLoginOptionKind({
    requireSso: false,
    accounts: [],
    allowNewAccount: false,
  })).toBe("password")
})

test("login option cookie cleanup expires secure, legacy, domain, and host-only session cookies", () => {
  const headers = buildStaleBetterAuthSessionCookieClearHeaders({
    cookieDomain: ".app.openworklabs.com",
    requestHost: "api.app.openworklabs.com",
  })

  expect(headers).toContain("__Secure-better-auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax")
  expect(headers).toContain("__Secure-better-auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Domain=app.openworklabs.com")
  expect(headers).toContain("__Secure-better-auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Domain=api.app.openworklabs.com")
  expect(headers.some((header) => header.startsWith("better-auth.session_token="))).toBe(true)
  expect(headers.some((header) => header.startsWith("better-auth-session_token="))).toBe(true)
})
