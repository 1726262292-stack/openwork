import { and, desc, eq } from "@openwork-ee/den-db/drizzle"
import {
  CloudTaskRunTable,
  CloudTaskTable,
  WorkerInstanceTable,
  WorkerTable,
  WorkerTokenTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import type { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"
import { requireCloudWorkerAccess } from "../../billing/polar.js"
import { db } from "../../db.js"
import { jsonValidator, paramValidator, queryValidator, requireUserMiddleware, resolveOrganizationContextMiddleware, type OrganizationContextVariables, type UserOrganizationsContext } from "../../middleware/index.js"
import { getOrganizationLimitStatus } from "../../organization-limits.js"
import type { OrganizationContext } from "../../orgs.js"
import { denTypeIdSchema, invalidRequestSchema, jsonResponse, notFoundSchema, unauthorizedSchema } from "../../openapi.js"
import type { AuthContextVariables } from "../../session.js"
import { getRequiredUserEmail } from "../../user.js"
import { buildCloudTaskRunJobInput, startWorkerBackgroundJob } from "../../workers/background-jobs.js"
import { provisionWorker } from "../../workers/provisioner.js"
import { getWorkerByIdForOrg, getWorkerTokensAndConnect, token } from "../workers/shared.js"

type CloudTaskRouteVariables = AuthContextVariables & Partial<UserOrganizationsContext> & Partial<OrganizationContextVariables>

type CloudTaskRow = typeof CloudTaskTable.$inferSelect
type CloudTaskRunRow = typeof CloudTaskRunTable.$inferSelect
type NormalizedCloudTaskSchedule =
  | {
    scheduleType: "manual"
    scheduleTimeOfDay: null
    scheduleTimezone: null
    nextRunAt: null
  }
  | {
    scheduleType: "daily"
    scheduleTimeOfDay: string
    scheduleTimezone: string
    nextRunAt: Date
  }
type CloudTaskRunAccessResult =
  | { allowed: true }
  | { allowed: false; status: 400; body: { error: "user_email_required" } }
  | { allowed: false; status: 402; body: { error: "cloud_worker_billing_unavailable"; message: string } }
  | { allowed: false; status: 409; body: { error: "org_limit_reached"; limitType: "workers"; limit: number; currentCount: number; message: string } }

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:mm time.")

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

const cloudTaskScheduleInputSchema = z.object({
  type: z.enum(["manual", "daily"]).default("manual"),
  timeOfDay: timeOfDaySchema.optional(),
  timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, "Use a valid IANA time zone, such as UTC or America/Los_Angeles.").optional(),
}).optional()

const cloudTaskCreateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  prompt: z.string().trim().min(1).max(12000),
  schedule: cloudTaskScheduleInputSchema,
  model: z.object({
    providerID: z.string().trim().min(1).max(255),
    modelID: z.string().trim().min(1).max(255),
  }).optional(),
  agent: z.string().trim().min(1).max(255).optional(),
  variant: z.string().trim().min(1).max(255).optional(),
  enabled: z.boolean().default(true),
}).meta({ ref: "CloudTaskCreateRequest" })

const cloudTaskIdParamSchema = z.object({
  id: denTypeIdSchema("cloudTask"),
})

const listCloudTasksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const cloudTaskSchema = z.object({
  id: denTypeIdSchema("cloudTask"),
  orgId: denTypeIdSchema("organization"),
  createdByUserId: denTypeIdSchema("user").nullable(),
  createdByMemberId: denTypeIdSchema("member").nullable(),
  name: z.string(),
  prompt: z.string(),
  scheduleType: z.enum(["manual", "daily"]),
  scheduleTimeOfDay: z.string().nullable(),
  scheduleTimezone: z.string().nullable(),
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }).nullable(),
  agent: z.string().nullable(),
  variant: z.string().nullable(),
  enabled: z.boolean(),
  nextRunAt: z.string().datetime().nullable(),
  lastRunId: denTypeIdSchema("cloudTaskRun").nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).meta({ ref: "CloudTask" })

