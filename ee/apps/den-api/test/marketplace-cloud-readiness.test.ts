import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { inArray } from "@openwork-ee/den-db/drizzle"
import {
  AuthUserTable,
  ConfigObjectAccessGrantTable,
  ConfigObjectTable,
  ConfigObjectVersionTable,
  ConnectedAccountTable,
  ExternalMcpConnectionAccessGrantTable,
  ExternalMcpConnectionTable,
  MarketplaceAccessGrantTable,
  MarketplacePluginTable,
  MarketplaceTable,
  MemberTable,
  PluginAccessGrantTable,
  PluginConfigObjectTable,
  PluginTable,
  OrganizationTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"
import type { PluginArchActorContext } from "../src/routes/org/plugin-system/access.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test_pr6"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "local-dev-db-encryption-key-please-change-1234567890"
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "local-dev-secret-not-for-production-use!!"
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
}

type Db = typeof import("../src/db.js").db
type Store = typeof import("../src/routes/org/plugin-system/store.js")
type ConfigObjectType = typeof ConfigObjectTable.$inferSelect.objectType

type SeededOrg = {
  context: PluginArchActorContext
  marketplaceId: DenTypeId<"marketplace">
  memberId: DenTypeId<"member">
  organizationId: DenTypeId<"organization">
  userId: DenTypeId<"user">
}

type SeededPlugin = {
  pluginId: DenTypeId<"plugin">
}

let db: Db
let store: Store

const createdOrganizationIds: DenTypeId<"organization">[] = []
const createdUserIds: DenTypeId<"user">[] = []

beforeAll(async () => {
  seedRequiredEnv()
  mock.restore()
  db = (await import("@openwork-ee/den-db")).createDenDb({
    databaseUrl: process.env.DATABASE_URL,
    mode: "mysql",
  }).db
  mock.module("../src/db.js", () => ({ db }))
  mock.module("../src/env.js", () => ({
    env: {
      betterAuthSecret: "test-secret",
      githubConnectorApp: {},
      mcpConnectionsGatingEnabled: true,
    },
  }))
  store = await import("../src/routes/org/plugin-system/store.js")
})

afterAll(() => {
  mock.restore()
})

afterEach(async () => {
  if (createdOrganizationIds.length > 0) {
    await db.delete(ConnectedAccountTable).where(inArray(ConnectedAccountTable.organizationId, createdOrganizationIds))
    await db.delete(ExternalMcpConnectionAccessGrantTable).where(inArray(ExternalMcpConnectionAccessGrantTable.organizationId, createdOrganizationIds))
    await db.delete(ExternalMcpConnectionTable).where(inArray(ExternalMcpConnectionTable.organizationId, createdOrganizationIds))
    await db.delete(ConfigObjectVersionTable).where(inArray(ConfigObjectVersionTable.organizationId, createdOrganizationIds))
    await db.delete(ConfigObjectAccessGrantTable).where(inArray(ConfigObjectAccessGrantTable.organizationId, createdOrganizationIds))
    await db.delete(PluginConfigObjectTable).where(inArray(PluginConfigObjectTable.organizationId, createdOrganizationIds))
    await db.delete(PluginAccessGrantTable).where(inArray(PluginAccessGrantTable.organizationId, createdOrganizationIds))
    await db.delete(MarketplacePluginTable).where(inArray(MarketplacePluginTable.organizationId, createdOrganizationIds))
    await db.delete(MarketplaceAccessGrantTable).where(inArray(MarketplaceAccessGrantTable.organizationId, createdOrganizationIds))
    await db.delete(ConfigObjectTable).where(inArray(ConfigObjectTable.organizationId, createdOrganizationIds))
    await db.delete(PluginTable).where(inArray(PluginTable.organizationId, createdOrganizationIds))
    await db.delete(MarketplaceTable).where(inArray(MarketplaceTable.organizationId, createdOrganizationIds))
    await db.delete(MemberTable).where(inArray(MemberTable.organizationId, createdOrganizationIds))
    await db.delete(OrganizationTable).where(inArray(OrganizationTable.id, createdOrganizationIds))
  }
  if (createdUserIds.length > 0) {
    await db.delete(AuthUserTable).where(inArray(AuthUserTable.id, createdUserIds))
  }
  createdOrganizationIds.length = 0
  createdUserIds.length = 0
})

function orgMetadata(enabled = true) {
  return enabled ? { capabilities: { mcpConnections: true } } : null
}

