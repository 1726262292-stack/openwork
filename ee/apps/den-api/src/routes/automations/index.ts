import type { Hono } from "hono"
import { describeRoute, type DescribeRouteOptions } from "hono-openapi"
import { z } from "zod"
import {
  automationDetailSchema,
  automationListSchema,
  automationRunReceiptSchema,
  automationRunSchema,
  createAutomationSchema,
  updateAutomationSchema,
} from "@openwork/types/automations"
import { env } from "../../env.js"
import {
  jsonValidator,
  orgMemberRoute,
  paramValidator,
  queryValidator,
  type OrganizationContextVariables,
} from "../../middleware/index.js"
import { invalidRequestSchema, jsonResponse, notFoundSchema, unauthorizedSchema } from "../../openapi.js"
import { automationService, type AutomationService } from "../../automations/service.js"

const idParamsSchema = z.object({ id: z.string().min(1).max(160) })
const automationRunParamsSchema = z.object({ id: z.string().min(1).max(160) })
const paginationSchema = z.object({
  cursor: z.string().min(1).max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
const runListSchema = z.object({ items: z.array(automationRunSchema), nextCursor: z.string().nullable() })
const runResponseSchema = z.object({ run: automationRunSchema })

type McpDescribeRouteOptions = DescribeRouteOptions & { "x-mcp": true }
const describeMcpRoute = (options: McpDescribeRouteOptions) => describeRoute(options)

type RouteVariables = Partial<OrganizationContextVariables>

function scope(c: { get(name: "organizationContext"): OrganizationContextVariables["organizationContext"] }) {
  const context = c.get("organizationContext")
  return { organizationId: context.organization.id, ownerMemberId: context.currentMember.id }
}

function failure(error: unknown): { status: 400 | 403 | 404 | 409; body: { error: string; message?: string } } | null {
  if (!(error instanceof Error)) return null
  if (error.message === "automation_not_found") return { status: 404, body: { error: "automation_not_found" } }
  if (["owner_membership_lost", "model_access_lost", "provider_unavailable"].includes(error.name)) {
    return { status: 409, body: { error: error.name, message: error.message } }
  }
  return null
}

const routeDescription = [
  "Automations run remotely on Den; the user's computer does not need to remain online.",
  "Creation makes an Automation active immediately and uses the owner's current OpenWork Connect integrations.",
  "Deactivation stops future runs but does not cancel a run already in progress.",
].join(" ")

export function registerAutomationRoutes<T extends { Variables: RouteVariables }>(
  app: Hono<T>,
  options: { service?: AutomationService; enabled?: boolean } = {},
) {
  if (!(options.enabled ?? env.automations.enabled)) return
  const service = options.service ?? automationService

  app.get(
    "/v1/automations",
    describeMcpRoute({
      tags: ["Automations"], operationId: "listAutomations", "x-mcp": true,
      summary: "List Automations", description: routeDescription,
      responses: { 200: jsonResponse("Automations returned.", automationListSchema), 401: jsonResponse("Sign-in required.", unauthorizedSchema) },
    }),
    orgMemberRoute(), queryValidator(paginationSchema),
    async (c) => c.json(await service.list(scope(c), c.req.valid("query"))),
  )

  app.post(
    "/v1/automations",
    describeMcpRoute({
      tags: ["Automations"], operationId: "createAutomation", "x-mcp": true,
      summary: "Create an active Automation",
      description: `${routeDescription} There is no draft, review, or permission-grant step.`,
      responses: {
        201: jsonResponse("Active Automation created.", automationDetailSchema),
        400: jsonResponse("Invalid request.", invalidRequestSchema),
        401: jsonResponse("Sign-in required.", unauthorizedSchema),
      },
    }),
    orgMemberRoute(), jsonValidator(createAutomationSchema),
    async (c) => {
      try {
        return c.json(await service.create(scope(c), c.req.valid("json")), 201)
      } catch (error) {
        const mapped = failure(error)
        if (mapped) return c.json(mapped.body, mapped.status)
        throw error
      }
    },
  )

  app.get(
    "/v1/automations/:id",
    describeMcpRoute({
      tags: ["Automations"], operationId: "getAutomation", "x-mcp": true,
      summary: "Get an Automation", description: routeDescription,
      responses: { 200: jsonResponse("Automation returned.", automationDetailSchema), 404: jsonResponse("Not found.", notFoundSchema) },
    }),
    orgMemberRoute(), paramValidator(idParamsSchema),
    async (c) => {
      const item = await service.get(scope(c), c.req.valid("param").id)
      return item ? c.json(item) : c.json({ error: "automation_not_found" }, 404)
    },
  )

  app.patch(
    "/v1/automations/:id",
    describeMcpRoute({
      tags: ["Automations"], operationId: "updateAutomation", "x-mcp": true,
      summary: "Update an Automation",
      description: `${routeDescription} Every behavior-changing edit creates an immutable revision and applies it to future runs immediately.`,
      responses: { 200: jsonResponse("Automation updated.", automationDetailSchema), 400: jsonResponse("Invalid request.", invalidRequestSchema) },
    }),
    orgMemberRoute(), paramValidator(idParamsSchema), jsonValidator(updateAutomationSchema),
    async (c) => {
      try {
        const item = await service.update(scope(c), c.req.valid("param").id, c.req.valid("json"))
        return item ? c.json(item) : c.json({ error: "automation_not_found" }, 404)
      } catch (error) {
        const mapped = failure(error)
        if (mapped) return c.json(mapped.body, mapped.status)
        throw error
      }
    },
  )

  const stateRoute = (
    path: "/v1/automations/:id/activate" | "/v1/automations/:id/deactivate",
    operationId: "activateAutomation" | "deactivateAutomation",
    action: "activate" | "deactivate",
  ) => app.post(
    path,
    describeMcpRoute({
      tags: ["Automations"], operationId, "x-mcp": true,
      summary: action === "activate" ? "Activate an Automation" : "Deactivate an Automation",
      description: routeDescription,
      responses: { 200: jsonResponse("Automation state returned.", automationDetailSchema), 404: jsonResponse("Not found.", notFoundSchema) },
    }),
    orgMemberRoute(), paramValidator(idParamsSchema),
    async (c) => {
      try {
        const id = c.req.valid("param").id
        const item = action === "activate" ? await service.activate(scope(c), id) : await service.deactivate(scope(c), id)
        return item ? c.json(item) : c.json({ error: "automation_not_found" }, 404)
      } catch (error) {
        const mapped = failure(error)
        if (mapped) return c.json(mapped.body, mapped.status)
        throw error
      }
    },
  )
  stateRoute("/v1/automations/:id/activate", "activateAutomation", "activate")
  stateRoute("/v1/automations/:id/deactivate", "deactivateAutomation", "deactivate")

  app.post(
    "/v1/automations/:id/run",
    describeMcpRoute({
      tags: ["Automations"], operationId: "runAutomationNow", "x-mcp": true,
      summary: "Run an Automation now", description: routeDescription,
      responses: { 202: jsonResponse("Run queued.", runResponseSchema), 404: jsonResponse("Not found.", notFoundSchema) },
    }),
    orgMemberRoute(), paramValidator(idParamsSchema),
    async (c) => {
      const run = await service.runNow(scope(c), c.req.valid("param").id)
      return run ? c.json({ run }, 202) : c.json({ error: "automation_not_found" }, 404)
    },
  )

  app.get(
    "/v1/automations/:id/runs",
    describeMcpRoute({
      tags: ["Automations"], operationId: "listAutomationRuns", "x-mcp": true,
      summary: "List Automation runs", description: routeDescription,
      responses: { 200: jsonResponse("Run history returned.", runListSchema) },
    }),
    orgMemberRoute(), paramValidator(idParamsSchema), queryValidator(paginationSchema),
    async (c) => c.json(await service.listRuns(scope(c), c.req.valid("param").id, c.req.valid("query"))),
  )

  app.get(
    "/v1/automation-runs/:id",
    describeMcpRoute({
      tags: ["Automations"], operationId: "getAutomationRun", "x-mcp": true,
      summary: "Inspect an Automation run receipt and remote thread", description: routeDescription,
      responses: { 200: jsonResponse("Durable run receipt returned.", automationRunReceiptSchema), 404: jsonResponse("Not found.", notFoundSchema) },
    }),
    orgMemberRoute(), paramValidator(automationRunParamsSchema),
    async (c) => {
      const receipt = await service.getRun(scope(c), c.req.valid("param").id)
      return receipt ? c.json(receipt) : c.json({ error: "automation_run_not_found" }, 404)
    },
  )

  app.post(
    "/v1/automation-runs/:id/cancel",
    describeMcpRoute({
      tags: ["Automations"], operationId: "cancelAutomationRun", "x-mcp": true,
      summary: "Cancel an active Automation run", description: routeDescription,
      responses: { 200: jsonResponse("Cancellation requested.", runResponseSchema), 404: jsonResponse("Not found.", notFoundSchema) },
    }),
    orgMemberRoute(), paramValidator(automationRunParamsSchema),
    async (c) => {
      const run = await service.cancelRun(scope(c), c.req.valid("param").id)
      return run ? c.json({ run }) : c.json({ error: "automation_run_not_found" }, 404)
    },
  )

  app.delete(
    "/v1/automations/:id",
    describeMcpRoute({
      tags: ["Automations"], operationId: "archiveAutomation", "x-mcp": true,
      summary: "Archive an Automation", description: `${routeDescription} Durable run history is retained.`,
      responses: { 200: jsonResponse("Automation archived.", automationDetailSchema), 404: jsonResponse("Not found.", notFoundSchema) },
    }),
    orgMemberRoute(), paramValidator(idParamsSchema),
    async (c) => {
      const item = await service.archive(scope(c), c.req.valid("param").id)
      return item ? c.json(item) : c.json({ error: "automation_not_found" }, 404)
    },
  )
}
