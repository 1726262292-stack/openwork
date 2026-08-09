import { beforeAll, expect, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
}

let buildCodemodeManifest: typeof import("../src/mcp/codemode-tools.js")["buildCodemodeManifest"]
let sanitizeNamespaceSegment: typeof import("../src/mcp/codemode-tools.js")["sanitizeNamespaceSegment"]
let buildMcpCatalog: typeof import("../src/mcp/catalog.js")["buildMcpCatalog"]

beforeAll(async () => {
  seedRequiredEnv()
  const codemodeTools = await import("../src/mcp/codemode-tools.js")
  buildCodemodeManifest = codemodeTools.buildCodemodeManifest
  sanitizeNamespaceSegment = codemodeTools.sanitizeNamespaceSegment
  buildMcpCatalog = (await import("../src/mcp/catalog.js")).buildMcpCatalog
})

test("sanitizes connection names into interpreter-safe namespaces", () => {
  expect(sanitizeNamespaceSegment("Acme Drive")).toBe("acme_drive")
  expect(sanitizeNamespaceSegment("123 / CRM")).toBe("_123_crm")
  expect(sanitizeNamespaceSegment("***")).toBe("_")
})

test("builds exact Den and collision-deduplicated external script paths", () => {
  const catalog = buildMcpCatalog({
    paths: {
      "/v1/workers": {
        get: {
          operationId: "getV1Workers",
          summary: "List workers",
          tags: ["Workers"],
        },
      },
    },
  })
  const manifest = buildCodemodeManifest({
    catalog,
    externalConnections: [
      { id: "connection_one", name: "Acme Drive", tools: [{ name: "search_files" }] },
      { id: "connection_two", name: "Acme-Drive", tools: [{ name: "list-files" }] },
      { id: "connection_three", name: "Den", tools: [{ name: "lookup" }] },
    ],
  })

  expect(manifest).toEqual([
    { scriptPath: "tools.den.getWorkers", capabilityName: "getWorkers" },
    { scriptPath: "tools.acme_drive.search_files", capabilityName: "mcp:connection_one:search_files" },
    { scriptPath: "tools.acme_drive_2[\"list-files\"]", capabilityName: "mcp:connection_two:list-files" },
    { scriptPath: "tools.den_2.lookup", capabilityName: "mcp:connection_three:lookup" },
  ])
})
