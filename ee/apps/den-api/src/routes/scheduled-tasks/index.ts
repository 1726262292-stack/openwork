import {
  scheduledTaskDefinitionSchema,
  reviewScheduledTaskGrantSchema,
} from "@openwork/scheduled-tasks"
import {
  scheduledTaskWorkerCompletionRequestSchema,
  scheduledTaskWorkerEventRequestSchema,
  scheduledTaskWorkerHeartbeatRequestSchema,
} from "@openwork/scheduled-tasks-den"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import type { Hono, MiddlewareHandler } from "hono"
import { z } from "zod"
import { env } from "../../env.js"
import {
  orgMemberRoute,
  signedWebhookRoute,
  tokenRoute,
  type OrganizationContextVariables,
} from "../../middleware/index.js"
import type { WorkerRouteVariables } from "../workers/shared.js"
import { readBearerToken } from "../workers/shared.js"
import {
  createDenScheduledTaskService,
  DenScheduledTaskServiceError,
  type DenScheduledTaskService,
} from "../../scheduled-tasks/service.js"
import {
  authenticateDenScheduledTaskWorker,
  databaseDenScheduledTaskTickReplayStore,
  verifyDenScheduledTaskTickSignature,
  type DenScheduledTaskTickReplayStore,
} from "../../scheduled-tasks/security.js"
import { DenScheduledTaskRepositoryError } from "../../scheduled-tasks/repository.js"

const tickSchema = z.object({
  now: z.number().int().nonnegative(),
  source: z.enum(["vercel-cron", "den-loop"]),
  batchSize: z.number().int().min(1).max(500).optional(),
  scope: z.object({
    kind: z.literal("scheduler-owner"),
    schedulerOwner: z.literal("den"),
  }).optional(),
})

type AuthenticateWorker = typeof authenticateDenScheduledTaskWorker

export interface DenScheduledTaskRouteDependencies {
  service: DenScheduledTaskService
  authenticateWorker: AuthenticateWorker
  replayStore: DenScheduledTaskTickReplayStore
  internalSecret: string | undefined
  now(): number
  orgMemberRoute: MiddlewareHandler
}

function routeError(error: unknown) {
  if (error instanceof DenScheduledTaskRepositoryError) {
    if (error.code === "attempt_not_found") return { status: 404, error: error.code }
    if (error.code === "conflicting_replay") return { status: 409, error: error.code }
    return { status: 409, error: error.code }
  }
  if (error instanceof DenScheduledTaskServiceError) {
    if (error.code === "not_found") return { status: 404, error: error.code }
    return { status: 409, error: error.code }
  }
  throw error
}

