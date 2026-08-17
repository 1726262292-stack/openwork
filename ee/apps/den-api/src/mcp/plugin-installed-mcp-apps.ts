import { createHash } from "node:crypto"
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server"
import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { RemoteMcpAppDocumentMetadata } from "../remote-mcp-apps.js"
import {
  EXECUTE_CAPABILITY_TOOL_NAME,
  SEARCH_CAPABILITIES_TOOL_NAME,
} from "./search.js"

/**
 * The standard MCP Apps surface for URL Apps installed into OpenWork Connect
 * Plugins and hosted by the central `openwork-cloud` server.
 *
 * Contract:
 * - every visible installed App registers exactly one inert, app-visible
 *   launch tool bound to the active immutable `ui://` revision through
 *   standard `_meta.ui.resourceUri` metadata;
 * - the active revision is served as a normal MCP resource with
 *   `text/html;profile=mcp-app` through ordinary `resources/read`;
 * - operational calls from the rendered App go through the same-server
 *   `search_capabilities` and `execute_capability` gateway tools only.
 *
 * There is no model-visible installer tool and no per-App MCP server. A
 * standards-compliant MCP Apps host that connects only to `openwork-cloud`
 * can list tools, find the launcher, read the bound resource, and render the
 * App without OpenWork Desktop, proprietary headers, or `openwork/mcpApp`
 * launch metadata.
 */

export type PluginInstalledMcpAppDescriptor = {
  configObjectId: string
  pluginId: string
  pluginName: string
  marketplaceName?: string
  title: string
  description: string | null
  metadata: RemoteMcpAppDocumentMetadata
  activeVersionId: string
  resourceUri: string
  resourceDigest: string
  byteSize: number
  csp: {
    connectDomains: string[]
    resourceDomains: string[]
    frameDomains: string[]
    baseUriDomains: string[]
  }
}

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function stableSuffix(value: string, length = 12) {
  return createHash("sha256").update(value).digest("hex").slice(0, length)
}

export function pluginInstalledMcpAppLaunchToolName(configObjectId: string) {
  return `open_plugin_app_${stableSuffix(configObjectId)}`
}

export function pluginInstalledMcpAppLaunchResult(
  app: Pick<
    PluginInstalledMcpAppDescriptor,
    "activeVersionId" | "configObjectId" | "metadata" | "resourceDigest"
  >,
  launchInput?: unknown,
) {
  const structuredContent = {
    app: {
      id: app.configObjectId,
      name: app.metadata.name,
      version: app.metadata.version,
      revisionId: app.activeVersionId,
      resourceDigest: app.resourceDigest,
    },
    serverTools: {
      searchCapabilities: SEARCH_CAPABILITIES_TOOL_NAME,
      executeCapability: EXECUTE_CAPABILITY_TOOL_NAME,
    },
    ...(launchInput === undefined ? {} : { input: launchInput }),
  }
  return {
    content: [{ type: "text" as const, text: `Opened ${app.metadata.name} ${app.metadata.version}.` }],
    structuredContent,
  }
}

function resourceMeta(app: PluginInstalledMcpAppDescriptor): { ui: McpUiResourceMeta; resourceDigest: string } {
  return {
    ui: { csp: app.csp, prefersBorder: true },
    resourceDigest: app.resourceDigest,
  }
}

export function registerPluginInstalledMcpApps(input: {
  server: McpServer
  apps: PluginInstalledMcpAppDescriptor[]
  loadResource: (request: { configObjectId: string; versionId: string }) => Promise<{ html: string }>
}) {
  for (const app of input.apps) {
    const meta = resourceMeta(app)
    registerAppResource(
      input.server,
      `Plugin MCP App ${app.configObjectId} ${app.activeVersionId}`,
      app.resourceUri,
      {
        title: `${app.metadata.name} ${app.metadata.version}`,
        description: "The active immutable revision of an MCP App installed into an OpenWork Connect Plugin.",
        _meta: meta,
      },
      async () => {
        const loaded = await input.loadResource({
          configObjectId: app.configObjectId,
          versionId: app.activeVersionId,
        })
        if (digest(loaded.html) !== app.resourceDigest) {
          throw new Error("plugin_mcp_app_resource_digest_mismatch")
        }
        return {
          contents: [{
            uri: app.resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: loaded.html,
            _meta: meta,
          }],
        }
      },
    )

    registerAppTool(
      input.server,
      pluginInstalledMcpAppLaunchToolName(app.configObjectId),
      {
        title: app.metadata.launchTool?.title ?? app.metadata.name,
        description: app.metadata.launchTool?.description ?? app.metadata.description ?? `Open ${app.metadata.name}.`,
        // The launcher is inert: it binds the exact ui:// revision and echoes
        // launch context. It never performs provider operations — those go
        // through search_capabilities and execute_capability.
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: z.object({ input: z.unknown().optional() }),
        _meta: { ui: { resourceUri: app.resourceUri, visibility: ["app"] } },
      },
      async ({ input: launchInput }) => pluginInstalledMcpAppLaunchResult(app, launchInput),
    )
  }
}
