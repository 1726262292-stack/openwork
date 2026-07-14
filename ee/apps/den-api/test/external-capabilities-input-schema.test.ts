import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test"
import type { ExternalMcpConnectionRow } from "../src/capability-sources/external-mcp-connections.js"
import type { McpMemberIdentity } from "../src/mcp/external-capabilities.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test_inputschema"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "local-dev-db-encryption-key-please-change-1234567890"
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "local-dev-secret-not-for-production-use!!"
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
}

seedRequiredEnv()

const redirectUriBase = "http://127.0.0.1:8790"
const longDescription = "Long incident field description. ".repeat(8)
const enumValues = Array.from({ length: 12 }, (_, index) => `value-${index}`)

type FakeTool = {
  name: string
  title?: string
  description?: string
  inputSchema: unknown
}

let currentConnection = connectionFixture()
let currentTools: FakeTool[] = []
const listExternalMcpToolsMock = mock(async () => currentTools)
const callExternalMcpToolMock = mock(async () => ({ content: [{ type: "text", text: "provider called" }] }))
const getExternalMcpConnectionMock = mock(async () => currentConnection)
const listUsableExternalMcpConnectionsMock = mock(async () => [currentConnection])
const memberCanUseExternalMcpConnectionMock = mock(async () => true)
const getConnectedAccountMock = mock(async () => null)
const listTeamsForMemberMock = mock(async () => [])

let searchExternalCapabilities: typeof import("../src/mcp/external-capabilities.js").searchExternalCapabilities
let executeExternalCapability: typeof import("../src/mcp/external-capabilities.js").executeExternalCapability
let externalMcpInputSchemaHash: typeof import("../src/mcp/external-capabilities.js").externalMcpInputSchemaHash

function connectionFixture(): ExternalMcpConnectionRow {
  const now = new Date()
  return {
    id: createDenTypeId("externalMcpConnection"),
    organizationId: createDenTypeId("organization"),
    name: "ServiceNow",
    url: "https://servicenow.example.test/mcp",
    authType: "none",
    credentialMode: "shared",
    apiKey: null,
    accessToken: null,
    refreshToken: null,
    tokenType: null,
    scope: null,
    expiresAt: null,
    pendingCodeVerifier: null,
    connectedAt: null,
    createdByOrgMembershipId: createDenTypeId("member"),
    createdAt: now,
    updatedAt: now,
  }
}

function memberIdentity(): McpMemberIdentity {
  return { orgMembershipId: createDenTypeId("member"), teamIds: [] }
}

function requiredIncidentSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["incident_number"],
    properties: {
      incident_number: { type: "string", description: "Incident number" },
    },
  }
}

function optionalPingSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      optional_note: { type: "string", description: "Optional note" },
    },
  }
}

function manyPropertySchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (let index = 0; index < 30; index += 1) {
    const name = `field_${String(index).padStart(2, "0")}`
    properties[name] = index === 0
      ? { type: "string", description: longDescription, enum: enumValues }
      : { type: "string" }
  }
  return {
    type: "object",
    required: ["field_00", "field_01"],
    properties,
  }
}

function createExternalMcpLifecycleDeadline() {
  const controller = new AbortController()
  return {
    expiresAt: Date.now() + 45_000,
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
  }
}

beforeAll(async () => {
  seedRequiredEnv()
  mock.restore()
  mock.module("../src/db.js", () => ({ db: {} }))
  mock.module("../src/orgs.js", () => ({ listTeamsForMember: listTeamsForMemberMock }))
  mock.module("../src/capability-sources/oauth-credentials.js", () => ({ getConnectedAccount: getConnectedAccountMock }))
  mock.module("../src/capability-sources/external-mcp-client.js", () => ({ createExternalMcpLifecycleDeadline }))
  mock.module("../src/capability-sources/external-mcp-client-runtime.js", () => ({
    callExternalMcpTool: callExternalMcpToolMock,
    listExternalMcpTools: listExternalMcpToolsMock,
  }))
  mock.module("../src/capability-sources/external-mcp-connections.js", () => ({
    getExternalMcpConnection: getExternalMcpConnectionMock,
    listUsableExternalMcpConnections: listUsableExternalMcpConnectionsMock,
    memberCanUseExternalMcpConnection: memberCanUseExternalMcpConnectionMock,
  }))
  const capabilitiesMod = await import("../src/mcp/external-capabilities.js")
  searchExternalCapabilities = capabilitiesMod.searchExternalCapabilities
  executeExternalCapability = capabilitiesMod.executeExternalCapability
  externalMcpInputSchemaHash = capabilitiesMod.externalMcpInputSchemaHash
})

