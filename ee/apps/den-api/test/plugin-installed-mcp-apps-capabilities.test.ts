import { createHash } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { and, eq } from "@openwork-ee/den-db/drizzle"
import { createDenTypeId, normalizeDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test_pluginapps"
  process.env.DB_MODE ??= "mysql"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "plugin-apps-test-encryption-key-1234567890"
  process.env.BETTER_AUTH_SECRET ??= "plugin-apps-test-secret-123456789012"
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS ??= "http://127.0.0.1:8790"
  // The import fixture serves loopback HTML; keep the SSRF guard in
  // realm-safe mode exactly like local development.
  process.env.OPENWORK_DEV_MODE = "1"
  process.env.DEN_ALLOW_PRIVATE_MCP_URLS = "1"
}

seedRequiredEnv()

let db: typeof import("../src/db.js").db
let schema: typeof import("@openwork-ee/den-db/schema")
let marketplace: typeof import("../src/mcp/marketplace-capabilities.js")
let remoteApps: typeof import("../src/remote-mcp-apps.js")
let launchToolNameFor: typeof import("../src/mcp/plugin-installed-mcp-apps.js")["pluginInstalledMcpAppLaunchToolName"]
let artifactDigestOf: typeof import("../src/saved-script-artifacts.js")["optionalArtifactDigest"]
type ActorContext = import("../src/routes/org/plugin-system/access.js").PluginArchActorContext

const organizationId = createDenTypeId("organization")
const adminUserId = createDenTypeId("user")
const memberUserId = createDenTypeId("user")
const outsiderUserId = createDenTypeId("user")
const adminMemberId = createDenTypeId("member")
const memberId = createDenTypeId("member")
const outsiderId = createDenTypeId("member")
const pluginId = createDenTypeId("plugin")
const legacyConfigObjectId = createDenTypeId("configObject")
const scriptConfigObjectId = createDenTypeId("configObject")

const appHtml = [
  "<!doctype html><html><head><title>Atlas Projects</title>",
  '<meta name="description" content="Browse Atlas projects and run capabilities.">',
  "</head><body><div id=\"app\"></div><script>window.ready=true</script></body></html>",
].join("")
const updatedAppHtml = appHtml.replace("window.ready=true", "window.ready='v2'")

const scriptInputSchema = { type: "object", properties: { region: { type: "string" } }, required: ["region"], additionalProperties: false }

const member = () => ({ orgMembershipId: memberId, teamIds: [] })
const outsider = () => ({ orgMembershipId: outsiderId, teamIds: [] })

let fixtureUrl = ""
let fixtureBody = appHtml
let installedAppId: DenTypeId<"configObject">
let installedVersionId: string

