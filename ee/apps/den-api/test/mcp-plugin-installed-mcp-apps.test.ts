import { createHash } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { expect, test } from "bun:test"

process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3005"
process.env.OPENWORK_DEV_MODE ??= "1"
process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_den"

const { dynamicArtifactAppServerCapabilities } = await import("../src/mcp/dynamic-artifact-app.js")
const {
  pluginInstalledMcpAppLaunchToolName,
  pluginInstalledMcpAppLaunchResult,
  registerPluginInstalledMcpApps,
} = await import("../src/mcp/plugin-installed-mcp-apps.js")
const { remoteMcpAppResourceUri } = await import("../src/remote-mcp-apps.js")

const configObjectId = "cob_01k28e8q8pf8r9sff9mhyqxved"
const versionId = "cov_01k28e8q8pf8r9sff9mhyqxved"
const pluginId = "plg_01k28e8q8pf8r9sff9mhyqxved"
const html = '<!doctype html><html><body><div id="app"></div><script>window.ready=true</script></body></html>'
const resourceDigest = `sha256:${createHash("sha256").update(html).digest("hex")}`
const resourceUri = remoteMcpAppResourceUri(configObjectId, versionId)

const descriptor = {
  configObjectId,
  pluginId,
  pluginName: "Atlas Plugin",
  marketplaceName: "Org Marketplace",
  title: "Project Explorer",
  description: "Browse connected projects.",
  metadata: {
    name: "Project Explorer",
    version: "1.0.0",
    description: "Browse connected projects.",
    launchTool: {
      title: "Open Project Explorer",
      description: "Open the cached Project Explorer app.",
    },
  },
  activeVersionId: versionId,
  resourceUri,
  resourceDigest,
  byteSize: Buffer.byteLength(html),
  csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
}

async function withClient<T>(
  run: (client: Client) => Promise<T>,
  options: { loadHtml?: () => Promise<string> } = {},
) {
  const server = new McpServer(
    { name: "plugin-installed-mcp-app-test", version: "1.0.0" },
    { capabilities: dynamicArtifactAppServerCapabilities },
  )
  registerPluginInstalledMcpApps({
    server,
    apps: [descriptor],
    loadResource: async () => ({ html: await (options.loadHtml ?? (async () => html))() }),
  })
  const client = new Client({ name: "standards-host", version: "1.0.0" }, { capabilities: {} })
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

test("advertises one inert app-visible launcher bound to the exact immutable ui:// revision", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools()
    expect(tools.tools).toHaveLength(1)
    const launcher = tools.tools[0]
    expect(launcher?.name).toBe(pluginInstalledMcpAppLaunchToolName(configObjectId))
    expect(launcher?._meta).toMatchObject({ ui: { resourceUri, visibility: ["app"] } })
    expect(launcher?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false })

    const resources = await client.listResources()
    expect(resources.resources).toContainEqual(expect.objectContaining({
      uri: resourceUri,
      mimeType: "text/html;profile=mcp-app",
      _meta: expect.objectContaining({
        ui: expect.objectContaining({
          csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
        }),
        resourceDigest,
      }),
    }))
  })
})

test("never registers an installer tool or any provider operation tool", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools()
    const names = tools.tools.map((tool) => tool.name)
    expect(names).toEqual([pluginInstalledMcpAppLaunchToolName(configObjectId)])
    expect(names).not.toContain("import_remote_mcp_app")
    const attempted = await client.callTool({ name: "import_remote_mcp_app", arguments: {} }).catch((error: unknown) => error)
    const failedClosed = attempted instanceof Error
      || (typeof attempted === "object" && attempted !== null && (attempted as { isError?: boolean }).isError === true)
    expect(failedClosed).toBe(true)
  })
})

test("serves the exact cached bytes and returns bounded launch structuredContent", async () => {
  await withClient(async (client) => {
    const resource = await client.readResource({ uri: resourceUri })
    const content = resource.contents[0]
    expect(content && "text" in content ? content.text : null).toBe(html)

    const launch = await client.callTool({
      name: pluginInstalledMcpAppLaunchToolName(configObjectId),
      arguments: { input: { project: "alpha" } },
    })
    expect(launch.structuredContent).toEqual({
      app: {
        id: configObjectId,
        name: "Project Explorer",
        version: "1.0.0",
        revisionId: versionId,
        resourceDigest,
      },
      serverTools: {
        searchCapabilities: "search_capabilities",
        executeCapability: "execute_capability",
      },
      input: { project: "alpha" },
    })
    const serialized = JSON.stringify(launch)
    expect(serialized).not.toContain("https://")
    expect(serialized).not.toContain("<!doctype")
  })
})

test("fails closed when the stored bytes no longer match the immutable revision digest", async () => {
  await withClient(async (client) => {
    const read = await client.readResource({ uri: resourceUri }).catch((error: unknown) => error)
    expect(String(read)).toContain("plugin_mcp_app_resource_digest_mismatch")
  }, { loadHtml: async () => `${html}<!-- tampered -->` })
})

test("the launch result builder echoes launch input only when provided", () => {
  const withoutInput = pluginInstalledMcpAppLaunchResult(descriptor)
  expect(withoutInput.structuredContent).not.toHaveProperty("input")
  expect(withoutInput.content[0]?.text).toBe("Opened Project Explorer 1.0.0.")
  const withInput = pluginInstalledMcpAppLaunchResult(descriptor, { q: 1 })
  expect(withInput.structuredContent.input).toEqual({ q: 1 })
})
