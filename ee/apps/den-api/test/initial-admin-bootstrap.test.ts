import { createHash } from "node:crypto"
import { beforeAll, expect, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
}

let bootstrap: typeof import("../src/initial-admin-bootstrap.js")
let envModule: typeof import("../src/env.js")

beforeAll(async () => {
  seedRequiredEnv()
  bootstrap = await import("../src/initial-admin-bootstrap.js")
  envModule = await import("../src/env.js")
})

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

test("initial admin bootstrap normalizes emails like auth login", () => {
  expect(bootstrap.normalizeInitialAdminBootstrapEmail(" Initial.Admin@Example.COM ")).toBe("initial.admin@example.com")
})

test("initial admin bootstrap compares one-time codes against sha256 digests", () => {
  const code = "operator supplied one-time code"
  expect(bootstrap.compareInitialAdminBootstrapCode({ submittedCode: code, expectedSha256Hex: digest(code) })).toBe(true)
  expect(bootstrap.compareInitialAdminBootstrapCode({ submittedCode: `${code}!`, expectedSha256Hex: digest(code) })).toBe(false)
  expect(bootstrap.compareInitialAdminBootstrapCode({ submittedCode: code, expectedSha256Hex: "not-a-digest" })).toBe(false)
})

test("initial admin bootstrap parses digest configuration fail-closed", () => {
  expect(envModule.parseSha256Digest(undefined)).toEqual({ status: "missing", value: undefined })
  expect(envModule.parseSha256Digest("  ")).toEqual({ status: "missing", value: undefined })
  expect(envModule.parseSha256Digest("z".repeat(64))).toEqual({ status: "malformed", value: undefined })
  expect(envModule.parseSha256Digest(digest("setup"))).toEqual({ status: "configured", value: digest("setup") })
})

test("initial admin bootstrap grant format is single-purpose", () => {
  expect(bootstrap.isInitialAdminBootstrapGrantFormat(`${bootstrap.INITIAL_ADMIN_BOOTSTRAP_GRANT_PREFIX}abc123`)).toBe(true)
  expect(bootstrap.isInitialAdminBootstrapGrantFormat(bootstrap.INITIAL_ADMIN_BOOTSTRAP_GRANT_PREFIX)).toBe(false)
  expect(bootstrap.isInitialAdminBootstrapGrantFormat("regular-session-token")).toBe(false)
})
