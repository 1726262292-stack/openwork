import { Tool, toolError } from "@openwork/codemode"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { Effect } from "effect"
import type { Hono } from "hono"
import { z } from "zod"
import { listUsableExternalMcpConnections, type ExternalMcpConnectionRow } from "../capability-sources/external-mcp-connections.js"
import { listExternalMcpTools } from "../capability-sources/external-mcp-client-runtime.js"
import { createExternalMcpLifecycleDeadline, EXTERNAL_MCP_TOOL_LIFECYCLE_TIMEOUT_MS } from "../capability-sources/external-mcp-client.js"
import { isToolDisabled } from "../capability-sources/external-mcp-tool-policy.js"
import type { McpPrincipal } from "./auth.js"
import type { McpToolOperation } from "./catalog.js"
import {
  buildExternalCapabilityName,
  executeExternalCapability,
  EXTERNAL_MCP_SEARCH_CONCURRENCY,
  EXTERNAL_MCP_SEARCH_CONNECTION_LIMIT,
  type McpMemberIdentity,
} from "./external-capabilities.js"
import { invokeMcpOperation, normalizeToolBody, normalizeToolRecord } from "./invoke.js"

export type CodemodeToolTree = Record<string, Record<string, Tool.Definition>>

export type CodemodeManifestEntry = {
  scriptPath: string
  capabilityName: string
  readOnly?: boolean
  unattendedApproved?: boolean
}

export type BuiltCodemodeTools = {
  tools: CodemodeToolTree
  manifest: CodemodeManifestEntry[]
}

type NamedConnection = { id: string; name: string }

const IDENTIFIER_PATTERN = /^[a-z_$][a-z0-9_$]*$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCodemodeJsonSchema(value: unknown): value is Tool.JsonSchema {
  return isRecord(value)
}

function denInputJsonSchema(operation: McpToolOperation): Tool.JsonSchema {
  const serialized = JSON.stringify(z.toJSONSchema(operation.inputSchema), (key, value: unknown) => key === "~standard" ? undefined : value)
  const schema: unknown = JSON.parse(serialized)
  return isCodemodeJsonSchema(schema) ? schema : {}
}

export function sanitizeNamespaceSegment(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_")
  if (!sanitized) return "_"
  return /^[a-z_]/.test(sanitized) ? sanitized : `_${sanitized}`
}

export function buildExternalNamespaceMap(connections: readonly NamedConnection[]): Map<string, string> {
  const used = new Set(["den", "$codemode", "__proto__", "constructor", "prototype"])
  const namespaces = new Map<string, string>()
  for (const connection of connections) {
    const base = sanitizeNamespaceSegment(connection.name)
    let namespace = base
    let suffix = 2
    while (used.has(namespace)) {
      namespace = `${base}_${suffix}`
      suffix += 1
    }
    used.add(namespace)
    namespaces.set(connection.id, namespace)
  }
  return namespaces
}

export function codemodeScriptPath(namespace: string, toolName: string): string {
  return IDENTIFIER_PATTERN.test(toolName)
    ? `tools.${namespace}.${toolName}`
    : `tools.${namespace}[${JSON.stringify(toolName)}]`
}

export function restrictCodemodeToolTree(input: {
  built: BuiltCodemodeTools
  requiredCapabilities: readonly CodemodeManifestEntry[]
}): { tools: CodemodeToolTree; missing: CodemodeManifestEntry[] } {
  const manifest = new Set(input.built.manifest.map((entry) => `${entry.scriptPath}\n${entry.capabilityName}`))
  const available = new Map<string, { namespace: string; name: string; definition: Tool.Definition }>()
  for (const [namespace, tools] of Object.entries(input.built.tools)) {
    for (const [name, definition] of Object.entries(tools)) {
      available.set(codemodeScriptPath(namespace, name), { namespace, name, definition })
    }
  }

  const namespaceTools = new Map<string, Map<string, Tool.Definition>>()
  const missing: CodemodeManifestEntry[] = []
  for (const required of input.requiredCapabilities) {
    const resolved = available.get(required.scriptPath)
    if (!resolved || !manifest.has(`${required.scriptPath}\n${required.capabilityName}`)) {
      missing.push(required)
      continue
    }
    const tools = namespaceTools.get(resolved.namespace) ?? new Map<string, Tool.Definition>()
    tools.set(resolved.name, resolved.definition)
    namespaceTools.set(resolved.namespace, tools)
  }
  return {
    tools: Object.fromEntries([...namespaceTools].map(([namespace, tools]) => [namespace, Object.fromEntries(tools)])),
    missing,
  }
}