const cloudTaskRunSchema = z.object({
  id: denTypeIdSchema("cloudTaskRun"),
  taskId: denTypeIdSchema("cloudTask"),
  orgId: denTypeIdSchema("organization"),
  workerId: denTypeIdSchema("worker").nullable(),
  status: z.enum(["pending", "provisioning", "running", "accepted", "failed", "cancelled"]),
  sessionId: z.string().nullable(),
  openworkUrl: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).meta({ ref: "CloudTaskRun" })

const cloudTaskListResponseSchema = z.object({
  tasks: z.array(cloudTaskSchema),
}).meta({ ref: "CloudTaskListResponse" })

const cloudTaskResponseSchema = z.object({
  task: cloudTaskSchema,
}).meta({ ref: "CloudTaskResponse" })

const cloudTaskRunResponseSchema = z.object({
  task: cloudTaskSchema,
  run: cloudTaskRunSchema,
}).meta({ ref: "CloudTaskRunResponse" })

const paymentRequiredSchema = z.object({
  error: z.literal("cloud_worker_billing_unavailable"),
  message: z.string(),
}).meta({ ref: "CloudTaskPaymentRequiredError" })

const userEmailRequiredSchema = z.object({
  error: z.literal("user_email_required"),
}).meta({ ref: "CloudTaskUserEmailRequiredError" })

const orgLimitReachedSchema = z.object({
  error: z.literal("org_limit_reached"),
  limitType: z.literal("workers"),
  limit: z.number().int(),
  currentCount: z.number().int(),
  message: z.string(),
}).meta({ ref: "CloudTaskOrgLimitReachedError" })

const workerRuntimeUnavailableSchema = z.object({
  error: z.literal("worker_runtime_unavailable"),
  message: z.string(),
}).meta({ ref: "CloudTaskWorkerRuntimeUnavailableError" })

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const value = parts.find((part) => part.type === type)?.value
  if (!value) {
    throw new Error(`Missing ${type} from formatted date.`)
  }
  return Number.parseInt(value, 10)
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)

  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
    hour: numberPart(parts, "hour"),
    minute: numberPart(parts, "minute"),
    second: numberPart(parts, "second"),
  }
}

function zonedTimeToUtc(input: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  timeZone: string
}) {
  const utcGuess = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0))
  const actualParts = zonedParts(utcGuess, input.timeZone)
  const actualAsUtc = Date.UTC(
    actualParts.year,
    actualParts.month - 1,
    actualParts.day,
    actualParts.hour,
    actualParts.minute,
    actualParts.second,
  )
  const expectedAsUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0)
  return new Date(expectedAsUtc - (actualAsUtc - utcGuess.getTime()))
}

export function nextDailyRunAt(input: {
  timeOfDay: string
  timezone: string
  now?: Date
}) {
  const [hourPart, minutePart] = input.timeOfDay.split(":")
  const hour = Number.parseInt(hourPart, 10)
  const minute = Number.parseInt(minutePart, 10)
  const now = input.now ?? new Date()
  const today = zonedParts(now, input.timezone)
  let candidate = zonedTimeToUtc({
    year: today.year,
    month: today.month,
    day: today.day,
    hour,
    minute,
    timeZone: input.timezone,
  })

  if (candidate.getTime() <= now.getTime()) {
    const nextLocalDay = new Date(Date.UTC(today.year, today.month - 1, today.day + 1))
    candidate = zonedTimeToUtc({
      year: nextLocalDay.getUTCFullYear(),
      month: nextLocalDay.getUTCMonth() + 1,
      day: nextLocalDay.getUTCDate(),
      hour,
      minute,
      timeZone: input.timezone,
    })
  }

  return candidate
}

export function normalizeCloudTaskSchedule(input: z.infer<typeof cloudTaskScheduleInputSchema>): NormalizedCloudTaskSchedule {
  if (input?.type !== "daily") {
    const scheduleType = "manual"
    return {
      scheduleType,
      scheduleTimeOfDay: null,
      scheduleTimezone: null,
      nextRunAt: null,
    }
  }

  const scheduleTimeOfDay = input.timeOfDay ?? "09:00"
  const scheduleTimezone = input.timezone ?? "UTC"
  const scheduleType = "daily"
  return {
    scheduleType,
    scheduleTimeOfDay,
    scheduleTimezone,
    nextRunAt: nextDailyRunAt({ timeOfDay: scheduleTimeOfDay, timezone: scheduleTimezone }),
  }
}

