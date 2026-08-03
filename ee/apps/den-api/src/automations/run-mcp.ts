import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPTransport } from "@hono/mcp"
import type { Hono } from "hono"
import type { RequestIdVariables } from "hono/request-id"
import { z } from "zod"
import { eq } from "@openwork-ee/den-db/drizzle"
import { OrganizationTable } from "@openwork-ee/den-db/schema"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "../db.js"
import { env } from "../env.js"
import { tokenRoute } from "../middleware/index.js"
import { resolvePublicOrigin } from "../capability-sources/generic-oauth.js"
import { getCatalog } from "../mcp/index.js"
import {
  EXECUTE_CAPABILITY_ANNOTATIONS,
  SEARCH_CAPABILITIES_ANNOTATIONS,
  SEARCH_CAPABILITIES_OUTPUT_SCHEMA,
  capabilitySearchToolResult,
  executeCapabilityWithBudget,
  externalCapabilityErrorToolResult,
  externalCapabilitySuccessToolResult,
} from "../mcp/agent.js"
import {
  executeExternalCapability,
  parseExternalCapabilityName,
  resolveMcpMemberIdentity,
  searchExternalCapabilities,
} from "../mcp/external-capabilities.js"
import { executeNativeCapability, searchNativeCapabilities } from "../mcp/native-capabilities.js"
import { compareCapabilityMatches } from "../mcp/search.js"
import { normalizeToolBody, normalizeToolRecord } from "../mcp/invoke.js"
import { memberFacingMcpConnectionsEnabled } from "../capability-sources/external-mcp-rollout.js"
import {
  filterAutomationRunCapabilities,
  isAutomationRunCapabilityNameAllowed,
} from "./run-capabilities.js"
import { verifyAutomationRunToken } from "./security.js"

const text = (value: string) => [{ type: "text" as const, text: value }]

export function registerAutomationRunMcpRoutes<T extends { Variables: RequestIdVariables & Record<string, unknown> }>(app: Hono<T>) {
  app.all("/mcp/automation-runs/:runId", tokenRoute, async (c) => {
    const principal = await verifyAutomationRunToken({
      runId: c.req.param("runId"),
      authorization: c.req.header("authorization"),
    })
    if (!principal) return c.json({ error: "invalid_or_expired_automation_run_token" }, 401)

    const member = await resolveMcpMemberIdentity({
      userId: principal.ownerUserId,
      organizationId: principal.organizationId,
    })
    if (!member || member.orgMembershipId !== principal.ownerMemberId) {
      return c.json({ error: "automation_owner_membership_lost" }, 403)
    }
    const organizationId = normalizeDenTypeId("organization", principal.organizationId)
    const organizations = await db.select({ metadata: OrganizationTable.metadata }).from(OrganizationTable)
      .where(eq(OrganizationTable.id, organizationId)).limit(1)
    const externalEnabled = memberFacingMcpConnectionsEnabled(organizations[0]?.metadata, {
      gatingEnabled: env.mcpConnectionsGatingEnabled,
    })
    const catalog = await getCatalog(app as unknown as Hono, c.env)
    const mcpPrincipal = {
      userId: principal.ownerUserId,
      organizationId: principal.organizationId,
      scopes: new Set(["mcp:read", "mcp:write"]),
      payload: { automationRunId: principal.runId },
    }
    const server = new McpServer({ name: "openwork-den-automation-run", version: "1.0.0" }, {
      instructions: [
        "This run-scoped connection exposes only search_capabilities and execute_capability.",
        "It uses the Automation owner's current OpenWork Connect access, including read and write operations permitted by each connection.",
        "Automation-management capabilities, local files, shell, terminal, browser, and computer tools are unavailable.",
      ].join(" "),
    })

    server.registerTool("search_capabilities", {
      title: "Search current Connect capabilities",
      description: "Search the Automation owner's current native and external OpenWork Connect capabilities. Automation-management operations are excluded.",
      annotations: SEARCH_CAPABILITIES_ANNOTATIONS,
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(20).optional(),
        type: z.enum(["all", "api", "mcp"]).optional(),
      }),
      outputSchema: SEARCH_CAPABILITIES_OUTPUT_SCHEMA,
    }, async ({ query, limit, type }) => {
      const bounded = limit ?? 5
      const native = type === "mcp" ? [] : await searchNativeCapabilities({
        organizationId,
        member,
        query,
        catalog,
        limit: bounded,
      })
      const external = type === "api" || !externalEnabled ? [] : await searchExternalCapabilities({
        organizationId: principal.organizationId,
        member,
        query,
        redirectUriBase: resolvePublicOrigin(c.req.raw, env.apiPublicUrl),
        limit: bounded,
      })
      const matches = filterAutomationRunCapabilities([...native, ...external])
        .sort(compareCapabilityMatches)
        .slice(0, bounded)
      return capabilitySearchToolResult(matches)
    })

    server.registerTool("execute_capability", {
      title: "Execute current Connect capability",
      description: "Execute an exact native or external capability returned by search_capabilities. Automation-management operations are never accepted.",
      annotations: EXECUTE_CAPABILITY_ANNOTATIONS,
      inputSchema: z.object({
        name: z.string().min(1),
        schemaDigest: z.string().optional(),
        path: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
        query: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
        body: z.unknown().optional(),
      }),
    }, async ({ name, schemaDigest, path, query, body }) => executeCapabilityWithBudget({
      capability: name,
      invoke: async () => {
        if (!isAutomationRunCapabilityNameAllowed(name)) {
          return {
            isError: true,
            content: text(JSON.stringify({
              error: "capability_not_allowed",
              message: "Automation runs may execute only current OpenWork Connect integration capabilities.",
            })),
          }
        }
        const external = parseExternalCapabilityName(name)
        if (external) {
          const result = await executeExternalCapability({
            organizationId: principal.organizationId,
            member,
            connectionId: external.connectionId,
            toolName: external.toolName,
            args: normalizeToolBody(body),
            schemaDigest,
            redirectUriBase: resolvePublicOrigin(c.req.raw, env.apiPublicUrl),
          })
          return result.ok ? externalCapabilitySuccessToolResult(result) : externalCapabilityErrorToolResult(result)
        }
        const native = await executeNativeCapability({
          app: app as unknown as Hono,
          env: c.env,
          name,
          organizationId,
          member,
          catalog,
          principal: mcpPrincipal,
          path: normalizeToolRecord(path),
          query: normalizeToolRecord(query),
          body: normalizeToolBody(body),
        })
        return native ?? { isError: true, content: text(JSON.stringify({ error: "unknown_capability" })) }
      },
    }))

    const transport = new StreamableHTTPTransport()
    await server.connect(transport)
    const response = await transport.handleRequest(c)
    return response ?? new Response(null, { status: 204 })
  })
}