/**
 * Unattended Cloud runs may be retried after a lost lease, so Phase 1 only
 * admits trusted Den reads or external tools an org admin explicitly approved.
 */
export function firstUnattendedUnsafeCapability(
  built: BuiltCodemodeTools,
  requiredCapabilities: readonly CodemodeManifestEntry[],
): CodemodeManifestEntry | null {
  const manifest = new Map(built.manifest.map((entry) => [
    `${entry.scriptPath}\n${entry.capabilityName}`,
    entry,
  ]))
  return requiredCapabilities.find((required) => (
    manifest.get(`${required.scriptPath}\n${required.capabilityName}`)?.readOnly !== true
    || manifest.get(`${required.scriptPath}\n${required.capabilityName}`)?.unattendedApproved !== true
  )) ?? null
}

function textParts(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.content)) return []
  return value.content.flatMap((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])
}

function toolResultValue(value: unknown): unknown {
  if (isRecord(value) && value.structuredContent !== undefined) return value.structuredContent
  const text = textParts(value)
  if (text.length === 0) return null
  if (text.length > 1) return text.join("\n")
  try {
    return JSON.parse(text[0] ?? "")
  } catch {
    return text[0] ?? ""
  }
}

function toolResultError(value: unknown): string {
  const text = textParts(value).join("\n").trim()
  return text || "Capability execution failed."
}

export function buildDenCatalogToolTree(input: {
  app: Hono
  env: unknown
  catalog: readonly McpToolOperation[]
  principal: McpPrincipal
}): BuiltCodemodeTools {
  const definitions = input.catalog.map((operation) => [operation.name, Tool.make({
    description: operation.operation.summary ?? operation.operation.description ?? operation.name,
    input: denInputJsonSchema(operation),
    run: (toolInput) => Effect.promise(() => invokeMcpOperation({
      app: input.app,
      env: input.env,
      operation,
      principal: input.principal,
      toolInput: {
        path: normalizeToolRecord(isRecord(toolInput) ? toolInput.path : undefined),
        query: normalizeToolRecord(isRecord(toolInput) ? toolInput.query : undefined),
        body: normalizeToolBody(isRecord(toolInput) ? toolInput.body : undefined),
      },
    })).pipe(Effect.flatMap((result) => result.isError
      ? Effect.fail(toolError(toolResultError(result)))
      : Effect.succeed(toolResultValue(result)))),
  })] satisfies [string, Tool.Definition])
  return {
    tools: { den: Object.fromEntries(definitions) },
    manifest: input.catalog.map((operation) => ({
      scriptPath: codemodeScriptPath("den", operation.name),
      capabilityName: operation.name,
      readOnly: operation.method === "GET",
      unattendedApproved: operation.method === "GET",
    })),
  }
}