function defaultCloudTaskName(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim()
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function memberTeamIdsForContext(context: OrganizationContext) {
  return context.teams
    .filter((team) => team.memberIds.includes(context.currentMember.id))
    .map((team) => team.id)
}

export function toCloudTaskResponse(row: CloudTaskRow) {
  const model = row.model_provider_id && row.model_id
    ? { providerID: row.model_provider_id, modelID: row.model_id }
    : null

  return {
    id: row.id,
    orgId: row.org_id,
    createdByUserId: row.created_by_user_id,
    createdByMemberId: row.created_by_member_id,
    name: row.name,
    prompt: row.prompt,
    scheduleType: row.schedule_type,
    scheduleTimeOfDay: row.schedule_time_of_day,
    scheduleTimezone: row.schedule_timezone,
    model,
    agent: row.agent,
    variant: row.variant,
    enabled: row.enabled,
    nextRunAt: row.next_run_at,
    lastRunId: row.last_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toCloudTaskRunResponse(row: CloudTaskRunRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    orgId: row.org_id,
    workerId: row.worker_id,
    status: row.status,
    sessionId: row.session_id,
    openworkUrl: row.openwork_url,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseCloudTaskIdParam(value: string) {
  return normalizeDenTypeId("cloudTask", value)
}

async function getCloudTaskByIdForOrg(taskId: CloudTaskRow["id"], orgId: CloudTaskRow["org_id"]) {
  const rows = await db
    .select()
    .from(CloudTaskTable)
    .where(and(eq(CloudTaskTable.id, taskId), eq(CloudTaskTable.org_id, orgId)))
    .limit(1)

  return rows[0] ?? null
}

function truncateErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "cloud_task_run_failed"
  return message.slice(0, 2048)
}

async function markCloudTaskRunFailed(input: {
  runId: CloudTaskRunRow["id"]
  workerId: NonNullable<CloudTaskRunRow["worker_id"]>
  error: unknown
}) {
  await db
    .update(CloudTaskRunTable)
    .set({
      status: "failed",
      error_message: truncateErrorMessage(input.error),
      completed_at: new Date(),
    })
    .where(eq(CloudTaskRunTable.id, input.runId))

  await db
    .update(WorkerTable)
    .set({ status: "failed" })
    .where(eq(WorkerTable.id, input.workerId))
}

async function continueCloudTaskRun(input: {
  task: CloudTaskRow
  runId: CloudTaskRunRow["id"]
  workerId: NonNullable<CloudTaskRunRow["worker_id"]>
  hostToken: string
  clientToken: string
  activityToken: string
  organizationContext: OrganizationContext
}) {
  try {
    const provisioned = await provisionWorker({
      workerId: input.workerId,
      name: input.task.name,
      hostToken: input.hostToken,
      clientToken: input.clientToken,
      activityToken: input.activityToken,
      organizationId: input.organizationContext.organization.id,
      memberId: input.organizationContext.currentMember.id,
      memberTeamIds: memberTeamIdsForContext(input.organizationContext),
    })

    await db
      .update(WorkerTable)
      .set({ status: provisioned.status })
      .where(eq(WorkerTable.id, input.workerId))

    await db.insert(WorkerInstanceTable).values({
      id: createDenTypeId("workerInstance"),
      worker_id: input.workerId,
      provider: provisioned.provider,
      region: provisioned.region,
      url: provisioned.url,
      status: provisioned.status,
    })

    if (provisioned.status !== "healthy") {
      throw new Error("Cloud worker is still provisioning and cannot accept the task run yet.")
    }

    await db
      .update(CloudTaskRunTable)
      .set({ status: "running" })
      .where(eq(CloudTaskRunTable.id, input.runId))

    const worker = await getWorkerByIdForOrg(input.workerId, input.task.org_id)
    if (!worker) {
      throw new Error("Cloud task worker record was not found after provisioning.")
    }

    const access = await getWorkerTokensAndConnect(worker)
    if ("error" in access && access.error) {
      throw new Error(access.error.body.message)
    }

    if (!access.connect?.openworkUrl || !access.connect.workspaceId) {
      throw new Error("Worker runtime access is not ready yet. Wait for provisioning to finish and try again.")
    }

    const job = await startWorkerBackgroundJob(buildCloudTaskRunJobInput({
      task: input.task,
      openworkUrl: access.connect.openworkUrl,
      clientToken: access.tokens.client,
    }))

    await db
      .update(CloudTaskRunTable)
      .set({
        status: job.status,
        session_id: job.sessionId,
        openwork_url: job.openworkUrl,
      })
      .where(eq(CloudTaskRunTable.id, input.runId))
  } catch (error) {
    await markCloudTaskRunFailed({
      runId: input.runId,
      workerId: input.workerId,
      error,
    })
  }
}

async function startCloudTaskRun(input: {
  task: CloudTaskRow
  userId: string
  organizationContext: OrganizationContext
}) {
  const workerId = createDenTypeId("worker")
  const runId = createDenTypeId("cloudTaskRun")
  const hostToken = token()
  const clientToken = token()
  const activityToken = token()
  const now = new Date()
  const workerName = `Task ${input.task.name}`.slice(0, 255)
  const runRow: CloudTaskRunRow = {
    id: runId,
    task_id: input.task.id,
    org_id: input.task.org_id,
    worker_id: workerId,
    status: "provisioning",
    session_id: null,
    openwork_url: null,
    error_message: null,
    started_at: now,
    completed_at: null,
    created_at: now,
    updated_at: now,
  }

  await db.transaction(async (tx) => {
    await tx.insert(WorkerTable).values({
      id: workerId,
      org_id: input.task.org_id,
      created_by_user_id: normalizeDenTypeId("user", input.userId),
      name: workerName,
      description: `Runtime created for cloud task ${input.task.id}`,
      destination: "cloud",
      status: "provisioning",
    })

    await tx.insert(WorkerTokenTable).values([
      {
        id: createDenTypeId("workerToken"),
        worker_id: workerId,
        scope: "host",
        token: hostToken,
      },
      {
        id: createDenTypeId("workerToken"),
        worker_id: workerId,
        scope: "client",
        token: clientToken,
      },
      {
        id: createDenTypeId("workerToken"),
        worker_id: workerId,
        scope: "activity",
        token: activityToken,
      },
    ])

    await tx.insert(CloudTaskRunTable).values(runRow)
    await tx.update(CloudTaskTable).set({ last_run_id: runId }).where(eq(CloudTaskTable.id, input.task.id))
  })

  void continueCloudTaskRun({
    task: input.task,
    runId,
    workerId,
    hostToken,
    clientToken,
    activityToken,
    organizationContext: input.organizationContext,
  })

  return runRow
}

async function requireCloudTaskRunAccess(input: {
  user: { id: string; email?: string | null; name?: string | null }
  orgId: CloudTaskRow["org_id"]
}): Promise<CloudTaskRunAccessResult> {
  const email = getRequiredUserEmail(input.user)
  if (!email) {
    const allowed = false
    const status = 400
    const error = "user_email_required"
    return { allowed, status, body: { error } }
  }

  const access = await requireCloudWorkerAccess({
    userId: normalizeDenTypeId("user", input.user.id),
    email,
    name: input.user.name ?? input.user.email ?? "OpenWork User",
  })

  if (!access.allowed) {
    const allowed = false
    const status = 402
    const error = "cloud_worker_billing_unavailable"
    return {
      allowed,
      status,
      body: {
        error,
        message: "Running cloud tasks requires an existing OpenWork Cloud plan. New self-serve purchases are no longer available.",
      },
    }
  }

  const workerLimit = await getOrganizationLimitStatus(input.orgId, "workers")
  if (workerLimit.exceeded) {
    const allowed = false
    const status = 409
    const error = "org_limit_reached"
    const limitType = "workers"
    return {
      allowed,
      status,
      body: {
        error,
        limitType,
        limit: workerLimit.limit,
        currentCount: workerLimit.currentCount,
        message: `This workspace currently supports up to ${workerLimit.limit} workers. Contact support to increase the limit.`,
      },
    }
  }

  const allowed = true
  return { allowed }
}

export function registerCloudTaskRoutes<T extends { Variables: CloudTaskRouteVariables }>(app: Hono<T>) {
  app.get(
    "/v1/cloud-tasks",
    describeRoute({
      tags: ["Cloud Tasks"],
      summary: "List cloud tasks",
      description: "Lists task-first OpenWork Cloud automations for the caller's active organization.",
      responses: {
        200: jsonResponse("Cloud tasks returned successfully.", cloudTaskListResponseSchema),
        400: jsonResponse("The cloud task list query parameters were invalid.", invalidRequestSchema),
        401: jsonResponse("The caller must be signed in to list cloud tasks.", unauthorizedSchema),
      },
    }),
    requireUserMiddleware,
    resolveOrganizationContextMiddleware,
    queryValidator(listCloudTasksQuerySchema),
    async (c) => {
      const organizationContext = c.get("organizationContext")
      const query = c.req.valid("query")
      const rows = await db
        .select()
        .from(CloudTaskTable)
        .where(eq(CloudTaskTable.org_id, organizationContext.organization.id))
        .orderBy(desc(CloudTaskTable.created_at))
        .limit(query.limit)

      return c.json({ tasks: rows.map(toCloudTaskResponse) })
    },
  )

  app.post(
    "/v1/cloud-tasks",
    describeRoute({
      tags: ["Cloud Tasks"],
      summary: "Create cloud task",
      description: "Creates a lightweight scheduled cloud task. Runs provision a cloud worker dynamically with the caller's accessible provider configuration.",
      responses: {
        201: jsonResponse("Cloud task created successfully.", cloudTaskResponseSchema),
        400: jsonResponse("The cloud task create payload was invalid.", invalidRequestSchema),
        401: jsonResponse("The caller must be signed in to create cloud tasks.", unauthorizedSchema),
      },
    }),
    requireUserMiddleware,
    resolveOrganizationContextMiddleware,
    jsonValidator(cloudTaskCreateSchema),
    async (c) => {
      const user = c.get("user")
      const organizationContext = c.get("organizationContext")
      const input = c.req.valid("json")
      const schedule = normalizeCloudTaskSchedule(input.schedule)
      const now = new Date()
      const row: CloudTaskRow = {
        id: createDenTypeId("cloudTask"),
        org_id: organizationContext.organization.id,
        created_by_user_id: normalizeDenTypeId("user", user.id),
        created_by_member_id: organizationContext.currentMember.id,
        name: input.name ?? defaultCloudTaskName(input.prompt),
        prompt: input.prompt,
        schedule_type: schedule.scheduleType,
        schedule_time_of_day: schedule.scheduleTimeOfDay,
        schedule_timezone: schedule.scheduleTimezone,
        model_provider_id: input.model?.providerID ?? null,
        model_id: input.model?.modelID ?? null,
        agent: input.agent ?? null,
        variant: input.variant ?? null,
        enabled: input.enabled,
        next_run_at: schedule.nextRunAt,
        last_run_id: null,
        created_at: now,
        updated_at: now,
      }

      await db.insert(CloudTaskTable).values(row)

      return c.json({ task: toCloudTaskResponse(row) }, 201)
    },
  )

  app.post(
    "/v1/cloud-tasks/:id/runs",
    describeRoute({
      tags: ["Cloud Tasks"],
      summary: "Run cloud task",
      description: "Starts a cloud task run by dynamically provisioning a cloud worker, seeding provider config, and dispatching the task prompt asynchronously.",
      responses: {
        202: jsonResponse("Cloud task run accepted.", cloudTaskRunResponseSchema),
        400: jsonResponse("The cloud task run request was invalid.", z.union([invalidRequestSchema, userEmailRequiredSchema])),
        401: jsonResponse("The caller must be signed in to run cloud tasks.", unauthorizedSchema),
        402: jsonResponse("The caller needs an active cloud plan before running cloud tasks.", paymentRequiredSchema),
        404: jsonResponse("The cloud task could not be found.", notFoundSchema),
        409: jsonResponse("The cloud task cannot be run yet.", z.union([orgLimitReachedSchema, workerRuntimeUnavailableSchema])),
      },
    }),
    requireUserMiddleware,
    resolveOrganizationContextMiddleware,
    paramValidator(cloudTaskIdParamSchema),
    async (c) => {
      const user = c.get("user")
      const organizationContext = c.get("organizationContext")
      const params = c.req.valid("param")
      const taskId = parseCloudTaskIdParam(params.id)
      const task = await getCloudTaskByIdForOrg(taskId, organizationContext.organization.id)

      if (!task) {
        return c.json({ error: "cloud_task_not_found" }, 404)
      }

      if (!task.enabled) {
        return c.json({
          error: "worker_runtime_unavailable",
          message: "Cloud task is disabled.",
        }, 409)
      }

      const access = await requireCloudTaskRunAccess({ user, orgId: organizationContext.organization.id })
      if (!access.allowed) {
        return c.json(access.body, access.status)
      }

      const run = await startCloudTaskRun({
        task,
        userId: user.id,
        organizationContext,
      })

      return c.json({
        task: toCloudTaskResponse({ ...task, last_run_id: run.id, updated_at: new Date() }),
        run: toCloudTaskRunResponse(run),
      }, 202)
    },
  )
}
