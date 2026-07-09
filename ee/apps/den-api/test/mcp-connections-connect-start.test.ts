import { createDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"
import { afterAll, beforeAll, expect, mock, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test_pr7"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "local-dev-db-encryption-key-please-change-1234567890"
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "local-dev-secret-not-for-production-use!!"
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
  process.env.DEN_ALLOW_PRIVATE_MCP_URLS = "1"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

let app: typeof import("../src/app.js").default
let db: typeof import("../src/db.js").db
let schema: typeof import("@openwork-ee/den-db/schema")
let drizzle: typeof import("@openwork-ee/den-db/drizzle")
let session: typeof import("../src/session.js")
let createExternalMcpConnection: typeof import("../src/capability-sources/external-mcp-connections.js").createExternalMcpConnection

const userId = createDenTypeId("user")
const organizationId = createDenTypeId("organization")
const memberId = createDenTypeId("member")
const staleSessionId = createDenTypeId("session")
const staleSessionToken = `stale-mcp-session-${staleSessionId}`
const connectionName = "Broken OAuth MCP"
let connectionId: DenTypeId<"externalMcpConnection"> | undefined

beforeAll(async () => {
  seedRequiredEnv()
  mock.restore()
  const realDb = (await import("@openwork-ee/den-db")).createDenDb({
    databaseUrl: process.env.DATABASE_URL,
    mode: "mysql",
  }).db
  mock.module("../src/db.js", () => ({ db: realDb }))

  const [appMod, dbMod, schemaMod, drizzleMod, sessionMod, connectionsMod] = await Promise.all([
    import("../src/app.js"),
    import("../src/db.js"),
    import("@openwork-ee/den-db/schema"),
    import("@openwork-ee/den-db/drizzle"),
    import("../src/session.js"),
    import("../src/capability-sources/external-mcp-connections.js"),
  ])
  app = appMod.default
  db = dbMod.db
  schema = schemaMod
  drizzle = drizzleMod
  session = sessionMod
  createExternalMcpConnection = connectionsMod.createExternalMcpConnection

  await db.insert(schema.AuthUserTable).values({
    id: userId,
    name: "MCP Connect Start User",
    email: `mcp-connect-start+${userId}@test.local`,
  })
  await db.insert(schema.OrganizationTable).values({
    id: organizationId,
    name: "MCP Connect Start Org",
    slug: `mcp-connect-start-${organizationId}`,
  })
  await db.insert(schema.MemberTable).values({
    id: memberId,
    organizationId,
    userId,
    role: "admin",
  })
  await db.insert(schema.AuthSessionTable).values({
    id: staleSessionId,
    userId,
    activeOrganizationId: organizationId,
    token: staleSessionToken,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
  })

  const connection = await createExternalMcpConnection({
    organizationId,
    name: connectionName,
    url: "http://127.0.0.1:9/mcp",
    authType: "oauth",
    credentialMode: "per_member",
    createdByOrgMembershipId: memberId,
    access: { orgWide: true, memberIds: [], teamIds: [] },
  })
  connectionId = connection.id
})

afterAll(async () => {
  await db.delete(schema.ConnectedAccountTable).where(drizzle.eq(schema.ConnectedAccountTable.organizationId, organizationId))
  await db.delete(schema.OrgOAuthClientTable).where(drizzle.eq(schema.OrgOAuthClientTable.organizationId, organizationId))
  await db.delete(schema.ExternalMcpConnectionAccessGrantTable).where(drizzle.eq(schema.ExternalMcpConnectionAccessGrantTable.organizationId, organizationId))
  await db.delete(schema.ExternalMcpConnectionTable).where(drizzle.eq(schema.ExternalMcpConnectionTable.organizationId, organizationId))
  await db.delete(schema.AuthSessionTable).where(drizzle.eq(schema.AuthSessionTable.id, staleSessionId))
  await db.delete(schema.MemberTable).where(drizzle.eq(schema.MemberTable.organizationId, organizationId))
  await db.delete(schema.OrganizationRoleTable).where(drizzle.eq(schema.OrganizationRoleTable.organizationId, organizationId))
  await db.delete(schema.OrganizationTable).where(drizzle.eq(schema.OrganizationTable.id, organizationId))
  await db.delete(schema.AuthUserTable).where(drizzle.eq(schema.AuthUserTable.id, userId))
  mock.restore()
})

function seededConnectionId() {
  if (!connectionId) {
    throw new Error("External MCP connection was not seeded")
  }
  return connectionId
}

function request(path: string) {
  return app.fetch(new Request(`http://den-api.local${path}`, {
    headers: {
      "x-den-internal-mcp-principal": session.createInternalMcpPrincipalHeader({ userId, organizationId }),
    },
  }))
}

function staleSessionRequest(path: string, method = "GET", body?: unknown) {
  return app.fetch(new Request(`http://den-api.local${path}`, {
    method,
    headers: {
      authorization: `Bearer ${staleSessionToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
}

test("GET /v1/mcp-connections/:connectionId/connect/start maps OAuth handshake failures to 502 JSON", async () => {
  const response = await request(`/v1/mcp-connections/${seededConnectionId()}/connect/start`)
  expect(response.status).toBe(502)

  const body: unknown = await response.json()
  expect(isRecord(body)).toBe(true)
  if (!isRecord(body)) {
    throw new Error("connect/start response was not an object")
  }
  expect(body.error).toBe("oauth_handshake_failed")
  expect(typeof body.message).toBe("string")
  if (typeof body.message !== "string") {
    throw new Error("connect/start response message was not a string")
  }
  expect(body.message.length).toBeGreaterThan(0)
  expect(body.message).toContain(connectionName)
})

test("GET /v1/mcp-connections/:connectionId/connect/start still returns connection_not_found", async () => {
  const response = await request(`/v1/mcp-connections/${createDenTypeId("externalMcpConnection")}/connect/start`)
  expect(response.status).toBe(404)

  const body: unknown = await response.json()
  expect(isRecord(body)).toBe(true)
  if (!isRecord(body)) {
    throw new Error("connect/start 404 response was not an object")
  }
  expect(body.error).toBe("connection_not_found")
})

test("stale admin sessions can configure and connect shared MCPs but cannot disconnect or delete them", async () => {
  const createResponse = await staleSessionRequest("/v1/mcp-connections", "POST", {
    name: "Shared OAuth MCP",
    url: "http://127.0.0.1:9/mcp",
    authType: "oauth",
    credentialMode: "shared",
  })
  expect(createResponse.status).toBe(200)

  const createdBody: unknown = await createResponse.json()
  expect(isRecord(createdBody)).toBe(true)
  if (!isRecord(createdBody) || typeof createdBody.id !== "string") {
    throw new Error("create connection response did not include an id")
  }

  const accessResponse = await staleSessionRequest(`/v1/mcp-connections/${createdBody.id}/access`, "PUT", {
    access: {
      orgWide: true,
      memberIds: [],
      teamIds: [],
    },
  })
  expect(accessResponse.status).toBe(200)

  const connectResponse = await staleSessionRequest(`/v1/mcp-connections/${createdBody.id}/connect/start`)
  expect(connectResponse.status).toBe(502)
  const connectBody: unknown = await connectResponse.json()
  expect(isRecord(connectBody) && connectBody.error).toBe("oauth_handshake_failed")

  for (const [method, suffix] of [["POST", "/disconnect"], ["DELETE", ""]]) {
    const destructiveResponse = await staleSessionRequest(`/v1/mcp-connections/${createdBody.id}${suffix}`, method)
    expect(destructiveResponse.status).toBe(403)
    const destructiveBody: unknown = await destructiveResponse.json()
    expect(isRecord(destructiveBody) && destructiveBody.error).toBe("reauth")
    expect(isRecord(destructiveBody) && destructiveBody.reason).toBe("fresh_auth_required")
  }

  const [renewedSession] = await db
    .select({ expiresAt: schema.AuthSessionTable.expiresAt })
    .from(schema.AuthSessionTable)
    .where(drizzle.eq(schema.AuthSessionTable.id, staleSessionId))
    .limit(1)
  expect(renewedSession?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000)

  const signOutResponse = await staleSessionRequest("/api/auth/sign-out", "POST", {})
  expect(signOutResponse.status).toBe(200)
  const sessionsAfterSignOut = await db
    .select({ id: schema.AuthSessionTable.id })
    .from(schema.AuthSessionTable)
    .where(drizzle.eq(schema.AuthSessionTable.id, staleSessionId))
  expect(sessionsAfterSignOut).toEqual([])
})