function actorContext(currentMemberId: DenTypeId<"member">, userId: DenTypeId<"user">, role: "admin" | "member"): ActorContext {
  return {
    memberTeams: [],
    organizationContext: {
      organization: {
        id: organizationId,
        name: "Plugin Apps Test",
        slug: `plugin-apps-${organizationId}`,
        logo: null,
        allowedEmailDomains: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      currentMember: {
        id: currentMemberId,
        userId,
        role,
        createdAt: new Date(),
        joinedAt: new Date(),
        isOwner: role === "admin",
      },
      invitations: [],
      members: [],
      roles: [],
      teams: [],
    },
    // Admin mutations demand a fresh privileged session, matching the REST
    // routes where the browser session provides it.
    session: { createdAt: new Date() },
  }
}

async function cleanup() {
  await db.delete(schema.RemoteMcpAppTable).where(eq(schema.RemoteMcpAppTable.organizationId, organizationId))
  await db.delete(schema.ConfigObjectVersionTable).where(eq(schema.ConfigObjectVersionTable.organizationId, organizationId))
  await db.delete(schema.PluginConfigObjectTable).where(eq(schema.PluginConfigObjectTable.organizationId, organizationId))
  await db.delete(schema.ConfigObjectAccessGrantTable).where(eq(schema.ConfigObjectAccessGrantTable.organizationId, organizationId))
  await db.delete(schema.PluginAccessGrantTable).where(eq(schema.PluginAccessGrantTable.organizationId, organizationId))
  await db.delete(schema.ConfigObjectTable).where(eq(schema.ConfigObjectTable.organizationId, organizationId))
  await db.delete(schema.PluginTable).where(eq(schema.PluginTable.organizationId, organizationId))
  await db.delete(schema.MemberTable).where(eq(schema.MemberTable.organizationId, organizationId))
  await db.delete(schema.OrganizationTable).where(eq(schema.OrganizationTable.id, organizationId))
  await db.delete(schema.AuthUserTable).where(eq(schema.AuthUserTable.id, adminUserId))
  await db.delete(schema.AuthUserTable).where(eq(schema.AuthUserTable.id, memberUserId))
  await db.delete(schema.AuthUserTable).where(eq(schema.AuthUserTable.id, outsiderUserId))
}

const fixture = createServer((request, response) => {
  if (request.url?.startsWith("/app.html")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    response.end(fixtureBody)
    return
  }
  response.writeHead(404, { "content-type": "text/plain" })
  response.end("not found")
})

beforeAll(async () => {
  mock.restore()
  const realDb = (await import("@openwork-ee/den-db")).createDenDb({
    databaseUrl: process.env.DATABASE_URL,
    mode: "mysql",
  }).db
  db = realDb
  mock.module("../src/db.js", () => ({ db: realDb }))
  schema = await import("@openwork-ee/den-db/schema")
  marketplace = await import("../src/mcp/marketplace-capabilities.js")
  remoteApps = await import("../src/remote-mcp-apps.js")
  launchToolNameFor = (await import("../src/mcp/plugin-installed-mcp-apps.js")).pluginInstalledMcpAppLaunchToolName
  artifactDigestOf = (await import("../src/saved-script-artifacts.js")).optionalArtifactDigest

  await new Promise<void>((resolve, reject) => {
    fixture.once("error", reject)
    fixture.listen(0, "127.0.0.1", resolve)
  })
  fixtureUrl = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`

  await cleanup()
  await db.insert(schema.AuthUserTable).values([
    { id: adminUserId, name: "Avery Admin", email: `${adminUserId}@plugin-apps.test`, emailVerified: true },
    { id: memberUserId, name: "Casey Member", email: `${memberUserId}@plugin-apps.test`, emailVerified: true },
    { id: outsiderUserId, name: "Oli Outsider", email: `${outsiderUserId}@plugin-apps.test`, emailVerified: true },
  ])
  await db.insert(schema.OrganizationTable).values({
    id: organizationId,
    name: "Plugin Apps Test",
    slug: `plugin-apps-${organizationId}`,
  })
  await db.insert(schema.MemberTable).values([
    { id: adminMemberId, organizationId, userId: adminUserId, role: "admin" },
    { id: memberId, organizationId, userId: memberUserId, role: "member" },
    { id: outsiderId, organizationId, userId: outsiderUserId, role: "member" },
  ])
  await db.insert(schema.PluginTable).values({
    id: pluginId,
    organizationId,
    name: "Atlas Plugin",
    description: "Apps and Programs for Atlas work",
    status: "active",
    createdByOrgMembershipId: adminMemberId,
  })
  // Only the granted member (not the outsider) can use the plugin.
  await db.insert(schema.PluginAccessGrantTable).values({
    id: createDenTypeId("pluginAccessGrant"),
    organizationId,
    pluginId,
    orgMembershipId: memberId,
    teamId: null,
    orgWide: false,
    role: "viewer",
    createdByOrgMembershipId: adminMemberId,
  })
  // A dormant legacy record: config object + installation state row, but no
  // plugin membership. It must stay stored and unreachable.
  await db.insert(schema.ConfigObjectTable).values({
    id: legacyConfigObjectId,
    organizationId,
    objectType: "app",
    sourceMode: "import",
    title: "Legacy Standalone App",
    status: "active",
    createdByOrgMembershipId: adminMemberId,
  })
  await db.insert(schema.RemoteMcpAppTable).values({
    configObjectId: legacyConfigObjectId,
    organizationId,
    pluginId,
    sourceUrl: "https://legacy.example.test/app.html",
    resolvedSourceUrl: "https://legacy.example.test/app.html",
    status: "active",
  })
  // A saved Program (Code Mode script) inside the same plugin.
  await db.insert(schema.ConfigObjectTable).values({
    id: scriptConfigObjectId,
    organizationId,
    objectType: "script",
    sourceMode: "cloud",
    title: "Atlas Region Report",
    description: "Summarize one Atlas region.",
    status: "active",
    createdByOrgMembershipId: adminMemberId,
  })
  await db.insert(schema.ConfigObjectVersionTable).values({
    id: createDenTypeId("configObjectVersion"),
    organizationId,
    configObjectId: scriptConfigObjectId,
    versionNumber: 1,
    schemaVersion: "openwork.codemode-script/1",
    normalizedPayloadJson: {
      language: "codemode-js",
      inputSchema: scriptInputSchema,
      requiredCapabilities: [],
    },
    rawSourceText: "return { region: input.region, ok: true }",
    createdByOrgMembershipId: adminMemberId,
  })
  await db.insert(schema.PluginConfigObjectTable).values({
    id: createDenTypeId("pluginConfigObject"),
    organizationId,
    pluginId,
    configObjectId: scriptConfigObjectId,
    membershipSource: "manual",
    createdByOrgMembershipId: adminMemberId,
  })

  // Install the App through the real storage path (guarded fetch + validation
  // + immutable revision), exactly like the REST route would.
  const installed = await remoteApps.importRemoteMcpApp({
    context: actorContext(adminMemberId, adminUserId, "admin"),
    pluginId,
    sourceUrl: `${fixtureUrl}/app.html`,
  })
  installedAppId = normalizeDenTypeId("configObject", installed.id)
  if (!installed.activeVersionId) throw new Error("fixture app was not activated")
  installedVersionId = installed.activeVersionId
})

afterAll(async () => {
  await cleanup()
  await new Promise<void>((resolve, reject) => fixture.close((error) => (error ? reject(error) : resolve())))
  mock.restore()
})

function capabilityNameFor(configObjectId: string) {
  return `plugin:${pluginId}:${configObjectId}`
}

test("installation by URL requires an authorized plugin and an authorized editor", async () => {
  await expect(remoteApps.importRemoteMcpApp({
    context: actorContext(outsiderId, outsiderUserId, "member"),
    pluginId,
    sourceUrl: `${fixtureUrl}/app.html`,
  })).rejects.toMatchObject({ status: 403 })

  // A missing plugin is indistinguishable from an unauthorized one: the
  // access layer rejects before any outbound download happens.
  await expect(remoteApps.importRemoteMcpApp({
    context: actorContext(adminMemberId, adminUserId, "admin"),
    pluginId: createDenTypeId("plugin"),
    sourceUrl: `${fixtureUrl}/app.html`,
  })).rejects.toMatchObject({ status: 403 })

  await expect(remoteApps.importRemoteMcpApp({
    context: actorContext(adminMemberId, adminUserId, "admin"),
    pluginId: "not-a-plugin-id",
    sourceUrl: `${fixtureUrl}/app.html`,
  })).rejects.toMatchObject({ code: "plugin_not_found" })
})

test("repeating the same install into the same plugin is idempotent", async () => {
  const again = await remoteApps.importRemoteMcpApp({
    context: actorContext(adminMemberId, adminUserId, "admin"),
    pluginId,
    sourceUrl: `${fixtureUrl}/app.html`,
  })
  expect(again.id).toBe(String(installedAppId))
  const rows = await db.select().from(schema.RemoteMcpAppTable).where(and(
    eq(schema.RemoteMcpAppTable.organizationId, organizationId),
    eq(schema.RemoteMcpAppTable.sourceUrl, `${fixtureUrl}/app.html`),
  ))
  expect(rows).toHaveLength(1)
})

test("an authorized member discovers the installed App through marketplace capability search without source URLs", async () => {
  const matches = await marketplace.searchMarketplaceCapabilities({
    organizationId,
    member: member(),
    query: "atlas projects app",
    limit: 5,
    installedMcpAppsEnabled: true,
  })
  const match = matches.find((candidate) => candidate.name === capabilityNameFor(String(installedAppId)))
  expect(match).toMatchObject({
    kind: "mcp_app",
    plugin: "Atlas Plugin",
    hasBody: true,
    invocation: { argumentsField: "body" },
    mcpApp: { resourceUri: remoteApps.remoteMcpAppResourceUri(String(installedAppId), installedVersionId) },
  })
  expect(match?.summary).toContain("Atlas Projects")
  const serialized = JSON.stringify(matches)
  expect(serialized).not.toContain(fixtureUrl)
  expect(serialized).not.toContain("app.html")
  expect(serialized).not.toContain("<!doctype")
  expect(serialized).not.toContain("<script")
})

test("the installed-App rollout defaults off: search hides Apps and execute fails closed even for authorized members", async () => {
  const defaultOff = await marketplace.searchMarketplaceCapabilities({
    organizationId,
    member: member(),
    query: "atlas projects app",
    limit: 5,
  })
  expect(defaultOff.find((candidate) => candidate.kind === "mcp_app")).toBeUndefined()

  const executed = await marketplace.executeMarketplaceCapability({
    organizationId,
    member: member(),
    pluginId,
    configObjectId: String(installedAppId),
  })
  expect(executed).toEqual({ ok: false, error: "unknown_capability", message: "No such capability." })
})

test("an unauthorized member cannot discover, launch, or read the installed App", async () => {
  const matches = await marketplace.searchMarketplaceCapabilities({
    organizationId,
    member: outsider(),
    query: "atlas projects app",
    limit: 5,
    installedMcpAppsEnabled: true,
  })
  expect(matches.find((candidate) => candidate.kind === "mcp_app")).toBeUndefined()

  const executed = await marketplace.executeMarketplaceCapability({
    organizationId,
    member: outsider(),
    pluginId,
    configObjectId: String(installedAppId),
    installedMcpAppsEnabled: true,
  })
  expect(executed.ok).toBe(false)
  if (!executed.ok) expect(executed.error).toBe("forbidden")

  const descriptors = await marketplace.listAccessiblePluginInstalledMcpApps({
    enabled: true,
    member: outsider(),
    organizationId,
  })
  expect(descriptors).toEqual([])
})

test("execute_capability launches the exact immutable active revision with the Desktop adapter binding", async () => {
  const executed = await marketplace.executeMarketplaceCapability({
    organizationId,
    member: member(),
    pluginId,
    configObjectId: String(installedAppId),
    body: { input: { query: "migration" } },
    installedMcpAppsEnabled: true,
  })
  expect(executed.ok).toBe(true)
  if (!executed.ok) return
  expect(executed.result.status).toBe("executed")
  expect(executed.result.kind).toBe("mcp_app")
  expect(executed.result.app).toMatchObject({
    id: String(installedAppId),
    name: "Atlas Projects",
    revisionId: installedVersionId,
    resourceDigest: `sha256:${createHash("sha256").update(appHtml).digest("hex")}`,
  })
  expect(executed.result.serverTools).toEqual({
    searchCapabilities: "search_capabilities",
    executeCapability: "execute_capability",
  })
  expect(executed.result.input).toEqual({ query: "migration" })
  expect(executed.result.mcpApp).toEqual({
    toolName: launchToolNameFor(String(installedAppId)),
    resourceUri: remoteApps.remoteMcpAppResourceUri(String(installedAppId), installedVersionId),
  })
  const serialized = JSON.stringify(executed)
  expect(serialized).not.toContain(fixtureUrl)
  expect(serialized).not.toContain("<!doctype")
})

test("the accessible-App catalog lists the App for authorized members and nothing when disabled", async () => {
  const descriptors = await marketplace.listAccessiblePluginInstalledMcpApps({
    enabled: true,
    member: member(),
    organizationId,
  })
  expect(descriptors).toHaveLength(1)
  expect(descriptors[0]).toMatchObject({
    configObjectId: String(installedAppId),
    pluginId: String(pluginId),
    pluginName: "Atlas Plugin",
    activeVersionId: installedVersionId,
    resourceUri: remoteApps.remoteMcpAppResourceUri(String(installedAppId), installedVersionId),
  })

  const disabled = await marketplace.listAccessiblePluginInstalledMcpApps({
    enabled: false,
    member: member(),
    organizationId,
  })
  expect(disabled).toEqual([])
})

test("a dormant legacy record without plugin membership stays stored, inactive, and unreachable", async () => {
  const matches = await marketplace.searchMarketplaceCapabilities({
    organizationId,
    member: member(),
    query: "legacy standalone app",
    limit: 5,
    installedMcpAppsEnabled: true,
  })
  expect(matches.find((candidate) => candidate.name === capabilityNameFor(String(legacyConfigObjectId)))).toBeUndefined()

  const executed = await marketplace.executeMarketplaceCapability({
    organizationId,
    member: member(),
    pluginId,
    configObjectId: String(legacyConfigObjectId),
    installedMcpAppsEnabled: true,
  })
  expect(executed.ok).toBe(false)
  if (!executed.ok) expect(executed.error).toBe("unknown_capability")

  const stored = await db.select().from(schema.RemoteMcpAppTable)
    .where(eq(schema.RemoteMcpAppTable.configObjectId, legacyConfigObjectId))
  expect(stored).toHaveLength(1)
})

test("refresh caches a new immutable draft without replacing the active revision, and unchanged content adds nothing", async () => {
  const unchanged = await remoteApps.refreshRemoteMcpApp({
    context: actorContext(adminMemberId, adminUserId, "admin"),
    configObjectId: String(installedAppId),
  })
  expect(unchanged.revisions).toHaveLength(1)

  fixtureBody = updatedAppHtml
  const refreshed = await remoteApps.refreshRemoteMcpApp({
    context: actorContext(adminMemberId, adminUserId, "admin"),
    configObjectId: String(installedAppId),
  })
  fixtureBody = appHtml
  expect(refreshed.revisions).toHaveLength(2)
  expect(refreshed.activeVersionId).toBe(installedVersionId)
  expect(refreshed.activeRevision?.resource.digest).toBe(`sha256:${createHash("sha256").update(appHtml).digest("hex")}`)
  expect(refreshed.latestRevision?.resource.digest).toBe(`sha256:${createHash("sha256").update(updatedAppHtml).digest("hex")}`)

  // The launchable surface still serves the exact active revision.
  const descriptors = await marketplace.listAccessiblePluginInstalledMcpApps({
    enabled: true,
    member: member(),
    organizationId,
  })
  expect(descriptors[0]?.activeVersionId).toBe(installedVersionId)
})

test("retiring the App removes discovery and launch while retaining records; restore brings it back", async () => {
  await remoteApps.setRemoteMcpAppRetired({
    context: actorContext(adminMemberId, adminUserId, "admin"),
    configObjectId: String(installedAppId),
    retired: true,
  })

  const matches = await marketplace.searchMarketplaceCapabilities({
    organizationId,
    member: member(),
    query: "atlas projects app",
    limit: 5,
    installedMcpAppsEnabled: true,
  })
  expect(matches.find((candidate) => candidate.kind === "mcp_app")).toBeUndefined()

  const executed = await marketplace.executeMarketplaceCapability({
    organizationId,
    member: member(),
    pluginId,
    configObjectId: String(installedAppId),
    installedMcpAppsEnabled: true,
  })
  expect(executed.ok).toBe(false)
  if (!executed.ok) expect(executed.error).toBe("unknown_capability")

  const stored = await db.select().from(schema.RemoteMcpAppTable)
    .where(eq(schema.RemoteMcpAppTable.configObjectId, installedAppId))
  expect(stored[0]?.status).toBe("retired")
  expect(stored[0]?.activeVersionId).toBe(installedVersionId)

  await remoteApps.setRemoteMcpAppRetired({
    context: actorContext(adminMemberId, adminUserId, "admin"),
    configObjectId: String(installedAppId),
    retired: false,
  })
  const restored = await marketplace.listAccessiblePluginInstalledMcpApps({
    enabled: true,
    member: member(),
    organizationId,
  })
  expect(restored).toHaveLength(1)
})

test("archiving the plugin removes its App from discovery and launch while records stay stored", async () => {
  await db.update(schema.PluginTable).set({ status: "archived" }).where(eq(schema.PluginTable.id, pluginId))
  try {
    const matches = await marketplace.searchMarketplaceCapabilities({
      organizationId,
      member: member(),
      query: "atlas projects app",
      limit: 5,
      installedMcpAppsEnabled: true,
    })
    expect(matches.find((candidate) => candidate.kind === "mcp_app")).toBeUndefined()

    const executed = await marketplace.executeMarketplaceCapability({
      organizationId,
      member: member(),
      pluginId,
      configObjectId: String(installedAppId),
      installedMcpAppsEnabled: true,
    })
    expect(executed.ok).toBe(false)

    const stored = await db.select().from(schema.RemoteMcpAppTable)
      .where(eq(schema.RemoteMcpAppTable.configObjectId, installedAppId))
    expect(stored).toHaveLength(1)
  } finally {
    await db.update(schema.PluginTable).set({ status: "active" }).where(eq(schema.PluginTable.id, pluginId))
  }
})

test("an authorized member discovers the plugin's Program with its argumentsSchema and schemaDigest when Code Mode is enabled", async () => {
  const matches = await marketplace.searchMarketplaceCapabilities({
    organizationId,
    member: member(),
    query: "atlas region report",
    limit: 5,
    codemodeEnabled: true,
    installedMcpAppsEnabled: true,
  })
  const match = matches.find((candidate) => candidate.name === capabilityNameFor(String(scriptConfigObjectId)))
  expect(match).toMatchObject({
    kind: "script",
    argumentsSchema: scriptInputSchema,
    schemaDigest: artifactDigestOf(scriptInputSchema),
  })

  const codemodeOff = await marketplace.searchMarketplaceCapabilities({
    organizationId,
    member: member(),
    query: "atlas region report",
    limit: 5,
    installedMcpAppsEnabled: true,
  })
  expect(codemodeOff.find((candidate) => candidate.kind === "script")).toBeUndefined()
})

test("executing the Program with the current schemaDigest succeeds and returns its structured result", async () => {
  const executed = await marketplace.executeMarketplaceCapability({
    organizationId,
    member: member(),
    pluginId,
    configObjectId: String(scriptConfigObjectId),
    body: { region: "emea" },
    codemodeEnabled: true,
    installedMcpAppsEnabled: true,
    schemaDigest: artifactDigestOf(scriptInputSchema) ?? undefined,
    buildTools: async () => ({ tools: {}, manifest: [] }),
  })
  expect(executed.ok).toBe(true)
  if (!executed.ok) return
  expect(executed.result.status).toBe("executed")
  expect(executed.result.value).toEqual({ region: "emea", ok: true })
})

test("a stale Program schemaDigest is rejected and requires a fresh search", async () => {
  const executed = await marketplace.executeMarketplaceCapability({
    organizationId,
    member: member(),
    pluginId,
    configObjectId: String(scriptConfigObjectId),
    body: { region: "emea" },
    codemodeEnabled: true,
    installedMcpAppsEnabled: true,
    schemaDigest: `sha256:${"0".repeat(64)}`,
    buildTools: async () => ({ tools: {}, manifest: [] }),
  })
  expect(executed.ok).toBe(false)
  if (executed.ok) return
  expect(executed.error).toBe("invalid_capability_arguments")
  if (executed.error !== "invalid_capability_arguments") return
  expect(executed.retry).toEqual({ action: "search_capabilities", searchRequired: true })
  expect(executed.schemaDigest).toBe(artifactDigestOf(scriptInputSchema) ?? "")
})

test("the Program stays unavailable while Code Mode is off even though ordinary App capabilities work", async () => {
  const executed = await marketplace.executeMarketplaceCapability({
    organizationId,
    member: member(),
    pluginId,
    configObjectId: String(scriptConfigObjectId),
    body: { region: "emea" },
    installedMcpAppsEnabled: true,
  })
  expect(executed).toEqual({ ok: false, error: "unknown_capability", message: "No such capability." })

  const appStillWorks = await marketplace.executeMarketplaceCapability({
    organizationId,
    member: member(),
    pluginId,
    configObjectId: String(installedAppId),
    installedMcpAppsEnabled: true,
  })
  expect(appStillWorks.ok).toBe(true)
})

test("source URL validation rejects credentials, fragments, and sensitive query parameters", () => {
  expect(() => remoteApps.validateRemoteMcpAppSourceUrl("https://user:secret@apps.example/app.html"))
    .toThrow(/embedded credentials/)
  expect(() => remoteApps.validateRemoteMcpAppSourceUrl("https://apps.example/app.html#fragment"))
    .toThrow(/fragment/)
  expect(() => remoteApps.validateRemoteMcpAppSourceUrl("https://apps.example/app.html?access_token=abc"))
    .toThrow(/credentials/)
  expect(() => remoteApps.validateRemoteMcpAppSourceUrl("http://apps.example/app.html"))
    .toThrow(/HTTPS/)
  expect(remoteApps.validateRemoteMcpAppSourceUrl("http://127.0.0.1:8080/app.html", true))
    .toBe("http://127.0.0.1:8080/app.html")
})

test("content validation rejects wrong MIME types, non-UTF-8 charsets, and non-self-contained HTML", () => {
  expect(() => remoteApps.validateRemoteMcpAppContentType("application/json")).toThrow(/text\/html/)
  expect(() => remoteApps.validateRemoteMcpAppContentType("text/html; charset=latin1")).toThrow(/UTF-8/)
  expect(remoteApps.validateRemoteMcpAppContentType("text/html; charset=utf-8")).toBe("text/html")
  expect(() => remoteApps.inspectRemoteMcpAppHtml("just some text")).toThrow(/complete HTML document/)
  expect(() => remoteApps.inspectRemoteMcpAppHtml('<!doctype html><html><body><script src="https://cdn.example/x.js"></script></body></html>'))
    .toThrow(/self-contained/)
  expect(() => remoteApps.inspectRemoteMcpAppHtml('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body></body></html>'))
    .toThrow(/embedded CSP/)
})
