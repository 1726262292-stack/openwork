import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import type { DenTypeId } from "@openwork-ee/utils/typeid"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "local-dev-db-encryption-key-please-change-1234567890"
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "local-dev-secret-not-for-production-use!!"
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
  process.env.DEN_ALLOW_PRIVATE_MCP_URLS = "1"
}

seedRequiredEnv()

const redirectUriBase = "http://127.0.0.1:8790"
const guardedToolName = "search_servicenow_incidents"
const providerName = "Northwind"
const antiRegressionStrings = ["check provider latency", "protocol lifecycle", "MCP transport"]

type SeededOrganization = {
  organizationId: DenTypeId<"organization">
  memberId: DenTypeId<"member">
}

type MockScenarioServer = {
  origin: string
  mcpUrl: string
  stop: () => Promise<void>
  logs: () => string
}

let db: typeof import("../src/db.js").db
let schema: typeof import("@openwork-ee/den-db/schema")
let createDenTypeId: typeof import("@openwork-ee/utils/typeid").createDenTypeId
let createExternalMcpConnection: typeof import("../src/capability-sources/external-mcp-connections.js").createExternalMcpConnection
let searchExternalCapabilities: typeof import("../src/mcp/external-capabilities.js").searchExternalCapabilities
let executeExternalCapability: typeof import("../src/mcp/external-capabilities.js").executeExternalCapability

const activeServers: MockScenarioServer[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function own(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined
  return value[key]
}

async function fetchJson(url: string, options?: RequestInit): Promise<{ response: Response; body: unknown; text: string }> {
  const response = await fetch(url, options)
  const text = await response.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {}
  return { response, body, text }
}

async function getAvailablePort(): Promise<number> {
  const server = createServer()
  return await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address === "object" && address !== null) {
        const port = address.port
        server.close((error) => {
          if (error) reject(error)
          else resolve(port)
        })
        return
      }
      server.close(() => reject(new Error("Could not reserve a TCP port for the mock MCP server")))
    })
  })
}

async function waitForMockServer(origin: string, logs: () => string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await fetch(`${origin}/health`).catch(() => null)
    if (result?.ok) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Mock MCP server did not become healthy at ${origin}. Logs:\n${logs()}`)
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ])
}

async function stopChild(child: ChildProcessWithoutNullStreams, exited: () => boolean): Promise<void> {
  if (exited()) return
  child.kill("SIGTERM")
  await waitForExit(child)
  if (exited()) return
  child.kill("SIGKILL")
  await waitForExit(child)
}

async function startMockScenario(input: {
  mode: "authorization_required" | "authorization_required_uncorrelated"
  getStream?: "reset" | "405"
}): Promise<MockScenarioServer> {
  const port = await getAvailablePort()
  const origin = `http://127.0.0.1:${port}`
  const scriptPath = fileURLToPath(new URL("../../../../scripts/mock-oauth-mcp-server.mjs", import.meta.url))
  const child = spawn("node", [scriptPath], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      MOCK_ALLOW_UNAUTHENTICATED_MCP: "1",
      MOCK_ERROR_TOOL_NAME: guardedToolName,
      MOCK_ERROR_TOOL_TITLE: "Search ServiceNow incidents",
      MOCK_ERROR_TOOL_DESCRIPTION: "Search ServiceNow-style incidents after provider authorization.",
      MOCK_ERROR_TOOL_MODE: input.mode,
      MOCK_ERROR_TOOL_PROVIDER: providerName,
      MOCK_GET_STREAM: input.getStream ?? "405",
    },
  })
  let output = ""
  let hasExited = false
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk: string | Buffer) => {
    output += String(chunk)
  })
  child.stderr.on("data", (chunk: string | Buffer) => {
    output += String(chunk)
  })
  child.on("exit", (code: number | null, signal: string | null) => {
    hasExited = true
    output += `[mock exited code=${code ?? "null"} signal=${signal ?? "null"}]\n`
  })
  const server = {
    origin,
    mcpUrl: `${origin}/mcp`,
    stop: () => stopChild(child, () => hasExited),
    logs: () => output,
  }
  activeServers.push(server)
  await waitForMockServer(origin, () => output)
  return server
}

async function seedOrganization(label: string): Promise<SeededOrganization> {
  const userId = createDenTypeId("user")
  const organizationId = createDenTypeId("organization")
  const memberId = createDenTypeId("member")
  await db.insert(schema.AuthUserTable).values({
    id: userId,
    name: `${label} User`,
    email: `${label}+${userId}@test.local`,
  })
  await db.insert(schema.OrganizationTable).values({
    id: organizationId,
    name: `${label} Org`,
    slug: `${label}-${organizationId}`,
  })
  await db.insert(schema.MemberTable).values({
    id: memberId,
    organizationId,
    userId,
    role: "member",
  })
  return { organizationId, memberId }
}

