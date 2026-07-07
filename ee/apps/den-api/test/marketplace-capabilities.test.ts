import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { inArray } from "@openwork-ee/den-db/drizzle"
import {
  AuthUserTable,
  ConfigObjectAccessGrantTable,
  ConfigObjectTable,
  ConfigObjectVersionTable,
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
import { memberFacingMcpConnectionsEnabled } from "../src/capability-sources/external-mcp-rollout.js"
import type { McpMemberIdentity } from "../src/mcp/external-capabilities.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test_pr3"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
}

type Db = typeof import("../src/db.js").db
type MarketplaceCapabilities = typeof import("../src/mcp/marketplace-capabilities.js")
type ExternalCapabilities = typeof import("../src/mcp/external-capabilities.js")
type ConfigObjectType = typeof ConfigObjectTable.$inferSelect.objectType

type SeededMember = {
  member: McpMemberIdentity
  memberId: DenTypeId<"member">
  organizationId: DenTypeId<"organization">
  userId: DenTypeId<"user">
}

type SeededCapability = {
  configObjectId: DenTypeId<"configObject">
  name: string
  pluginId: DenTypeId<"plugin">
}

let db: Db
let marketplaceCapabilities: MarketplaceCapabilities
let externalCapabilities: ExternalCapabilities

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
  marketplaceCapabilities = await import("../src/mcp/marketplace-capabilities.js")
  externalCapabilities = await import("../src/mcp/external-capabilities.js")
})

afterAll(() => {
  mock.restore()
})

