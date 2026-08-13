import { createHash } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { expect, test } from "bun:test"
import { dynamicArtifactAppServerCapabilities } from "../src/mcp/dynamic-artifact-app.js"

process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3005"
process.env.OPENWORK_DEV_MODE ??= "1"
process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_den"

const {
  registerAgentRemoteMcpApps,
  remoteMcpAppCapabilityToolName,
  remoteMcpAppLaunchToolName,
} = await import("../src/mcp/remote-mcp-apps.js")
const { remoteMcpAppResourceUri } = await import("../src/remote-mcp-apps.js")

const configObjectId = "cob_01k28e8q8pf8r9sff9mhyqxved"
const versionId = "cov_01k28e8q8pf8r9sff9mhyqxved"
const pluginId = "plg_01k28e8q8pf8r9sff9mhyqxved"
const organizationId = "org_01k28e8q8pf8r9sff9mhyqxved"
const memberId = "om_01k28e8q8pf8r9sff9mhyqxved"
const connectionId = "emc_01k28e8q8pf8r9sff9mhyqxved"
const html = '<!doctype html><html><body><div id="app"></div><script>window.ready=true</script></body></html>'
const resourceDigest = `sha256:${createHash("sha256").update(html).digest("hex")}`
const resourceUri = remoteMcpAppResourceUri(configObjectId, versionId)
const activePayload = {
  kind: "remote_mcp_app",
  manifest: {
    schemaVersion: "openwork.remote-mcp-app/1",
    name: "Project Explorer",
    version: "1.0.0",
    description: "Browse connected projects.",
    capabilities: [{
      key: "project-search",
      title: "Project search",
      toolName: "search_projects",
      access: "read",
      required: true,
      schemaDigest: `sha256:${"a".repeat(64)}`,
    }],
  },
  source: {
    url: "https://apps.example/project-explorer.html",
    resolvedUrl: "https://cdn.example/project-explorer.1.0.0.html",
    fetchedAt: "2026-08-13T10:00:00.000Z",
    contentType: "text/html",
  },
  resource: {
    byteSize: Buffer.byteLength(html),
    digest: resourceDigest,
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
  },
  diagnostics: [],
}

const activeApp = {
  app: {
    configObjectId,
    organizationId,
    pluginId,
    activeVersionId: versionId,
    sourceUrl: "https://apps.example/project-explorer.html",
    resolvedSourceUrl: "https://cdn.example/project-explorer.1.0.0.html",
    status: "active",
    createdAt: new Date("2026-08-13T10:00:00.000Z"),
    updatedAt: new Date("2026-08-13T10:00:00.000Z"),
    retiredAt: null,
  },
  bindings: [{
    id: "pmr_01k28e8q8pf8r9sff9mhyqxved",
    organizationId,
    pluginId,
    configObjectId,
    serverName: "project-search",
    externalMcpConnectionId: connectionId,
    requiredAuthType: null,
    connectionOwnedByPlugin: false,
    createdByOrgMembershipId: memberId,
    createdAt: new Date("2026-08-13T10:00:00.000Z"),
    updatedAt: new Date("2026-08-13T10:00:00.000Z"),
  }],
  payload: activePayload,
  resourceUri,
  versionId,
  revisions: [{
    payload: activePayload,
    resourceUri,
    versionId,
  }],
}

async function withClient<T>(run: (client: Client) => Promise<T>) {
  const server = new McpServer(
    { name: "remote-mcp-app-test", version: "1.0.0" },
    { capabilities: dynamicArtifactAppServerCapabilities },
  )
  registerAgentRemoteMcpApps({
    server,
    apps: [activeApp as never],
    organizationId,
    member: { orgMembershipId: memberId, teamIds: [] },
    redirectUriBase: "https://cloud.openwork.software",
    loadResource: async () => ({ html, payload: activePayload as never }),
  })
  const client = new Client({ name: "desktop-host", version: "1.0.0" }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    return await run(client)
  } finally {
    await client.close()
    await server.close()
  }
}

test("advertises the exact immutable ui resource and app-scoped Connect proxy", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools()
    const launch = tools.tools.find((tool) => tool.name === remoteMcpAppLaunchToolName(configObjectId))
    expect(launch?._meta).toMatchObject({ ui: { resourceUri, visibility: ["model", "app"] } })
    const proxy = tools.tools.find((tool) => tool.name === remoteMcpAppCapabilityToolName(configObjectId, "project-search"))
    expect(proxy?._meta).toMatchObject({ ui: { visibility: ["app"] } })
    expect(proxy?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })

    const resources = await client.listResources()
    expect(resources.resources).toContainEqual(expect.objectContaining({
      uri: resourceUri,
      mimeType: "text/html;profile=mcp-app",
      _meta: expect.objectContaining({
        ui: expect.objectContaining({ csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } }),
        resourceDigest,
      }),
    }))
  })
})

test("serves exact cached bytes and gives render-time capability names through structuredContent", async () => {
  await withClient(async (client) => {
    const resource = await client.readResource({ uri: resourceUri })
    const content = resource.contents[0]
    expect(content && "text" in content ? content.text : null).toBe(html)
    expect(html).not.toContain(connectionId)

    const launch = await client.callTool({
      name: remoteMcpAppLaunchToolName(configObjectId),
      arguments: { input: { project: "alpha" } },
    })
    expect(launch.structuredContent).toMatchObject({
      schemaVersion: "openwork.remote-mcp-app-launch/1",
      app: { id: configObjectId, revisionId: versionId, resourceDigest },
      capabilities: [{
        key: "project-search",
        toolName: remoteMcpAppCapabilityToolName(configObjectId, "project-search"),
        argumentsField: "arguments",
        bound: true,
      }],
      input: { project: "alpha" },
    })
    expect(JSON.stringify(launch.structuredContent)).not.toContain(connectionId)
  })
})