export function registerScheduledTaskRoutes<T extends {
  Variables: WorkerRouteVariables & Partial<OrganizationContextVariables>
}>(
  app: Hono<T>,
  overrides: Partial<DenScheduledTaskRouteDependencies> = {},
) {
  const dependencies: DenScheduledTaskRouteDependencies = {
    service: createDenScheduledTaskService(),
    authenticateWorker: authenticateDenScheduledTaskWorker,
    replayStore: databaseDenScheduledTaskTickReplayStore,
    internalSecret: env.scheduledTasksInternalSecret,
    now: Date.now,
    orgMemberRoute: orgMemberRoute(),
    ...overrides,
  }

  async function authenticatedWorker(c: {
    req: { param(name: string): string; header(name: string): string | undefined }
  }) {
    let workerId
    try {
      workerId = normalizeDenTypeId("worker", c.req.param("id"))
    } catch {
      return null
    }
    const token = readBearerToken(c.req.header("authorization"))
    if (!token || !await dependencies.authenticateWorker({ workerId, token })) return null
    return workerId
  }

  function memberContext(c: { get(name: "organizationContext"): OrganizationContextVariables["organizationContext"] }) {
    const context = c.get("organizationContext")
    return {
      organizationId: normalizeDenTypeId("organization", context.organization.id),
      memberId: normalizeDenTypeId("member", context.currentMember.id),
    }
  }

  app.post(
    "/v1/scheduled-tasks",
    dependencies.orgMemberRoute,
    async (c) => {
      const body = scheduledTaskDefinitionSchema.safeParse(await c.req.json().catch(() => null))
      if (!body.success) return c.json({ error: "invalid_request" }, 400)
      try {
        const created = await dependencies.service.createDraft({
          ...memberContext(c),
          definition: body.data,
        })
        return c.json(created, 201)
      } catch (error) {
        const mapped = routeError(error)
        return c.json({ error: mapped.error }, mapped.status as 409)
      }
    },
  )

  app.get(
    "/v1/scheduled-tasks",
    dependencies.orgMemberRoute,
    async (c) => c.json({ tasks: await dependencies.service.list(memberContext(c)) }, 200),
  )

  app.get(
    "/v1/scheduled-tasks/:taskId",
    dependencies.orgMemberRoute,
    async (c) => {
      let taskId
      try {
        taskId = normalizeDenTypeId("scheduledTask", c.req.param("taskId"))
      } catch {
        return c.json({ error: "not_found" }, 404)
      }
      const task = await dependencies.service.get({ ...memberContext(c), taskId })
      return task ? c.json(task, 200) : c.json({ error: "not_found" }, 404)
    },
  )

  app.post(
    "/v1/scheduled-tasks/:taskId/review",
    dependencies.orgMemberRoute,
    async (c) => {
      const body = reviewScheduledTaskGrantSchema
        .omit({ grantor: true })
        .safeParse(await c.req.json().catch(() => null))
      if (!body.success) return c.json({ error: "invalid_request" }, 400)
      let taskId
      try {
        taskId = normalizeDenTypeId("scheduledTask", c.req.param("taskId"))
      } catch {
        return c.json({ error: "not_found" }, 404)
      }
      try {
        const grant = await dependencies.service.review({
          ...memberContext(c),
          taskId,
          review: body.data,
        })
        return c.json({ grant }, 200)
      } catch (error) {
        const mapped = routeError(error)
        return c.json({ error: mapped.error }, mapped.status as 409)
      }
    },
  )

  app.post(
    "/v1/scheduled-tasks/:taskId/enable",
    dependencies.orgMemberRoute,
    async (c) => {
      let taskId
      try {
        taskId = normalizeDenTypeId("scheduledTask", c.req.param("taskId"))
      } catch {
        return c.json({ error: "not_found" }, 404)
      }
      try {
        const task = await dependencies.service.enable({
          ...memberContext(c),
          taskId,
        })
        return c.json({ task }, 200)
      } catch (error) {
        const mapped = routeError(error)
        return c.json({ error: mapped.error }, mapped.status as 409)
      }
    },
  )

  app.post(
    "/v1/scheduled-tasks/:taskId/pause",
    dependencies.orgMemberRoute,
    async (c) => {
      let taskId
      try {
        taskId = normalizeDenTypeId("scheduledTask", c.req.param("taskId"))
      } catch {
        return c.json({ error: "not_found" }, 404)
      }
      try {
        const task = await dependencies.service.pause({
          ...memberContext(c),
          taskId,
        })
        return c.json({ task }, 200)
      } catch (error) {
        const mapped = routeError(error)
        return c.json({ error: mapped.error }, mapped.status as 409)
      }
    },
  )

  app.post(
    "/v1/scheduled-tasks/:taskId/runs",
    dependencies.orgMemberRoute,
    async (c) => {
      const nonce = c.req.header("idempotency-key")?.trim()
      if (!nonce || nonce.length > 200) return c.json({ error: "idempotency_key_required" }, 400)
      let taskId
      try {
        taskId = normalizeDenTypeId("scheduledTask", c.req.param("taskId"))
      } catch {
        return c.json({ error: "not_found" }, 404)
      }
      try {
        const queued = await dependencies.service.runOnce({
          ...memberContext(c),
          taskId,
          nonce,
        })
        if (queued.kind === "overlap") return c.json({ error: "active_run_exists" }, 409)
        return c.json({ kind: queued.kind, run: queued.run }, queued.kind === "queued" ? 202 : 200)
      } catch (error) {
        const mapped = routeError(error)
        return c.json({ error: mapped.error }, mapped.status as 409)
      }
    },
  )

  app.get(
    "/v1/scheduled-tasks/:taskId/runs/:runId",
    dependencies.orgMemberRoute,
    async (c) => {
      let taskId
      let runId
      try {
        taskId = normalizeDenTypeId("scheduledTask", c.req.param("taskId"))
        runId = normalizeDenTypeId("scheduledTaskRun", c.req.param("runId"))
      } catch {
        return c.json({ error: "not_found" }, 404)
      }
      const receipt = await dependencies.service.receipt({
        ...memberContext(c),
        taskId,
        runId,
      })
      return receipt ? c.json(receipt, 200) : c.json({ error: "not_found" }, 404)
    },
  )

  app.post(
    "/v1/scheduled-tasks/:taskId/runs/:runId/cancel",
    dependencies.orgMemberRoute,
    async (c) => {
      let taskId
      let runId
      try {
        taskId = normalizeDenTypeId("scheduledTask", c.req.param("taskId"))
        runId = normalizeDenTypeId("scheduledTaskRun", c.req.param("runId"))
      } catch {
        return c.json({ error: "not_found" }, 404)
      }
      const run = await dependencies.service.cancel({
        ...memberContext(c),
        taskId,
        runId,
      })
      return run ? c.json({ run }, 200) : c.json({ error: "not_found" }, 404)
    },
  )

  app.post(
    "/v1/workers/:id/scheduled-task-runs/claim",
    tokenRoute,
    async (c) => {
      const workerId = await authenticatedWorker(c)
      if (!workerId) return c.json({ error: "unauthorized" }, 401)
      try {
        const claim = await dependencies.service.claim(workerId)
        return claim ? c.json(claim, 200) : c.body(null, 204)
      } catch (error) {
        const mapped = routeError(error)
        return c.json({ error: mapped.error }, mapped.status as 409)
      }
    },
  )

  app.post(
    "/v1/workers/:id/scheduled-task-attempts/:attemptId/heartbeat",
    tokenRoute,
    async (c) => {
      const workerId = await authenticatedWorker(c)
      if (!workerId) return c.json({ error: "unauthorized" }, 401)
      const body = scheduledTaskWorkerHeartbeatRequestSchema.safeParse(await c.req.json().catch(() => null))
      if (!body.success) return c.json({ error: "invalid_request" }, 400)
      const leaseToken = c.req.header("x-openwork-scheduled-task-lease")?.trim()
      if (!leaseToken) return c.json({ error: "unauthorized" }, 401)
      let attemptId
      try {
        attemptId = normalizeDenTypeId("scheduledTaskAttempt", c.req.param("attemptId"))
      } catch {
        return c.json({ error: "not_found" }, 404)
      }
      try {
        const result = await dependencies.service.heartbeat({
          workerId,
          attemptId,
          leaseToken,
          sessionId: body.data.sessionId,
        })
        return c.json({ ok: true, ...result }, 200)
      } catch (error) {
        const mapped = routeError(error)
        return c.json({ error: mapped.error }, mapped.status as 409)
      }
    },
  )

  app.post(
    "/v1/workers/:id/scheduled-task-attempts/:attemptId/events",
    tokenRoute,
    async (c) => {
      const workerId = await authenticatedWorker(c)
      if (!workerId) return c.json({ error: "unauthorized" }, 401)
      const body = scheduledTaskWorkerEventRequestSchema.safeParse(await c.req.json().catch(() => null))
      if (!body.success) return c.json({ error: "invalid_request" }, 400)
      const leaseToken = c.req.header("x-openwork-scheduled-task-lease")?.trim()
      if (!leaseToken) return c.json({ error: "unauthorized" }, 401)
      let attemptId
      try {
        attemptId = normalizeDenTypeId("scheduledTaskAttempt", c.req.param("attemptId"))
      } catch {
        return c.json({ error: "not_found" }, 404)
      }
      try {
        const result = await dependencies.service.appendEvent({
          workerId,
          attemptId,
          leaseToken,
          sequence: body.data.sequence,
          event: body.data.event,
        })
        return c.json({ ok: true, ...result }, 200)
      } catch (error) {
        const mapped = routeError(error)
        return c.json({ error: mapped.error }, mapped.status as 409)
      }
    },
  )

  app.post(
    "/v1/workers/:id/scheduled-task-attempts/:attemptId/complete",
    tokenRoute,
    async (c) => {
      const workerId = await authenticatedWorker(c)
      if (!workerId) return c.json({ error: "unauthorized" }, 401)
      const body = scheduledTaskWorkerCompletionRequestSchema.safeParse(await c.req.json().catch(() => null))
      if (!body.success) return c.json({ error: "invalid_request" }, 400)
      const leaseToken = c.req.header("x-openwork-scheduled-task-lease")?.trim()
      if (!leaseToken) return c.json({ error: "unauthorized" }, 401)
      let attemptId
      try {
        attemptId = normalizeDenTypeId("scheduledTaskAttempt", c.req.param("attemptId"))
      } catch {
        return c.json({ error: "not_found" }, 404)
      }
      try {
        const result = await dependencies.service.complete({
          workerId,
          attemptId,
          leaseToken,
          result: body.data.result,
        })
        return c.json({ ok: true, ...result }, 200)
      } catch (error) {
        const mapped = routeError(error)
        return c.json({ error: mapped.error }, mapped.status as 409)
      }
    },
  )

  app.post(
    "/internal/scheduled-tasks/tick",
    signedWebhookRoute,
    async (c) => {
      if (!dependencies.internalSecret) {
        return c.json({ error: "scheduled_tasks_not_configured" }, 503)
      }
      const rawBody = await c.req.text()
      const requestId = c.req.header("x-den-scheduler-request-id")
      const validSignature = verifyDenScheduledTaskTickSignature({
        secret: dependencies.internalSecret,
        rawBody,
        timestampHeader: c.req.header("x-den-scheduler-timestamp"),
        requestId,
        signatureHeader: c.req.header("x-den-scheduler-signature"),
        now: dependencies.now(),
      })
      if (!validSignature || !requestId) return c.json({ error: "unauthorized" }, 401)
      let rawInput: unknown
      try {
        rawInput = JSON.parse(rawBody)
      } catch {
        return c.json({ error: "invalid_request" }, 400)
      }
      const parsed = tickSchema.safeParse(rawInput)
      if (!parsed.success) return c.json({ error: "invalid_request" }, 400)
      const reserved = await dependencies.replayStore.reserve({
        requestId,
        source: parsed.data.source,
        rawBody,
      })
      if (!reserved) return c.json({ error: "replayed_request" }, 409)
      const result = await dependencies.service.tick(parsed.data)
      await dependencies.replayStore.markProcessed(requestId, result.processedAt)
      return c.json(result, 200)
    },
  )
}
