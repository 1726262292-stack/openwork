import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { Tool } from "@openwork/codemode"
import { eq, inArray } from "@openwork-ee/den-db/drizzle"
import {
  AuthUserTable,
  ConfigObjectAccessGrantTable,
  ConfigObjectTable,
  ConfigObjectVersionTable,
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
import { Effect } from "effect"
import type { PluginArchActorContext } from "../src/routes/org/plugin-system/access.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test_codemode_scripts"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
}

type Db = typeof import("../src/db.js").db
type MarketplaceCapabilities = typeof import("../src/mcp/marketplace-capabilities.js")
type PluginStore = typeof import("../src/routes/org/plugin-system/store.js")

type SeededScript = {
  configObjectId: DenTypeId<"configObject">
  member: { orgMembershipId: DenTypeId<"member">; teamIds: [] }
  organizationId: DenTypeId<"organization">
  pluginId: DenTypeId<"plugin">
}

let db: Db
let marketplaceCapabilities: MarketplaceCapabilities
let pluginStore: PluginStore
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
  pluginStore = await import("../src/routes/org/plugin-system/store.js")
  marketplaceCapabilities = await import("../src/mcp/marketplace-capabilities.js")
})

afterAll(() => {
  mock.restore()
})

afterEach(async () => {
  if (createdOrganizationIds.length > 0) {
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

async function seedScript(input: {
  code: string
  payload: Record<string, unknown>
  title: string
}): Promise<SeededScript> {
  const organizationId = createDenTypeId("organization")
  const userId = createDenTypeId("user")
  const memberId = createDenTypeId("member")
  const marketplaceId = createDenTypeId("marketplace")
  const now = new Date()
  createdOrganizationIds.push(organizationId)
  createdUserIds.push(userId)

  await db.insert(AuthUserTable).values({ id: userId, name: "Script Tester", email: `${userId}@scripts.test.local` })
  await db.insert(OrganizationTable).values({ id: organizationId, name: "Script Test Org", slug: `scripts-${organizationId}` })
  await db.insert(MemberTable).values({ id: memberId, organizationId, userId, role: "owner" })
  await db.insert(MarketplaceTable).values({
    id: marketplaceId,
    organizationId,
    name: "Script Marketplace",
    description: "Saved script tests",
    status: "active",
    createdByOrgMembershipId: memberId,
  })
  await db.insert(MarketplaceAccessGrantTable).values({
    id: createDenTypeId("marketplaceAccessGrant"),
    organizationId,
    marketplaceId,
    orgMembershipId: memberId,
    teamId: null,
    orgWide: false,
    role: "manager",
    createdByOrgMembershipId: memberId,
  })

  const context: PluginArchActorContext = {
    memberTeams: [],
    organizationContext: {
      organization: {
        id: organizationId,
        name: "Script Test Org",
        slug: `scripts-${organizationId}`,
        logo: null,
        allowedEmailDomains: null,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      },
      currentMember: {
        id: memberId,
        userId,
        role: "owner",
        createdAt: now,
        joinedAt: now,
        isOwner: true,
      },
      invitations: [],
      members: [],
      roles: [],
      teams: [],
    },
    session: { createdAt: now },
  }
  const plugin = await pluginStore.createPluginBundle({
    components: [{
      type: "script",
      value: {
        metadata: { title: input.title, description: `${input.title} description` },
        normalizedPayloadJson: input.payload,
        rawSourceText: input.code,
      },
    }],
    context,
    marketplaceId,
    name: `${input.title} Plugin`,
    orgWide: true,
  })
  const memberships = await db
    .select({ configObjectId: PluginConfigObjectTable.configObjectId })
    .from(PluginConfigObjectTable)
    .where(eq(PluginConfigObjectTable.pluginId, plugin.id))
  const configObjectId = memberships[0]?.configObjectId
  if (!configObjectId) throw new Error("Saved script plugin has no config object")
  return {
    configObjectId,
    member: { orgMembershipId: memberId, teamIds: [] },
    organizationId,
    pluginId: plugin.id,
  }
}

function executeScript(seeded: SeededScript, input: {
  body?: unknown
  buildTools?: Parameters<MarketplaceCapabilities["executeMarketplaceCapability"]>[0]["buildTools"]
  codemodeEnabled?: boolean
} = {}) {
  return marketplaceCapabilities.executeMarketplaceCapability({
    body: input.body,
    buildTools: input.buildTools,
    codemodeEnabled: input.codemodeEnabled ?? true,
    configObjectId: seeded.configObjectId,
    enabled: true,
    member: seeded.member,
    organizationId: seeded.organizationId,
    pluginId: seeded.pluginId,
  })
}

describe("saved marketplace scripts", () => {
  test("executes a createPluginBundle saved script with typed input binding", async () => {
    const seeded = await seedScript({
      title: "Summarize Account",
      code: "return { account: input.account, doubled: input.count * 2 }",
      payload: {
        language: "codemode-js",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { account: { type: "string" }, count: { type: "number" } },
          required: ["account", "count"],
        },
        requiredCapabilities: [],
      },
    })

    const result = await executeScript(seeded, { body: { account: "Acme", count: 4 } })
    if (!result.ok) throw new Error(result.message)
    expect(result.result).toMatchObject({
      kind: "script",
      status: "executed",
      value: { account: "Acme", doubled: 8 },
      toolCalls: [],
    })
    const matches = await marketplaceCapabilities.searchMarketplaceCapabilities({
      codemodeEnabled: true,
      enabled: true,
      member: seeded.member,
      organizationId: seeded.organizationId,
      query: "summarize account",
    })
    expect(matches[0]).toMatchObject({ kind: "script", hasBody: true })
    expect(matches[0]?.path).toStartWith("plugin://")
  })

  test("keeps saved scripts unknown and undiscoverable when Code Mode is disabled", async () => {
    const seeded = await seedScript({
      title: "Hidden Script",
      code: "return 1",
      payload: { language: "codemode-js", requiredCapabilities: [] },
    })
    const matches = await marketplaceCapabilities.searchMarketplaceCapabilities({
      codemodeEnabled: false,
      enabled: true,
      member: seeded.member,
      organizationId: seeded.organizationId,
      query: "hidden script",
    })
    expect(matches).toEqual([])
    expect(await executeScript(seeded, { codemodeEnabled: false })).toEqual({
      ok: false,
      error: "unknown_capability",
      message: "No such capability.",
    })
  })

  test("fails closed before running when a declared capability is unavailable", async () => {
    let invocations = 0
    const available = Tool.make({
      description: "Available test tool",
      input: { type: "object" },
      run: () => Effect.sync(() => {
        invocations += 1
        return "called"
      }),
    })
    const seeded = await seedScript({
      title: "Missing Capability Script",
      code: "return await tools.den.available({})",
      payload: {
        language: "codemode-js",
        requiredCapabilities: [{ capabilityName: "missingCapability", scriptPath: "tools.den.missingCapability" }],
      },
    })

    const result = await executeScript(seeded, {
      buildTools: () => Promise.resolve({
        tools: { den: { available } },
        manifest: [{ capabilityName: "available", scriptPath: "tools.den.available" }],
      }),
    })
    expect(result).toMatchObject({
      ok: false,
      error: "capability_unavailable",
      providerCallAttempted: false,
      missing: [{ capabilityName: "missingCapability", scriptPath: "tools.den.missingCapability" }],
    })
    expect(invocations).toBe(0)
  })

  test("rejects input that does not match the saved inputSchema", async () => {
    const seeded = await seedScript({
      title: "Typed Script",
      code: "return input.name",
      payload: {
        language: "codemode-js",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        requiredCapabilities: [],
      },
    })

    const result = await executeScript(seeded, { body: { name: 42 } })
    expect(result).toMatchObject({
      ok: false,
      error: "invalid_capability_arguments",
      sameArgumentsRetryable: false,
      retry: { action: "correct_arguments", searchRequired: false },
    })
    if (result.ok || result.error !== "invalid_capability_arguments") throw new Error("Expected invalid script arguments")
    expect(result.issues.length).toBeGreaterThan(0)
  })

  test("validates saved script output before returning an artifact-ready result", async () => {
    const seeded = await seedScript({
      title: "Typed Result Script",
      code: "return { count: 'not-a-number' }",
      payload: {
        language: "codemode-js",
        outputSchema: {
          type: "object",
          properties: { count: { type: "number" } },
          required: ["count"],
        },
        requiredCapabilities: [],
      },
    })

    const result = await executeScript(seeded)
    expect(result).toMatchObject({
      ok: false,
      error: "invalid_capability_arguments",
      sameArgumentsRetryable: false,
    })
  })

  test("lists accessible scripts with exact versions and artifact schemas", async () => {
    const seeded = await seedScript({
      title: "Artifact Script",
      code: "return { briefing: input.topic }",
      payload: {
        language: "codemode-js",
        inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
        outputSchema: { type: "object", properties: { briefing: { type: "string" } }, required: ["briefing"] },
        requiredCapabilities: [],
      },
    })

    const scripts = await marketplaceCapabilities.listAccessibleSavedCodemodeScripts({
      member: seeded.member,
      organizationId: seeded.organizationId,
    })
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toMatchObject({
      pluginId: seeded.pluginId,
      configObjectId: seeded.configObjectId,
      title: "Artifact Script",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    })
    expect(scripts[0]?.configObjectVersionId).toStartWith("cov_")
  })
})