beforeEach(() => {
  currentConnection = connectionFixture()
  currentTools = []
  listExternalMcpToolsMock.mockClear()
  listExternalMcpToolsMock.mockImplementation(async () => currentTools)
  callExternalMcpToolMock.mockClear()
  callExternalMcpToolMock.mockImplementation(async () => ({ content: [{ type: "text", text: "provider called" }] }))
  getExternalMcpConnectionMock.mockClear()
  getExternalMcpConnectionMock.mockImplementation(async () => currentConnection)
  listUsableExternalMcpConnectionsMock.mockClear()
  listUsableExternalMcpConnectionsMock.mockImplementation(async () => [currentConnection])
  memberCanUseExternalMcpConnectionMock.mockClear()
  memberCanUseExternalMcpConnectionMock.mockImplementation(async () => true)
  getConnectedAccountMock.mockClear()
  listTeamsForMemberMock.mockClear()
})

afterAll(() => {
  mock.restore()
})

test("external MCP search includes a bounded inputSummary", async () => {
  const schema = manyPropertySchema()
  currentTools = [{ name: "wide_incident_search", description: "Search incidents with a wide schema.", inputSchema: schema }]

  const matches = await searchExternalCapabilities({
    organizationId: currentConnection.organizationId,
    member: memberIdentity(),
    query: "wide incident",
    redirectUriBase,
    limit: 10,
  })
  const match = matches.find((candidate) => candidate.name === `mcp:${currentConnection.id}:wide_incident_search`)
  if (!match?.inputSummary) throw new Error("wide_incident_search match did not include inputSummary")

  expect(Object.keys(match.inputSummary.properties)).toHaveLength(24)
  expect(match.inputSummary.truncated).toBe(true)
  expect(match.inputSummary.properties.field_00?.description).toBe(longDescription.slice(0, 120))
  expect(match.inputSummary.properties.field_00?.enum).toEqual(enumValues.slice(0, 8))
  expect(match.inputSummary.properties.field_24).toBeUndefined()
  expect(match.schemaHash).toBe(externalMcpInputSchemaHash(schema))
  expect(listExternalMcpToolsMock.mock.calls).toHaveLength(1)
})

test("schemaHash is stable across key order and changes when schema changes", () => {
  const schemaA = {
    type: "object",
    required: ["incident_number"],
    properties: {
      incident_number: { type: "string", description: "Incident number" },
      limit: { type: "integer" },
    },
  }
  const schemaB = {
    properties: {
      limit: { type: "integer" },
      incident_number: { description: "Incident number", type: "string" },
    },
    required: ["incident_number"],
    type: "object",
  }
  const schemaC = {
    type: "object",
    required: ["incident_number"],
    properties: {
      incident_number: { type: "string", description: "Changed" },
      limit: { type: "integer" },
    },
  }

  expect(externalMcpInputSchemaHash(schemaA)).toBe(externalMcpInputSchemaHash(schemaB))
  expect(externalMcpInputSchemaHash(schemaA)).not.toBe(externalMcpInputSchemaHash(schemaC))
})

test("empty execute args for a required-input tool returns missing_required_arguments without calling the provider tool", async () => {
  currentTools = [{ name: "lookup_incident", description: "Lookup an incident.", inputSchema: requiredIncidentSchema() }]

  const result = await executeExternalCapability({
    organizationId: currentConnection.organizationId,
    member: memberIdentity(),
    connectionId: currentConnection.id,
    toolName: "lookup_incident",
    args: {},
    redirectUriBase,
  })

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error("Required-input tool unexpectedly executed")
  expect(result.error).toBe("missing_required_arguments")
  expect(result.message).toContain("incident_number")
  expect(result.inputSummary?.required).toEqual(["incident_number"])
  expect(result.schemaHash).toBe(externalMcpInputSchemaHash(requiredIncidentSchema()))
  expect(listExternalMcpToolsMock.mock.calls).toHaveLength(1)
  expect(callExternalMcpToolMock.mock.calls).toHaveLength(0)
})

test("empty execute args for a tool with no required fields calls the provider normally", async () => {
  currentTools = [{ name: "ping_without_args", description: "Ping without args.", inputSchema: optionalPingSchema() }]

  const result = await executeExternalCapability({
    organizationId: currentConnection.organizationId,
    member: memberIdentity(),
    connectionId: currentConnection.id,
    toolName: "ping_without_args",
    args: {},
    redirectUriBase,
  })

  expect(result.ok).toBe(true)
  expect(listExternalMcpToolsMock.mock.calls).toHaveLength(1)
  expect(callExternalMcpToolMock.mock.calls).toHaveLength(1)
})

test("non-empty execute args skip the tools/list pre-check", async () => {
  currentTools = [{ name: "lookup_incident", description: "Lookup an incident.", inputSchema: requiredIncidentSchema() }]

  const result = await executeExternalCapability({
    organizationId: currentConnection.organizationId,
    member: memberIdentity(),
    connectionId: currentConnection.id,
    toolName: "lookup_incident",
    args: { incident_number: "INC001" },
    redirectUriBase,
  })

  expect(result.ok).toBe(true)
  expect(listExternalMcpToolsMock.mock.calls).toHaveLength(0)
  expect(callExternalMcpToolMock.mock.calls).toHaveLength(1)
})
