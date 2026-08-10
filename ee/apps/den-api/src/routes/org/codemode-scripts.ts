import type { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"
import { saveCodemodeScript } from "../../codemode-scripts.js"
import { orgMemberRoute, jsonValidator } from "../../middleware/index.js"
import { invalidRequestSchema, jsonResponse, unauthorizedSchema } from "../../openapi.js"
import { listTeamsForMember } from "../../orgs.js"
import { env } from "../../env.js"
import { getCatalog } from "../../mcp/index.js"
import { buildCodemodeToolTree } from "../../mcp/codemode-tools.js"
import {
  executeMarketplaceCapability,
  listAccessibleSavedCodemodeScripts,
} from "../../mcp/marketplace-capabilities.js"
import { DEN_MCP_REQUESTED_SCOPES } from "../../mcp/scopes.js"
import { codemodeScriptsEnabled } from "../../capability-sources/codemode-rollout.js"
import type { OrgRouteVariables } from "./shared.js"

const capabilitySchema = z.object({ capabilityName: z.string(), scriptPath: z.string() })
const scriptSchema = z.object({
  pluginId: z.string(),
  configObjectId: z.string(),
  configObjectVersionId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  inputSchema: z.unknown().nullable(),
  outputSchema: z.unknown().nullable(),
  requiredCapabilities: z.array(capabilitySchema),
})
const listSchema = z.object({ items: z.array(scriptSchema) })
const saveSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(4_000).optional(),
  code: z.string().min(1).max(200_000),
  currentInput: z.unknown().optional(),
  inputSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
})
const savedSchema = z.object({ pluginId: z.string(), configObjectId: z.string(), configObjectVersionId: z.string() })
const runParamsSchema = z.object({ configObjectId: z.string().min(1).max(160) })
const runSchema = z.object({
  pluginId: z.string().min(1).max(160),
  configObjectVersionId: z.string().min(1).max(160),
  input: z.unknown().optional(),
})
const runResultSchema = z.object({
  status: z.literal("succeeded"),
  value: z.unknown(),
  markdown: z.string(),
  receiptId: z.string().nullable(),
})

export function registerOrgCodemodeScriptRoutes<T extends { Variables: OrgRouteVariables }>(app: Hono<T>) {
  const contextFor = async (c: { get(name: "organizationContext"): OrgRouteVariables["organizationContext"]; env: unknown }) => {
    const context = c.get("organizationContext")
    if (!context) throw new Error("organization_context_required")
    const teams = await listTeamsForMember({ organizationId: context.organization.id, memberId: context.currentMember.id })
    const member = { orgMembershipId: context.currentMember.id, teamIds: teams.map((team) => team.id) }
    const catalog = await getCatalog(app as unknown as Hono, c.env)
    const principal = {
      userId: context.currentMember.userId,
      organizationId: context.organization.id,
      scopes: new Set(DEN_MCP_REQUESTED_SCOPES),
      payload: {},
    }
    const buildTools = () => buildCodemodeToolTree({
      app: app as unknown as Hono,
      env: c.env,
      catalog,
      principal,
      organizationId: context.organization.id,
      member,
      redirectUriBase: env.apiPublicUrl ?? "http://127.0.0.1",
    })
    return { context, member, buildTools, codemodeEnabled: codemodeScriptsEnabled(context.organization.metadata) }
  }

  app.get(
    "/v1/codemode-scripts",
    describeRoute({
      tags: ["Codemode Runs"], summary: "List accessible saved Code Mode scripts",
      responses: { 200: jsonResponse("Saved scripts returned.", listSchema), 401: jsonResponse("Sign-in required.", unauthorizedSchema) },
    }),
    orgMemberRoute(),
    async (c) => {
      const { context, member, codemodeEnabled } = await contextFor(c)
      if (!codemodeEnabled) return c.json({ items: [] })
      return c.json({ items: await listAccessibleSavedCodemodeScripts({ organizationId: context.organization.id, member }) })
    },
  )

  app.post(
    "/v1/codemode-scripts",
    describeRoute({
      tags: ["Codemode Runs"], summary: "Save a successful Code Mode run as a reusable script",
      responses: { 201: jsonResponse("Script saved.", savedSchema), 400: jsonResponse("Invalid request.", invalidRequestSchema) },
    }),
    orgMemberRoute(), jsonValidator(saveSchema),
    async (c) => {
      try {
        const { context, buildTools, codemodeEnabled } = await contextFor(c)
        if (!codemodeEnabled) throw new Error("codemode_scripts_disabled")
        const saved = await saveCodemodeScript({
          organizationId: context.organization.id,
          ownerMemberId: context.currentMember.id,
          script: c.req.valid("json"),
          buildTools,
        })
        return c.json(saved, 201)
      } catch (error) {
        return c.json({ error: "saved_script_rejected", message: error instanceof Error ? error.message : "Script could not be saved." }, 400)
      }
    },
  )

  app.post(
    "/v1/codemode-scripts/:configObjectId/run",
    describeRoute({
      tags: ["Codemode Runs"], summary: "Run an exact saved Code Mode script version",
      responses: { 200: jsonResponse("Script executed.", runResultSchema), 400: jsonResponse("Execution rejected.", invalidRequestSchema) },
    }),
    orgMemberRoute(), jsonValidator(runSchema),
    async (c) => {
      const params = runParamsSchema.safeParse(c.req.param())
      if (!params.success) return c.json({ error: "invalid_request", message: "Invalid script id." }, 400)
      const { context, member, buildTools, codemodeEnabled } = await contextFor(c)
      const body = c.req.valid("json")
      const result = await executeMarketplaceCapability({
        organizationId: context.organization.id,
        member,
        pluginId: body.pluginId,
        configObjectId: params.data.configObjectId,
        configObjectVersionId: body.configObjectVersionId,
        body: body.input,
        codemodeEnabled,
        buildTools,
      })
      if (!result.ok) return c.json({ error: result.error, message: result.message }, 400)
      if (result.result.status !== "executed") {
        return c.json({ error: "script_not_executable", message: result.result.hint ?? "Script could not execute." }, 400)
      }
      const canonical = result.result.canonicalResult ?? JSON.stringify(result.result.value)
      return c.json({
        status: "succeeded" as const,
        value: result.result.value,
        markdown: `\`\`\`json\n${canonical}\n\`\`\``,
        receiptId: result.result.receiptId ?? null,
      })
    },
  )
}