function contextFor(input: {
  memberId: DenTypeId<"member">
  metadata: Record<string, unknown> | null
  organizationId: DenTypeId<"organization">
  role: string
  userId: DenTypeId<"user">
}): PluginArchActorContext {
  const now = new Date()
  return {
    memberTeams: [],
    organizationContext: {
      organization: {
        id: input.organizationId,
        name: "Cloud Readiness Org",
        slug: `cloud-readiness-${input.organizationId}`,
        logo: null,
        allowedEmailDomains: [],
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt: now,
        updatedAt: now,
      },
      currentMember: {
        id: input.memberId,
        userId: input.userId,
        role: input.role,
        createdAt: now,
        joinedAt: now,
        isOwner: input.role === "owner",
      },
      members: [],
      invitations: [],
      roles: [],
      teams: [],
    },
    session: { createdAt: now },
  }
}

async function seedOrg(input: { enabled?: boolean; role?: string } = {}): Promise<SeededOrg> {
  const now = new Date()
  const organizationId = createDenTypeId("organization")
  const userId = createDenTypeId("user")
  const memberId = createDenTypeId("member")
  const marketplaceId = createDenTypeId("marketplace")
  const metadata = orgMetadata(input.enabled ?? true)
  const role = input.role ?? "admin"
  createdOrganizationIds.push(organizationId)
  createdUserIds.push(userId)

  await db.insert(AuthUserTable).values({
    id: userId,
    name: "Cloud Readiness Tester",
    email: `${userId}@cloud-readiness.test.local`,
  })
  await db.insert(OrganizationTable).values({
    id: organizationId,
    name: "Cloud Readiness Org",
    slug: `cloud-readiness-${organizationId}`,
    metadata,
  })
  await db.insert(MemberTable).values({ id: memberId, organizationId, userId, role })
  await db.insert(MarketplaceTable).values({
    id: marketplaceId,
    organizationId,
    name: "Cloud Readiness Marketplace",
    description: "Readiness tests",
    logoUrl: null,
    status: "active",
    createdByOrgMembershipId: memberId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  await db.insert(MarketplaceAccessGrantTable).values({
    id: createDenTypeId("marketplaceAccessGrant"),
    organizationId,
    marketplaceId,
    orgMembershipId: null,
    teamId: null,
    orgWide: true,
    role: "viewer",
    createdByOrgMembershipId: memberId,
    createdAt: now,
    removedAt: null,
  })

  return {
    organizationId,
    userId,
    memberId,
    marketplaceId,
    context: contextFor({ memberId, metadata, organizationId, role, userId }),
  }
}

async function addMember(input: { org: SeededOrg; role?: string }) {
  const userId = createDenTypeId("user")
  const memberId = createDenTypeId("member")
  const role = input.role ?? "member"
  createdUserIds.push(userId)
  await db.insert(AuthUserTable).values({
    id: userId,
    name: "Cloud Readiness Member",
    email: `${userId}@cloud-readiness.test.local`,
  })
  await db.insert(MemberTable).values({ id: memberId, organizationId: input.org.organizationId, userId, role })
  return {
    memberId,
    userId,
    context: contextFor({ memberId, metadata: orgMetadata(true), organizationId: input.org.organizationId, role, userId }),
  }
}

async function seedPlugin(input: {
  components?: Array<{
    objectType: ConfigObjectType
    title: string
    normalizedPayloadJson?: Record<string, unknown> | null
    rawSourceText?: string | null
    withVersion?: boolean
  }>
  name: string
  org: SeededOrg
}): Promise<SeededPlugin> {
  const now = new Date()
  const pluginId = createDenTypeId("plugin")
  await db.insert(PluginTable).values({
    id: pluginId,
    organizationId: input.org.organizationId,
    name: input.name,
    description: `${input.name} description`,
    status: "active",
    createdByOrgMembershipId: input.org.memberId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  await db.insert(MarketplacePluginTable).values({
    id: createDenTypeId("marketplacePlugin"),
    organizationId: input.org.organizationId,
    marketplaceId: input.org.marketplaceId,
    pluginId,
    membershipSource: "manual",
    createdByOrgMembershipId: input.org.memberId,
    createdAt: now,
    removedAt: null,
  })

  for (const component of input.components ?? []) {
    const configObjectId = createDenTypeId("configObject")
    await db.insert(ConfigObjectTable).values({
      id: configObjectId,
      organizationId: input.org.organizationId,
      objectType: component.objectType,
      sourceMode: "cloud",
      title: component.title,
      description: `${component.title} description`,
      searchText: component.title,
      currentFileName: `${component.title}.md`,
      currentFileExtension: ".md",
      currentRelativePath: `${component.objectType}s/${component.title}.md`,
      status: "active",
      createdByOrgMembershipId: input.org.memberId,
      connectorInstanceId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    await db.insert(PluginConfigObjectTable).values({
      id: createDenTypeId("pluginConfigObject"),
      organizationId: input.org.organizationId,
      pluginId,
      configObjectId,
      membershipSource: "manual",
      connectorMappingId: null,
      createdByOrgMembershipId: input.org.memberId,
      createdAt: now,
      removedAt: null,
    })
    if (component.withVersion !== false) {
      await db.insert(ConfigObjectVersionTable).values({
        id: createDenTypeId("configObjectVersion"),
        organizationId: input.org.organizationId,
        configObjectId,
        normalizedPayloadJson: component.normalizedPayloadJson ?? null,
        rawSourceText: component.rawSourceText ?? null,
        schemaVersion: null,
        createdVia: "cloud",
        createdByOrgMembershipId: input.org.memberId,
        connectorSyncEventId: null,
        sourceRevisionRef: null,
        isDeletedVersion: false,
        createdAt: now,
      })
    }
  }

  return { pluginId }
}

async function seedConnection(input: {
  credentialMode: "per_member" | "shared"
  name: string
  org: SeededOrg
  url: string
}) {
  const connectionId = createDenTypeId("externalMcpConnection")
  await db.insert(ExternalMcpConnectionTable).values({
    id: connectionId,
    organizationId: input.org.organizationId,
    name: input.name,
    url: input.url,
    authType: input.credentialMode === "per_member" ? "oauth" : "none",
    credentialMode: input.credentialMode,
    connectedAt: input.credentialMode === "shared" ? new Date() : null,
    createdByOrgMembershipId: input.org.memberId,
  })
  await db.insert(ExternalMcpConnectionAccessGrantTable).values({
    id: createDenTypeId("externalMcpConnectionAccessGrant"),
    organizationId: input.org.organizationId,
    externalMcpConnectionId: connectionId,
    orgMembershipId: null,
    teamId: null,
    orgWide: true,
    createdByOrgMembershipId: input.org.memberId,
  })
  return connectionId
}

async function connectMember(input: { connectionId: DenTypeId<"externalMcpConnection">; memberId: DenTypeId<"member">; org: SeededOrg }) {
  await db.insert(ConnectedAccountTable).values({
    id: createDenTypeId("connectedAccount"),
    organizationId: input.org.organizationId,
    orgMembershipId: input.memberId,
    providerId: input.connectionId,
    externalAccountId: input.memberId,
    scopes: ["read"],
    accessToken: "member-token",
    refreshToken: null,
    tokenType: "Bearer",
    expiresAt: null,
    pendingCodeVerifier: null,
  })
}

async function resolvedPlugin(input: { context: PluginArchActorContext; marketplaceId: DenTypeId<"marketplace">; pluginId: DenTypeId<"plugin"> }) {
  const resolved = await store.getMarketplaceResolved({ context: input.context, marketplaceId: input.marketplaceId })
  const plugin = resolved.plugins.find((candidate) => candidate.id === input.pluginId)
  if (!plugin) throw new Error(`Missing plugin ${input.pluginId}`)
  return plugin
}

describe("marketplace cloud readiness payload", () => {
  test("skill-only synced content is ready", async () => {
    const org = await seedOrg()
    const plugin = await seedPlugin({
      org,
      name: "Ready Skill Plugin",
      components: [{ objectType: "skill", title: "Ready Skill", rawSourceText: "# Ready Skill" }],
    })

    expect((await resolvedPlugin({ context: org.context, marketplaceId: org.marketplaceId, pluginId: plugin.pluginId })).cloudReadiness).toMatchObject({
      state: "ready",
      hasInstructional: true,
      connections: [],
    })
  })

  test("per-member MCP dependencies need sign-in until the caller connects", async () => {
    const org = await seedOrg()
    const url = "https://crm.example.test/mcp"
    const connectionId = await seedConnection({ org, name: "CRM", url, credentialMode: "per_member" })
    const plugin = await seedPlugin({
      org,
      name: "CRM Plugin",
      components: [{ objectType: "mcp", title: "CRM MCP", normalizedPayloadJson: { mcpServers: { crm: { url } } } }],
    })

    const before = await resolvedPlugin({ context: org.context, marketplaceId: org.marketplaceId, pluginId: plugin.pluginId })
    expect(before.cloudReadiness?.state).toBe("needs_signin")
    expect(before.cloudReadiness?.connections[0]).toMatchObject({ id: connectionId, credentialMode: "per_member", connectedForMe: false })

    await connectMember({ org, memberId: org.memberId, connectionId })
    const after = await resolvedPlugin({ context: org.context, marketplaceId: org.marketplaceId, pluginId: plugin.pluginId })
    expect(after.cloudReadiness?.state).toBe("ready")
    expect(after.cloudReadiness?.connections[0]).toMatchObject({ id: connectionId, connectedForMe: true })
  })

  test("shared connected MCP dependencies are ready", async () => {
    const org = await seedOrg()
    const url = "https://shared.example.test/mcp"
    const connectionId = await seedConnection({ org, name: "Shared MCP", url, credentialMode: "shared" })
    const plugin = await seedPlugin({
      org,
      name: "Shared MCP Plugin",
      components: [{ objectType: "mcp", title: "Shared MCP", normalizedPayloadJson: { url } }],
    })

    const resolved = await resolvedPlugin({ context: org.context, marketplaceId: org.marketplaceId, pluginId: plugin.pluginId })
    expect(resolved.cloudReadiness?.state).toBe("ready")
    expect(resolved.cloudReadiness?.connections[0]).toMatchObject({ id: connectionId, credentialMode: "shared", connectedForMe: true })
  })

  test("unmatched MCP dependencies need admin setup and include declared connection details", async () => {
    const org = await seedOrg()
    const url = "https://missing.example.test/mcp"
    const plugin = await seedPlugin({
      org,
      name: "Missing MCP Plugin",
      components: [{ objectType: "mcp", title: "Missing MCP", normalizedPayloadJson: { mcpServers: { missing: { url } } } }],
    })

    const resolved = await resolvedPlugin({ context: org.context, marketplaceId: org.marketplaceId, pluginId: plugin.pluginId })
    expect(resolved.cloudReadiness?.state).toBe("needs_admin_setup")
    expect(resolved.cloudReadiness?.connections).toEqual([{ id: null, name: "missing", url }])
  })

  test("tool-only synced content is desktop-only", async () => {
    const org = await seedOrg()
    const plugin = await seedPlugin({
      org,
      name: "Tool Plugin",
      components: [{ objectType: "tool", title: "Local Tool", rawSourceText: "export default {}" }],
    })

    expect((await resolvedPlugin({ context: org.context, marketplaceId: org.marketplaceId, pluginId: plugin.pluginId })).cloudReadiness?.state).toBe("desktop_only")
  })

  test("plugins with no synced version are not synced", async () => {
    const org = await seedOrg()
    const plugin = await seedPlugin({
      org,
      name: "Unsynced Plugin",
      components: [{ objectType: "skill", title: "Unsynced Skill", rawSourceText: "# Later", withVersion: false }],
    })

    const resolved = await resolvedPlugin({ context: org.context, marketplaceId: org.marketplaceId, pluginId: plugin.pluginId })
    expect(resolved.cloudReadiness?.state).toBe("not_synced")
  })

  test("not-synced precedence wins over ready content while preserving instructional availability", async () => {
    const org = await seedOrg()
    const plugin = await seedPlugin({
      org,
      name: "Mixed Plugin",
      components: [
        { objectType: "skill", title: "Synced Skill", rawSourceText: "# Ready" },
        { objectType: "tool", title: "Unsynced Tool", rawSourceText: "later", withVersion: false },
      ],
    })

    const resolved = await resolvedPlugin({ context: org.context, marketplaceId: org.marketplaceId, pluginId: plugin.pluginId })
    expect(resolved.cloudReadiness).toMatchObject({ state: "not_synced", hasInstructional: true })
  })

  test("gated-off organizations omit cloudReadiness for old-client compatibility", async () => {
    const org = await seedOrg({ enabled: false })
    const plugin = await seedPlugin({
      org,
      name: "Gated Off Plugin",
      components: [{ objectType: "skill", title: "Hidden Skill", rawSourceText: "# Hidden" }],
    })

    const resolved = await resolvedPlugin({ context: org.context, marketplaceId: org.marketplaceId, pluginId: plugin.pluginId })
    expect(resolved.cloudReadiness).toBeUndefined()
  })

  test("per-member readiness is isolated by caller", async () => {
    const org = await seedOrg()
    const other = await addMember({ org })
    const url = "https://isolated.example.test/mcp"
    const connectionId = await seedConnection({ org, name: "Isolated MCP", url, credentialMode: "per_member" })
    const plugin = await seedPlugin({
      org,
      name: "Isolated Plugin",
      components: [{ objectType: "mcp", title: "Isolated MCP", normalizedPayloadJson: { mcpServers: { isolated: { url } } } }],
    })
    await connectMember({ org, memberId: org.memberId, connectionId })

    const adminView = await resolvedPlugin({ context: org.context, marketplaceId: org.marketplaceId, pluginId: plugin.pluginId })
    const memberView = await resolvedPlugin({ context: other.context, marketplaceId: org.marketplaceId, pluginId: plugin.pluginId })
    expect(adminView.cloudReadiness?.state).toBe("ready")
    expect(memberView.cloudReadiness?.state).toBe("needs_signin")
  })
})