async function mapConcurrent<T, R>(items: readonly T[], limit: number, visit: (item: T) => Promise<R>): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = Array.from({ length: items.length })
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      const item = items[index]
      if (item === undefined) return
      results[index] = await visit(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function externalRedirectUri(redirectUriBase: string, connectionId: string): string {
  return `${redirectUriBase}/v1/mcp-connections/${encodeURIComponent(connectionId)}/connect/callback`
}

type ListedExternalConnection = {
  connection: ExternalMcpConnectionRow
  tools: Awaited<ReturnType<typeof listExternalMcpTools>>
}

function isListedExternalConnection(value: ListedExternalConnection | undefined): value is ListedExternalConnection {
  return value !== undefined
}

export function isCodemodeEligibleConnection(
  connection: Pick<ExternalMcpConnectionRow, "toolPolicy" | "oauthIssuerReviewRequiredAt">,
): boolean {
  return !connection.toolPolicy?.allDisabled && !connection.oauthIssuerReviewRequiredAt
}

export async function buildExternalMcpToolTree(input: {
  organizationId: string
  member: McpMemberIdentity | null
  redirectUriBase: string
}): Promise<BuiltCodemodeTools> {
  if (!input.member) return { tools: {}, manifest: [] }
  const memberIdentity = input.member
  const connections = (await listUsableExternalMcpConnections({
    organizationId: normalizeDenTypeId("organization", input.organizationId),
    orgMembershipId: memberIdentity.orgMembershipId,
    teamIds: memberIdentity.teamIds,
  }))
    .filter(isCodemodeEligibleConnection)
    .slice(0, EXTERNAL_MCP_SEARCH_CONNECTION_LIMIT)
  const deadline = createExternalMcpLifecycleDeadline(EXTERNAL_MCP_TOOL_LIFECYCLE_TIMEOUT_MS)
  const listed = (await mapConcurrent(connections, EXTERNAL_MCP_SEARCH_CONCURRENCY, async (connection) => {
    try {
      const member = connection.credentialMode === "per_member"
        ? { orgMembershipId: memberIdentity.orgMembershipId }
        : undefined
      const tools = await listExternalMcpTools(
        connection,
        externalRedirectUri(input.redirectUriBase, connection.id),
        member,
        undefined,
        deadline,
      )
      return { connection, tools }
    } catch {
      return undefined
    }
  })).filter(isListedExternalConnection)
  const namespaces = buildExternalNamespaceMap(connections)
  const namespaceEntries = listed.flatMap(({ connection, tools }) => {
    const namespace = namespaces.get(connection.id)
    if (!namespace) return []
    const enabledTools = tools.filter((tool) => !isToolDisabled(connection.toolPolicy, tool.name))
    const definitions = enabledTools.map((tool) => [tool.name, Tool.make({
      description: tool.description ?? tool.title ?? tool.name,
      input: tool.inputSchema,
      run: (args) => Effect.promise(() => executeExternalCapability({
        organizationId: input.organizationId,
        member: memberIdentity,
        connectionId: connection.id,
        toolName: tool.name,
        args,
        redirectUriBase: input.redirectUriBase,
      })).pipe(Effect.flatMap((result) => result.ok
        ? Effect.succeed(toolResultValue(result.result))
        : Effect.fail(toolError(result.message)))),
    })] satisfies [string, Tool.Definition])
    return [[namespace, Object.fromEntries(definitions)] satisfies [string, Record<string, Tool.Definition>]]
  })
  return {
    tools: Object.fromEntries(namespaceEntries),
    manifest: listed.flatMap(({ connection, tools }) => {
      const namespace = namespaces.get(connection.id)
      if (!namespace) return []
      return tools
        .filter((tool) => !isToolDisabled(connection.toolPolicy, tool.name))
        .map((tool) => ({
          scriptPath: codemodeScriptPath(namespace, tool.name),
          capabilityName: buildExternalCapabilityName(connection.id, tool.name),
          readOnly: tool.annotations?.readOnlyHint === true,
          unattendedApproved: tool.annotations?.readOnlyHint === true
            && connection.toolPolicy?.unattendedApprovedTools?.includes(tool.name) === true,
        }))
    }),
  }
}

export async function buildCodemodeToolTree(input: {
  app: Hono
  env: unknown
  catalog: readonly McpToolOperation[]
  principal: McpPrincipal
  organizationId: string
  member: McpMemberIdentity | null
  redirectUriBase: string
}): Promise<BuiltCodemodeTools> {
  const den = buildDenCatalogToolTree(input)
  const external = await buildExternalMcpToolTree(input)
  return {
    tools: { ...den.tools, ...external.tools },
    manifest: [...den.manifest, ...external.manifest],
  }
}
