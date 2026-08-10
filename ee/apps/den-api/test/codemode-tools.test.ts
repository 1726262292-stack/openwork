import { beforeAll, expect, test } from "bun:test"
import { Tool } from "@openwork/codemode"
import { Effect } from "effect"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
}

let buildExternalNamespaceMap: typeof import("../src/mcp/codemode-tools.js")["buildExternalNamespaceMap"]
let isCodemodeEligibleConnection: typeof import("../src/mcp/codemode-tools.js")["isCodemodeEligibleConnection"]
let firstUnattendedUnsafeCapability: typeof import("../src/mcp/codemode-tools.js")["firstUnattendedUnsafeCapability"]
let restrictCodemodeToolTree: typeof import("../src/mcp/codemode-tools.js")["restrictCodemodeToolTree"]
let sanitizeNamespaceSegment: typeof import("../src/mcp/codemode-tools.js")["sanitizeNamespaceSegment"]

beforeAll(async () => {
  seedRequiredEnv()
  const codemodeTools = await import("../src/mcp/codemode-tools.js")
  buildExternalNamespaceMap = codemodeTools.buildExternalNamespaceMap
  isCodemodeEligibleConnection = codemodeTools.isCodemodeEligibleConnection
  firstUnattendedUnsafeCapability = codemodeTools.firstUnattendedUnsafeCapability
  restrictCodemodeToolTree = codemodeTools.restrictCodemodeToolTree
  sanitizeNamespaceSegment = codemodeTools.sanitizeNamespaceSegment
})

test("sanitizes connection names into interpreter-safe namespaces", () => {
  expect(sanitizeNamespaceSegment("Acme Drive")).toBe("acme_drive")
  expect(sanitizeNamespaceSegment("123 / CRM")).toBe("_123_crm")
  expect(sanitizeNamespaceSegment("***")).toBe("_")
})

test("reserves prototype-sensitive connection namespaces", () => {
  const namespaces = buildExternalNamespaceMap([
    { id: "proto", name: "__proto__" },
    { id: "constructor", name: "constructor" },
    { id: "prototype", name: "prototype" },
  ])

  expect([...namespaces.values()]).toEqual(["__proto___2", "constructor_2", "prototype_2"])
})

test("restricts prototype-sensitive namespaces without mutating Object.prototype", () => {
  const definition = Tool.make({
    description: "Prototype safety test tool",
    input: { type: "object" },
    run: () => Effect.succeed("safe"),
  })
  const entry = { scriptPath: "tools.__proto__.someToolName", capabilityName: "prototypeSafety" }
  expect(Object.hasOwn(Object.prototype, "someToolName")).toBe(false)

  const result = restrictCodemodeToolTree({
    built: {
      tools: Object.fromEntries([["__proto__", { someToolName: definition }]]),
      manifest: [entry],
    },
    requiredCapabilities: [entry],
  })

  expect(Object.hasOwn(Object.prototype, "someToolName")).toBe(false)
  expect(result.missing).toEqual([])
  expect(result.tools.__proto__?.someToolName).toBe(definition)
})

test("excludes connections disabled or pending OAuth issuer review", () => {
  expect(isCodemodeEligibleConnection({
    toolPolicy: { version: 1, allDisabled: true, disabledTools: [] },
    oauthIssuerReviewRequiredAt: null,
  })).toBe(false)
  expect(isCodemodeEligibleConnection({
    toolPolicy: null,
    oauthIssuerReviewRequiredAt: new Date(),
  })).toBe(false)
  expect(isCodemodeEligibleConnection({
    toolPolicy: null,
    oauthIssuerReviewRequiredAt: null,
  })).toBe(true)
})

test("allows only explicitly read-only capabilities in unattended Cloud runs", () => {
  const required = { scriptPath: "tools.reports.read", capabilityName: "reports.read" }
  const built = {
    tools: {},
    manifest: [{ ...required, readOnly: true }],
  }
  expect(firstUnattendedUnsafeCapability(built, [required])).toBeNull()
  expect(firstUnattendedUnsafeCapability({ ...built, manifest: [{ ...required, readOnly: false }] }, [required])).toEqual(required)
  expect(firstUnattendedUnsafeCapability({ ...built, manifest: [] }, [required])).toEqual(required)
})