async function createGrantedConnection(seed: SeededOrganization, server: MockScenarioServer, label: string) {
  return createExternalMcpConnection({
    organizationId: seed.organizationId,
    name: `${label} ServiceNow Gateway`,
    url: server.mcpUrl,
    authType: "none",
    credentialMode: "shared",
    apiKey: null,
    createdByOrgMembershipId: seed.memberId,
    access: { orgWide: true, memberIds: [], teamIds: [] },
  })
}

async function discoverCapability(seed: SeededOrganization, connectionId: string, connectionName: string) {
  const matches = await searchExternalCapabilities({
    organizationId: seed.organizationId,
    member: { orgMembershipId: seed.memberId, teamIds: [] },
    query: `${connectionName} incidents`,
    redirectUriBase,
    limit: 10,
  })
  const capabilityName = `mcp:${connectionId}:${guardedToolName}`
  const match = matches.find((candidate) => candidate.name === capabilityName)
  if (!match) throw new Error(`Capability ${capabilityName} was not discovered`)
  if (typeof match.schemaDigest !== "string") throw new Error(`Capability ${capabilityName} did not include a schema digest`)
  return { capabilityName, schemaDigest: match.schemaDigest }
}

function assertNoTransportWording(message: string): void {
  const lower = message.toLowerCase()
  for (const phrase of antiRegressionStrings) {
    expect(lower).not.toContain(phrase.toLowerCase())
  }
}

async function executeNeedsConnection(input: {
  seed: SeededOrganization
  connectionId: string
  toolName: string
  schemaDigest: string
  server: MockScenarioServer
}) {
  const result = await executeExternalCapability({
    organizationId: input.seed.organizationId,
    member: { orgMembershipId: input.seed.memberId, teamIds: [] },
    connectionId: input.connectionId,
    toolName: input.toolName,
    args: {},
    schemaDigest: input.schemaDigest,
    redirectUriBase,
  })

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error("Provider auth-required execution unexpectedly succeeded")
  expect(result.error).toBe("needs_connection")
  expect(result.retryable).toBe(false)
  expect(result.providerError?.jsonRpcCode).toBe(-32001)
  expect(result.providerError?.message).toContain("Authorization required")
  expect(result.providerError?.message).toContain(providerName)
  if (typeof result.referenceId !== "string") throw new Error("Provider auth-required result did not include a referenceId")
  expect(result.referenceId.length).toBeGreaterThan(0)
  assertNoTransportWording(result.message)

  const connectionStatus = result.connectionStatus
  if (!connectionStatus) throw new Error("Provider auth-required result did not include connectionStatus")
  const actionUrl = connectionStatus.action.url
  if (typeof actionUrl !== "string") throw new Error("Provider auth-required result did not include a connect action URL")
  const parsedActionUrl = new URL(actionUrl)
  expect(parsedActionUrl.origin).toBe(input.server.origin)
  expect(parsedActionUrl.pathname).toBe("/connect/start")
  expect(connectionStatus).toMatchObject({
    layer: "downstream_provider",
    state: "needs_connection",
    errorCode: "not_connected",
    action: {
      type: "connect",
      surface: "openwork_your_connections",
      retry: "search_capabilities",
      url: actionUrl,
    },
  })
  expect("diagnostic" in result).toBe(false)
  expect("actionOwner" in result).toBe(false)
  expect("operatorAction" in result).toBe(false)
  expect("diagnostic" in connectionStatus).toBe(false)
  return { result, actionUrl }
}

async function completeConnectFlow(actionUrl: string): Promise<void> {
  const start = await fetch(actionUrl)
  expect(start.status).toBe(200)
  expect(start.headers.get("content-type") ?? "").toContain("text/html")
  expect(await start.text()).toContain("Sign in and authorize")

  const completeUrl = new URL("/connect/complete", actionUrl).toString()
  const complete = await fetch(completeUrl, { method: "POST" })
  expect(complete.status).toBe(200)
  expect(complete.headers.get("content-type") ?? "").toContain("text/html")
  expect(await complete.text()).toContain("Connected — return to the app")
}

