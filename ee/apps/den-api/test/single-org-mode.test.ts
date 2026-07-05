import { beforeAll, expect, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
}

let envModule: typeof import("../src/env.js")
let singleOrgPolicy: typeof import("../src/single-org-policy.js")

beforeAll(async () => {
  seedRequiredEnv()
  envModule = await import("../src/env.js")
  singleOrgPolicy = await import("../src/single-org-policy.js")
})

test("blank org mode resolves to single_org", () => {
  expect(envModule.parseDenOrgMode(undefined)).toBe("single_org")
  expect(envModule.parseDenOrgMode("")).toBe("single_org")
  expect(envModule.parseDenOrgMode("   ")).toBe("single_org")
})

test("org mode accepts explicit deployment modes and rejects unknown values", () => {
  expect(envModule.parseDenOrgMode("single_org")).toBe("single_org")
  expect(envModule.parseDenOrgMode("multi_org")).toBe("multi_org")
  expect(() => envModule.parseDenOrgMode("single")).toThrow("DEN_ORG_MODE")
})

test("single-org slug normalization keeps Helm-safe slugs strict", () => {
  expect(envModule.normalizeSingleOrgSlug(undefined)).toBe("default")
  expect(envModule.normalizeSingleOrgSlug(" Acme-Internal ")).toBe("acme-internal")
  expect(() => envModule.normalizeSingleOrgSlug("bad slug")).toThrow("DEN_SINGLE_ORG_SLUG")
})

test("single-org owner bootstrap honors configured owner emails", () => {
  expect(singleOrgPolicy.resolveSingleOrgMembershipRole({
    activeOwnerCount: 0,
    email: "admin@example.com",
    ownerEmails: ["admin@example.com"],
  })).toBe("owner")

  expect(singleOrgPolicy.resolveSingleOrgMembershipRole({
    activeOwnerCount: 0,
    email: "user@example.com",
    ownerEmails: ["admin@example.com"],
  })).toBeNull()

  expect(singleOrgPolicy.resolveSingleOrgMembershipRole({
    activeOwnerCount: 1,
    email: "user@example.com",
    ownerEmails: ["admin@example.com"],
  })).toBe("member")
})
