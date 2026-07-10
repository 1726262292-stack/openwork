import { createDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"

process.env.OPENWORK_DEV_MODE = "1"
process.env.DEN_ALLOW_PRIVATE_MCP_URLS = "1"
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_den"
process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "daytona-den-db-encryption-key-please-change-1234567890"
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "daytona-den-auth-secret-please-change-1234567890"
process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8788"
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8788"

const connectionUrl = process.env.DEN_TLS_REPRO_URL?.trim()
const expected = process.env.DEN_TLS_REPRO_EXPECT?.trim()

if (!connectionUrl) throw new Error("DEN_TLS_REPRO_URL is required.")
if (expected !== "trusted" && expected !== "untrusted") {
  throw new Error('DEN_TLS_REPRO_EXPECT must be "trusted" or "untrusted".')
}

const [appModule, dbModule, schema, drizzle, session, connections] = await Promise.all([
  import("../src/app.js"),
  import("../src/db.js"),
  import("@openwork-ee/den-db/schema"),
  import("@openwork-ee/den-db/drizzle"),
  import("../src/session.js"),
  import("../src/capability-sources/external-mcp-connections.js"),
])

const app = appModule.default
const db = dbModule.db
const userId = createDenTypeId("user")
const organizationId = createDenTypeId("organization")
const memberId = createDenTypeId("member")
let connectionId: DenTypeId<"externalMcpConnection"> | undefined

try {
  await db.insert(schema.AuthUserTable).values({
    id: userId,
    name: "Corporate CA Repro User",
    email: `corporate-ca-repro+${userId}@test.local`,
  })
  await db.insert(schema.OrganizationTable).values({
    id: organizationId,
    name: "Corporate CA Repro Org",
    slug: `corporate-ca-repro-${organizationId}`,
  })
  await db.insert(schema.MemberTable).values({
    id: memberId,
    organizationId,
    userId,
    role: "admin",
  })

  const connection = await connections.createExternalMcpConnection({
    organizationId,
    name: "Corporate TLS OAuth MCP",
    url: `${connectionUrl.replace(/\/+$/, "")}/mcp`,
    authType: "oauth",
    credentialMode: "shared",
    createdByOrgMembershipId: memberId,
    access: { orgWide: true, memberIds: [], teamIds: [] },
  })
  connectionId = connection.id

  const response = await app.fetch(new Request(`http://den-api.local/v1/mcp-connections/${connection.id}/connect/start`, {
    headers: {
      "x-den-internal-mcp-principal": session.createInternalMcpPrincipalHeader({ userId, organizationId }),
    },
  }))
  const body = await response.json() as Record<string, unknown>
  const result = { expected, status: response.status, body }

  if (expected === "untrusted") {
    if (response.status !== 502 || body.error !== "oauth_handshake_failed") {
      throw new Error(`Expected an untrusted-CA 502, received ${JSON.stringify(result)}`)
    }
    if (!String(body.message ?? "").toLowerCase().includes("fetch failed")) {
      throw new Error(`Expected the real Den failure to contain fetch failed, received ${JSON.stringify(result)}`)
    }
  } else {
    if (response.status !== 200 || body.status !== "needs_auth") {
      throw new Error(`Expected trusted CA discovery to return needs_auth, received ${JSON.stringify(result)}`)
    }
    const authorizeUrl = String(body.authorizeUrl ?? "")
    if (!authorizeUrl.startsWith(`${connectionUrl.replace(/\/+$/, "")}/authorize?`)) {
      throw new Error(`Expected an authorize URL from the TLS fixture, received ${JSON.stringify(result)}`)
    }
  }

  console.log(JSON.stringify(result, null, 2))
} finally {
  await db.delete(schema.ConnectedAccountTable).where(drizzle.eq(schema.ConnectedAccountTable.organizationId, organizationId))
  await db.delete(schema.OrgOAuthClientTable).where(drizzle.eq(schema.OrgOAuthClientTable.organizationId, organizationId))
  await db.delete(schema.ExternalMcpConnectionAccessGrantTable).where(drizzle.eq(schema.ExternalMcpConnectionAccessGrantTable.organizationId, organizationId))
  if (connectionId) {
    await db.delete(schema.ExternalMcpConnectionTable).where(drizzle.eq(schema.ExternalMcpConnectionTable.id, connectionId))
  }
  await db.delete(schema.MemberTable).where(drizzle.eq(schema.MemberTable.organizationId, organizationId))
  await db.delete(schema.OrganizationRoleTable).where(drizzle.eq(schema.OrganizationRoleTable.organizationId, organizationId))
  await db.delete(schema.OrganizationTable).where(drizzle.eq(schema.OrganizationTable.id, organizationId))
  await db.delete(schema.AuthUserTable).where(drizzle.eq(schema.AuthUserTable.id, userId))
}

// The shared Den DB client intentionally keeps its pool alive in the server.
// This one-shot repro has finished all cleanup, so terminate the helper process.
process.exit(0)
