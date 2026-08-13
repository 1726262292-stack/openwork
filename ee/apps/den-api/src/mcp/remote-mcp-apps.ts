import { createHash } from "node:crypto"
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server"
import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { listActiveRemoteMcpApps } from "../remote-mcp-apps.js"
import { executeExternalCapability } from "./external-capabilities.js"
import { externalToolContent } from "./tool-content.js"

type ActiveRemoteMcpApp = Awaited<ReturnType<typeof listActiveRemoteMcpApps>>[number]

const launchOutputSchema = z.object({
  schemaVersion: z.literal("openwork.remote-mcp-app-launch/1"),
  app: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    revisionId: z.string(),
    resourceDigest: z.string(),
  }),
  capabilities: z.array(z.object({
    key: z.string(),
    title: z.string(),
    description: z.string().optional(),
    toolName: z.string().optional(),
    argumentsField: z.literal("arguments").optional(),
    bound: z.boolean(),
  })),
  input: z.unknown().optional(),
})

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function stableSuffix(value: string, length = 12) {
  return createHash("sha256").update(value).digest("hex").slice(0, length)
}

export function remoteMcpAppLaunchToolName(configObjectId: string) {
  return `launch_remote_app_${stableSuffix(configObjectId)}`
}

export function remoteMcpAppCapabilityToolName(configObjectId: string, capabilityKey: string) {
  return `remote_app_${stableSuffix(configObjectId, 10)}_${stableSuffix(capabilityKey, 10)}`
}

function resourceMeta(revision: Pick<ActiveRemoteMcpApp, "payload">): { ui: McpUiResourceMeta; resourceDigest: string } {
  return {
    ui: { csp: revision.payload.resource.csp, prefersBorder: true },
    resourceDigest: revision.payload.resource.digest,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function providerStructuredContent(value: unknown) {
  return isRecord(value) && value.structuredContent !== undefined ? value.structuredContent : null
}

function textFallbackParts(content: ReturnType<typeof externalToolContent>) {
  return content.flatMap((part) => part.type === "text" ? [part.text] : [])
}

export function registerAgentRemoteMcpApps(input: {
  server: McpServer
  apps: ActiveRemoteMcpApp[]
  organizationId: string
  member: Parameters<typeof executeExternalCapability>[0]["member"]
  redirectUriBase: string
  loadResource: (request: { configObjectId: string; versionId: string }) => Promise<{
    html: string
    payload: ActiveRemoteMcpApp["payload"]
  }>
}) {
  for (const app of input.apps) {
    const manifest = app.payload.manifest
    for (const revision of app.revisions) {
      const metadata = resourceMeta(revision)
      registerAppResource(
        input.server,
        `Remote MCP App ${app.app.configObjectId} ${revision.versionId}`,
        revision.resourceUri,
        {
          title: `${revision.payload.manifest.name} ${revision.payload.manifest.version}`,
          description: "An immutable, self-contained Remote MCP App cached by OpenWork.",
          _meta: metadata,
        },
        async () => {
          const loaded = await input.loadResource({
            configObjectId: app.app.configObjectId,
            versionId: revision.versionId,
          })
          if (loaded.payload.resource.digest !== revision.payload.resource.digest
            || digest(loaded.html) !== revision.payload.resource.digest) {
            throw new Error("remote_mcp_app_resource_digest_mismatch")
          }
          return {
            contents: [{
              uri: revision.resourceUri,
              mimeType: RESOURCE_MIME_TYPE,
              text: loaded.html,
              _meta: metadata,
            }],
          }
        },
      )
    }

    const bindings = new Map(app.bindings.map((binding) => [binding.serverName, binding]))
    const capabilities = manifest.capabilities.map((capability) => {
      const binding = bindings.get(capability.key)
      return {
        key: capability.key,
        title: capability.title ?? capability.key,
        ...(capability.description ? { description: capability.description } : {}),
        ...(binding ? {
          toolName: remoteMcpAppCapabilityToolName(app.app.configObjectId, capability.key),
          argumentsField: "arguments" as const,
        } : {}),
        bound: Boolean(binding),
      }
    })

    registerAppTool(
      input.server,
      remoteMcpAppLaunchToolName(app.app.configObjectId),
      {
        title: manifest.launchTool?.title ?? manifest.name,
        description: manifest.launchTool?.description ?? manifest.description ?? `Open ${manifest.name}.`,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: z.object({ input: z.unknown().optional() }),
        outputSchema: launchOutputSchema,
        _meta: { ui: { resourceUri: app.resourceUri, visibility: ["model", "app"] } },
      },
      async ({ input: launchInput }) => {
        const structuredContent = {
          schemaVersion: "openwork.remote-mcp-app-launch/1" as const,
          app: {
            id: app.app.configObjectId,
            name: manifest.name,
            version: manifest.version,
            revisionId: app.versionId,
            resourceDigest: app.payload.resource.digest,
          },
          capabilities,
          ...(launchInput === undefined ? {} : { input: launchInput }),
        }
        return {
          content: [{ type: "text" as const, text: `Opened ${manifest.name} ${manifest.version}.` }],
          structuredContent,
          _meta: {
            remoteMcpAppId: app.app.configObjectId,
            remoteMcpAppRevisionId: app.versionId,
            resourceDigest: app.payload.resource.digest,
          },
        }
      },
    )

    for (const capability of manifest.capabilities) {
      const binding = bindings.get(capability.key)
      if (!binding) continue
      registerAppTool(
        input.server,
        remoteMcpAppCapabilityToolName(app.app.configObjectId, capability.key),
        {
          title: capability.title ?? capability.key,
          description: capability.description ?? `Use the bound read-only ${capability.toolName} Connect capability.`,
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
          inputSchema: z.object({ arguments: z.record(z.string(), z.unknown()).default({}) }),
          _meta: { ui: { visibility: ["app"] } },
        },
        async ({ arguments: args }) => {
          const result = await executeExternalCapability({
            organizationId: input.organizationId,
            member: input.member,
            connectionId: binding.externalMcpConnectionId,
            toolName: capability.toolName,
            args,
            schemaDigest: capability.schemaDigest,
            redirectUriBase: input.redirectUriBase,
            requireReadOnly: true,
            requireSchemaMatch: true,
          })
          if (!result.ok) {
            const payload = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "ok"))
            return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(payload) }] }
          }
          const content = externalToolContent(result.result)
          return {
            content,
            structuredContent: {
              schemaVersion: "openwork.remote-mcp-app-capability-result/1",
              capability: { key: capability.key, toolName: capability.toolName },
              data: providerStructuredContent(result.result),
              text: textFallbackParts(content),
              ...(result.schemaGuidance ? { schemaGuidance: result.schemaGuidance } : {}),
            },
          }
        },
      )
    }
  }
}