async function executeSucceeds(input: {
  seed: SeededOrganization
  connectionId: string
  toolName: string
  schemaDigest: string
}) {
  const result = await executeExternalCapability({
    organizationId: input.seed.organizationId,
    member: { orgMembershipId: input.seed.memberId, teamIds: [] },
    connectionId: input.connectionId,
    toolName: input.toolName,
    args: {},
    schemaDigest: input.schemaDigest,
    redirectUriBase,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`Provider auth-recovery execution failed: ${result.message}`)
  expect(String(JSON.stringify(result.result))).toContain("INC0010023")
  return result
}

async function assertScenarioState(server: MockScenarioServer, connected: boolean): Promise<void> {
  const state = await fetchJson(`${server.origin}/__scenario/state`)
  expect(state.response.status).toBe(200)
  expect(own(state.body, "connected")).toBe(connected)
}

async function resetScenario(server: MockScenarioServer): Promise<void> {
  const reset = await fetchJson(`${server.origin}/__scenario/reset`, { method: "POST" })
  expect(reset.response.status).toBe(200)
  expect(own(reset.body, "connected")).toBe(false)
}

async function runRecoveryScenario(input: {
  label: string
  mode: "authorization_required" | "authorization_required_uncorrelated"
  getStream?: "reset" | "405"
}): Promise<void> {
  const server = await startMockScenario({ mode: input.mode, getStream: input.getStream })
  try {
    const seed = await seedOrganization(input.label)
    const connection = await createGrantedConnection(seed, server, input.label)
    const discovered = await discoverCapability(seed, connection.id, connection.name)

    const blocked = await executeNeedsConnection({
      seed,
      connectionId: connection.id,
      toolName: guardedToolName,
      schemaDigest: discovered.schemaDigest,
      server,
    })
    await completeConnectFlow(blocked.actionUrl)
    await assertScenarioState(server, true)
    await executeSucceeds({
      seed,
      connectionId: connection.id,
      toolName: guardedToolName,
      schemaDigest: discovered.schemaDigest,
    })

    await resetScenario(server)
    await assertScenarioState(server, false)
    await executeNeedsConnection({
      seed,
      connectionId: connection.id,
      toolName: guardedToolName,
      schemaDigest: discovered.schemaDigest,
      server,
    })
  } finally {
    await server.stop()
  }
}

beforeAll(async () => {
  seedRequiredEnv()
  mock.restore()
  const realDb = (await import("@openwork-ee/den-db")).createDenDb({
    databaseUrl: process.env.DATABASE_URL,
    mode: "mysql",
  }).db
  mock.module("../src/db.js", () => ({ db: realDb }))

  const [dbMod, schemaMod, typeIdMod, connectionsMod, capabilitiesMod, envMod] = await Promise.all([
    import("../src/db.js"),
    import("@openwork-ee/den-db/schema"),
    import("@openwork-ee/utils/typeid"),
    import("../src/capability-sources/external-mcp-connections.js"),
    import("../src/mcp/external-capabilities.js"),
    import("../src/env.js"),
  ])
  envMod.env.allowPrivateMcpUrls = true
  db = dbMod.db
  schema = schemaMod
  createDenTypeId = typeIdMod.createDenTypeId
  createExternalMcpConnection = connectionsMod.createExternalMcpConnection
  searchExternalCapabilities = capabilitiesMod.searchExternalCapabilities
  executeExternalCapability = capabilitiesMod.executeExternalCapability
})

afterAll(async () => {
  await Promise.all(activeServers.map((server) => server.stop()))
  mock.restore()
})

test("uncorrelated provider auth-required errors recover through connect and retry despite reset background streams", async () => {
  await runRecoveryScenario({
    label: "auth-recovery-uncorrelated",
    mode: "authorization_required_uncorrelated",
    getStream: "reset",
  })
})

test("correlated provider auth-required errors recover through the same connect and retry loop", async () => {
  await runRecoveryScenario({
    label: "auth-recovery-correlated",
    mode: "authorization_required",
  })
})

test("uncorrelated auth-required errors are never swallowed by reset background stream noise", async () => {
  const server = await startMockScenario({ mode: "authorization_required_uncorrelated", getStream: "reset" })
  try {
    const seed = await seedOrganization("auth-recovery-swallowed-regression")
    const connection = await createGrantedConnection(seed, server, "auth-recovery-swallowed-regression")
    const discovered = await discoverCapability(seed, connection.id, connection.name)
    for (let index = 0; index < 5; index += 1) {
      const { result } = await executeNeedsConnection({
        seed,
        connectionId: connection.id,
        toolName: guardedToolName,
        schemaDigest: discovered.schemaDigest,
        server,
      })
      expect(result.error).not.toBe("connection_failed")
      assertNoTransportWording(result.message)
    }
  } finally {
    await server.stop()
  }
})
