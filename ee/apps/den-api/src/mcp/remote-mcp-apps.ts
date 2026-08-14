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

type ActiveRemoteMcpApp = Awaited<ReturnType<typeof listActiveRemoteMcpApps>>[number]

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function stableSuffix(value: string, length = 12) {
  return createHash("sha256").update(value).digest("hex").slice(0, length)
}

export function remoteMcpAppLaunchToolName(configObjectId: string) {
  return `launch_remote_app_${stableSuffix(configObjectId)}`
}

export function remoteMcpAppRunProgramToolName(configObjectId: string) {
  return `run_program_${stableSuffix(configObjectId)}`
}

function resourceMeta(revision: Pick<ActiveRemoteMcpApp, "payload">): { ui: McpUiResourceMeta; resourceDigest: string } {
  return {
    ui: { csp: revision.payload.resource.csp, prefersBorder: true },
    resourceDigest: revision.payload.resource.digest,
  }
}

export function registerAgentRemoteMcpApps(input: {
  server: McpServer
  apps: ActiveRemoteMcpApp[]
  loadResource: (request: { configObjectId: string; versionId: string }) => Promise<{
    html: string
    payload: ActiveRemoteMcpApp["payload"]
  }>
  runProgram?: (request: {
    appConfigObjectId: string
    pluginId: string
    programId?: string
    input?: unknown
  }) => Promise<{
    content: Array<{ type: "text"; text: string }>
    structuredContent?: Record<string, unknown>
    isError?: boolean
  }>
}) {
  const runProgram = input.runProgram
  for (const app of input.apps) {
    const metadata = app.payload.metadata
    const runProgramToolName = remoteMcpAppRunProgramToolName(app.app.configObjectId)
    if (runProgram) {
      registerAppTool(
        input.server,
        runProgramToolName,
        {
          title: `Run ${metadata.name} Program`,
          description: [
            `Run a Code Mode Program inside the ${metadata.name} Plugin through OpenWork Connect.`,
            "Omit programId to use the member's selected Program, or pass an exact accessible Program id from this Plugin.",
            "This app-only tool stays on the same MCP server as the imported UI resource; the Program owns all downstream Connect capability calls.",
          ].join(" "),
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
          inputSchema: z.object({
            programId: z.string().trim().min(1).max(160).optional(),
            input: z.unknown().optional(),
          }),
          _meta: { ui: { visibility: ["app"] } },
        },
        async ({ programId, input: programInput }) => runProgram({
          appConfigObjectId: app.app.configObjectId,
          pluginId: app.app.pluginId,
          ...(programId ? { programId } : {}),
          ...(programInput === undefined ? {} : { input: programInput }),
        }),
      )
    }
    for (const revision of app.revisions) {
      const metadata = resourceMeta(revision)
      registerAppResource(
        input.server,
        `Remote MCP App ${app.app.configObjectId} ${revision.versionId}`,
        revision.resourceUri,
        {
          title: `${revision.payload.metadata.name} ${revision.payload.metadata.version}`,
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

    registerAppTool(
      input.server,
      remoteMcpAppLaunchToolName(app.app.configObjectId),
      {
        title: metadata.launchTool?.title ?? metadata.name,
        description: metadata.launchTool?.description ?? metadata.description ?? `Open ${metadata.name}.`,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: z.object({ input: z.unknown().optional() }),
        _meta: { ui: { resourceUri: app.resourceUri, visibility: ["model", "app"] } },
      },
      async ({ input: launchInput }) => {
        const structuredContent = {
          app: {
            id: app.app.configObjectId,
            name: metadata.name,
            version: metadata.version,
            revisionId: app.versionId,
            resourceDigest: app.payload.resource.digest,
          },
          ...(input.runProgram ? {
            serverTools: { runProgram: runProgramToolName },
          } : {}),
          ...(launchInput === undefined ? {} : { input: launchInput }),
        }
        return {
          content: [{ type: "text" as const, text: `Opened ${metadata.name} ${metadata.version}.` }],
          structuredContent,
        }
      },
    )
  }
}