afterEach(async () => {
  if (createdOrganizationIds.length > 0) {
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

async function seedMember(input: { metadata?: Record<string, unknown> | null; role?: string } = {}): Promise<SeededMember> {
  const organizationId = createDenTypeId("organization")
  const userId = createDenTypeId("user")
  const memberId = createDenTypeId("member")
  createdOrganizationIds.push(organizationId)
  createdUserIds.push(userId)

  await db.insert(AuthUserTable).values({
    id: userId,
    name: "Marketplace Tester",
    email: `${userId}@marketplace.test.local`,
  })
  await db.insert(OrganizationTable).values({
    id: organizationId,
    name: "Marketplace Test Org",
    slug: `marketplace-${organizationId}`,
    metadata: input.metadata ?? null,
  })
  await db.insert(MemberTable).values({
    id: memberId,
    organizationId,
    userId,
    role: input.role ?? "member",
  })

  return {
    organizationId,
    userId,
    memberId,
    member: { orgMembershipId: memberId, teamIds: [] },
  }
}

async function seedCapability(input: {
  description?: string | null
  grant?: "config_object" | "marketplace" | "none" | "plugin"
  normalizedPayloadJson?: Record<string, unknown> | null
  objectType: ConfigObjectType
  owner: SeededMember
  rawSourceText?: string | null
  title: string
  withVersion?: boolean
}): Promise<SeededCapability> {
  const now = new Date()
  const marketplaceId = createDenTypeId("marketplace")
  const pluginId = createDenTypeId("plugin")
  const configObjectId = createDenTypeId("configObject")
  const description = input.description ?? null
  const rawSourceText = input.rawSourceText ?? null

  await db.insert(MarketplaceTable).values({
    id: marketplaceId,
    organizationId: input.owner.organizationId,
    name: "Team Marketplace",
    description: "Curated marketplace for tests",
    logoUrl: null,
    status: "active",
    createdByOrgMembershipId: input.owner.memberId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  await db.insert(PluginTable).values({
    id: pluginId,
    organizationId: input.owner.organizationId,
    name: "Revenue Ops Plugin",
    description: "Helps with revenue work",
    status: "active",
    createdByOrgMembershipId: input.owner.memberId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  await db.insert(ConfigObjectTable).values({
    id: configObjectId,
    organizationId: input.owner.organizationId,
    objectType: input.objectType,
    sourceMode: "cloud",
    title: input.title,
    description,
    searchText: [input.title, description, rawSourceText].filter(Boolean).join("\n"),
    currentFileName: `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`,
    currentFileExtension: ".md",
    currentRelativePath: `${input.objectType}s/${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`,
    status: "active",
    createdByOrgMembershipId: input.owner.memberId,
    connectorInstanceId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  await db.insert(MarketplacePluginTable).values({
    id: createDenTypeId("marketplacePlugin"),
    organizationId: input.owner.organizationId,
    marketplaceId,
    pluginId,
    membershipSource: "manual",
    createdByOrgMembershipId: input.owner.memberId,
    createdAt: now,
    removedAt: null,
  })
  await db.insert(PluginConfigObjectTable).values({
    id: createDenTypeId("pluginConfigObject"),
    organizationId: input.owner.organizationId,
    pluginId,
    configObjectId,
    membershipSource: "manual",
    connectorMappingId: null,
    createdByOrgMembershipId: input.owner.memberId,
    createdAt: now,
    removedAt: null,
  })
  if (input.withVersion !== false) {
    await db.insert(ConfigObjectVersionTable).values({
      id: createDenTypeId("configObjectVersion"),
      organizationId: input.owner.organizationId,
      configObjectId,
      normalizedPayloadJson: input.normalizedPayloadJson ?? null,
      rawSourceText,
      schemaVersion: null,
      createdVia: "cloud",
      createdByOrgMembershipId: input.owner.memberId,
      connectorSyncEventId: null,
      sourceRevisionRef: null,
      isDeletedVersion: false,
      createdAt: now,
    })
  }

  const grant = input.grant ?? "marketplace"
  if (grant === "marketplace") {
    await db.insert(MarketplaceAccessGrantTable).values({
      id: createDenTypeId("marketplaceAccessGrant"),
      organizationId: input.owner.organizationId,
      marketplaceId,
      orgMembershipId: null,
      teamId: null,
      orgWide: true,
      role: "viewer",
      createdByOrgMembershipId: input.owner.memberId,
      createdAt: now,
      removedAt: null,
    })
  }
  if (grant === "plugin") {
    await db.insert(PluginAccessGrantTable).values({
      id: createDenTypeId("pluginAccessGrant"),
      organizationId: input.owner.organizationId,
      pluginId,
      orgMembershipId: null,
      teamId: null,
      orgWide: true,
      role: "viewer",
      createdByOrgMembershipId: input.owner.memberId,
      createdAt: now,
      removedAt: null,
    })
  }
  if (grant === "config_object") {
    await db.insert(ConfigObjectAccessGrantTable).values({
      id: createDenTypeId("configObjectAccessGrant"),
      organizationId: input.owner.organizationId,
      configObjectId,
      orgMembershipId: null,
      teamId: null,
      orgWide: true,
      role: "viewer",
      createdByOrgMembershipId: input.owner.memberId,
      createdAt: now,
      removedAt: null,
    })
  }

  return {
    configObjectId,
    pluginId,
    name: marketplaceCapabilities.buildMarketplaceCapabilityName(pluginId, configObjectId),
  }
}

async function execute(owner: SeededMember, seeded: SeededCapability, body?: unknown) {
  return marketplaceCapabilities.executeMarketplaceCapability({
    organizationId: owner.organizationId,
    member: owner.member,
    pluginId: seeded.pluginId,
    configObjectId: seeded.configObjectId,
    body,
    enabled: true,
  })
}

describe("marketplace capabilities source", () => {
  test("search finds a published plugin skill and execute returns provenance-framed raw content", async () => {
    const owner = await seedMember()
    const seeded = await seedCapability({
      owner,
      objectType: "skill",
      title: "Renewal Playbook",
      description: "Use for enterprise renewal strategy",
      rawSourceText: "# Renewal Playbook\n\nAlways mention expansion risk.",
    })

    const matches = await marketplaceCapabilities.searchMarketplaceCapabilities({
      organizationId: owner.organizationId,
      member: owner.member,
      query: "renewal expansion",
      limit: 5,
      enabled: true,
    })
    const match = matches.find((candidate) => candidate.name === seeded.name)
    expect(match?.method).toBe("PLUGIN")
    expect(match?.kind).toBe("skill")
    expect(match?.plugin).toBe("Revenue Ops Plugin")
    expect(match?.marketplace).toBe("Team Marketplace")
    expect(match?.hasBody).toBe(false)

    const result = await execute(owner, seeded)
    if (!result.ok) throw new Error(result.message)
    expect(result.result).toMatchObject({
      kind: "skill",
      plugin: "Revenue Ops Plugin",
      marketplace: "Team Marketplace",
      name: "Renewal Playbook",
      content: "# Renewal Playbook\n\nAlways mention expansion risk.",
      provenance: "Content from marketplace plugin Revenue Ops Plugin in your organization's library.",
    })
  })

  test("command execute substitutes $ARGUMENTS without running anything server-side", async () => {
    const owner = await seedMember()
    const seeded = await seedCapability({
      owner,
      objectType: "command",
      title: "Draft Follow-up",
      rawSourceText: "Create the follow-up for $ARGUMENTS.",
    })

    const result = await execute(owner, seeded, { arguments: "Acme renewal" })
    if (!result.ok) throw new Error(result.message)
    expect(result.result.kind).toBe("command")
    expect(result.result.content).toBe("Create the follow-up for Acme renewal.")
  })

  test("mcp objects return server specs and existing-connection or admin-install hints", async () => {
    const owner = await seedMember()
    const url = "https://mcp.example.test/remote"
    const serverSpec = { mcpServers: { brief: { url } } }
    const seeded = await seedCapability({
      owner,
      objectType: "mcp",
      title: "Brief MCP",
      rawSourceText: JSON.stringify(serverSpec),
      normalizedPayloadJson: serverSpec,
    })

    const missingConnection = await execute(owner, seeded)
    if (!missingConnection.ok) throw new Error(missingConnection.message)
    expect(missingConnection.result.serverSpec).toEqual(serverSpec)
    expect(missingConnection.result.status).toBe("needs_connection")
    expect(missingConnection.result.hint).toContain("OpenWork Cloud -> Connections")

    const connectionId = createDenTypeId("externalMcpConnection")
    await db.insert(ExternalMcpConnectionTable).values({
      id: connectionId,
      organizationId: owner.organizationId,
      name: "Brief Remote",
      url,
      authType: "none",
      credentialMode: "shared",
      createdByOrgMembershipId: owner.memberId,
    })
    await db.insert(ExternalMcpConnectionAccessGrantTable).values({
      id: createDenTypeId("externalMcpConnectionAccessGrant"),
      organizationId: owner.organizationId,
      externalMcpConnectionId: connectionId,
      orgMembershipId: null,
      teamId: null,
      orgWide: true,
      createdByOrgMembershipId: owner.memberId,
    })

    const matchingConnection = await execute(owner, seeded)
    if (!matchingConnection.ok) throw new Error(matchingConnection.message)
    expect(matchingConnection.result.status).toBe("connection_available")
    expect(matchingConnection.result.hint).toContain("Brief Remote")
  })

  test("tool and hook objects return honest local-only and unsupported statuses", async () => {
    const owner = await seedMember()
    const tool = await seedCapability({
      owner,
      objectType: "tool",
      title: "Local CSV Tool",
      rawSourceText: "export function run() { return 'csv' }",
    })
    const hook = await seedCapability({
      owner,
      objectType: "hook",
      title: "Preflight Hook",
      rawSourceText: "hooks:\n  before: echo nope",
    })

    const toolResult = await execute(owner, tool)
    if (!toolResult.ok) throw new Error(toolResult.message)
    expect(toolResult.result.status).toBe("needs_install")
    expect(toolResult.result.source).toContain("csv")
    expect(toolResult.result.hint).toContain("Revenue Ops Plugin")

    const hookResult = await execute(owner, hook)
    if (!hookResult.ok) throw new Error(hookResult.message)
    expect(hookResult.result.status).toBe("unsupported")
    expect(hookResult.result.definition).toContain("before")
    expect(hookResult.result.hint).toContain("not supported")
  })

  test("execute reports content_not_synced when a config object has no latest version", async () => {
    const owner = await seedMember()
    const seeded = await seedCapability({
      owner,
      objectType: "skill",
      title: "Unsynced Skill",
      rawSourceText: null,
      withVersion: false,
    })

    const result = await execute(owner, seeded)
    if (!result.ok) throw new Error(result.message)
    expect(result.result.status).toBe("content_not_synced")
    expect(result.result.hint).toContain("has not synced content")
  })

  test("rollout gating hides marketplace search and makes execute unknown until mcpConnections is enabled", async () => {
    const gatedOff = await seedMember()
    const gatedOffCapability = await seedCapability({
      owner: gatedOff,
      objectType: "skill",
      title: "Hidden Capability",
      rawSourceText: "Do not expose while gated.",
    })
    const disabled = memberFacingMcpConnectionsEnabled(null, { gatingEnabled: true })
    expect(disabled).toBe(false)
    expect(await marketplaceCapabilities.searchMarketplaceCapabilities({
      organizationId: gatedOff.organizationId,
      member: gatedOff.member,
      query: "hidden",
      enabled: disabled,
    })).toEqual([])
    const gatedExecute = await marketplaceCapabilities.executeMarketplaceCapability({
      organizationId: gatedOff.organizationId,
      member: gatedOff.member,
      pluginId: gatedOffCapability.pluginId,
      configObjectId: gatedOffCapability.configObjectId,
      enabled: disabled,
    })
    expect(gatedExecute.ok).toBe(false)
    if (gatedExecute.ok) throw new Error("expected gated execute to fail")
    expect(gatedExecute.error).toBe("unknown_capability")

    const metadata = { capabilities: { mcpConnections: true } }
    const gatedOn = await seedMember({ metadata })
    const visibleCapability = await seedCapability({
      owner: gatedOn,
      objectType: "skill",
      title: "Visible Capability",
      rawSourceText: "Expose while gated on.",
    })
    const enabled = memberFacingMcpConnectionsEnabled(metadata, { gatingEnabled: true })
    expect(enabled).toBe(true)
    const matches = await marketplaceCapabilities.searchMarketplaceCapabilities({
      organizationId: gatedOn.organizationId,
      member: gatedOn.member,
      query: "visible",
      enabled,
    })
    expect(matches.some((match) => match.name === visibleCapability.name)).toBe(true)
  })

  test("members cannot search or execute marketplace content from another organization", async () => {
    const orgA = await seedMember()
    const orgB = await seedMember()
    const orgBCapability = await seedCapability({
      owner: orgB,
      objectType: "skill",
      title: "Org B Secret",
      rawSourceText: "Only org B should see this.",
    })

    const orgBMatches = await marketplaceCapabilities.searchMarketplaceCapabilities({
      organizationId: orgB.organizationId,
      member: orgB.member,
      query: "secret",
      enabled: true,
    })
    expect(orgBMatches.some((match) => match.name === orgBCapability.name)).toBe(true)

    const orgAMatches = await marketplaceCapabilities.searchMarketplaceCapabilities({
      organizationId: orgA.organizationId,
      member: orgA.member,
      query: "secret",
      enabled: true,
    })
    expect(orgAMatches.some((match) => match.name === orgBCapability.name)).toBe(false)

    const orgAExecute = await marketplaceCapabilities.executeMarketplaceCapability({
      organizationId: orgA.organizationId,
      member: orgA.member,
      pluginId: orgBCapability.pluginId,
      configObjectId: orgBCapability.configObjectId,
      enabled: true,
    })
    expect(orgAExecute.ok).toBe(false)
    if (orgAExecute.ok) throw new Error("expected cross-org execute to fail")
    expect(orgAExecute.error).toBe("unknown_capability")
  })

  test("existing external-connection capabilities still surface their needs_connection pseudo-match", async () => {
    const owner = await seedMember()
    const connectionId = createDenTypeId("externalMcpConnection")
    await db.insert(ExternalMcpConnectionTable).values({
      id: connectionId,
      organizationId: owner.organizationId,
      name: "Calendar Bridge",
      url: "https://calendar.example.test/mcp",
      authType: "oauth",
      credentialMode: "per_member",
      createdByOrgMembershipId: owner.memberId,
    })
    await db.insert(ExternalMcpConnectionAccessGrantTable).values({
      id: createDenTypeId("externalMcpConnectionAccessGrant"),
      organizationId: owner.organizationId,
      externalMcpConnectionId: connectionId,
      orgMembershipId: null,
      teamId: null,
      orgWide: true,
      createdByOrgMembershipId: owner.memberId,
    })

    const matches = await externalCapabilities.searchExternalCapabilities({
      organizationId: owner.organizationId,
      member: owner.member,
      query: "calendar",
      redirectUriBase: "http://127.0.0.1:8790",
      limit: 5,
    })
    expect(matches).toHaveLength(1)
    expect(matches[0]?.name).toBe(externalCapabilities.buildExternalCapabilityName(connectionId, "*"))
    expect(matches[0]?.method).toBe("MCP")
    expect(matches[0]?.status).toBe("needs_connection")
  })
})
