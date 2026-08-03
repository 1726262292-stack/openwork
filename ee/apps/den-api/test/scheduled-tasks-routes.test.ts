import { beforeAll, describe, expect, test } from "bun:test"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import {
  scheduledTaskDefinitionSchema,
  scheduledTaskGrantSchema,
  scheduledTaskPlacementIdentity,
  scheduledTaskPlacementSchema,
  scheduledTaskRevisionSchema,
  scheduledTaskRunSchema,
  scheduledTaskSchema,
} from "@openwork/scheduled-tasks"
import { Hono, type MiddlewareHandler } from "hono"
import type { OrganizationContext } from "../src/orgs.js"
import type { OrganizationContextVariables } from "../src/middleware/index.js"
import type { WorkerRouteVariables } from "../src/routes/workers/shared.js"
import type { DenScheduledTaskService } from "../src/scheduled-tasks/service.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
}

let routes: typeof import("../src/routes/scheduled-tasks/index.js")
let repositoryModule: typeof import("../src/scheduled-tasks/repository.js")

beforeAll(async () => {
  seedRequiredEnv()
  routes = await import("../src/routes/scheduled-tasks/index.js")
  repositoryModule = await import("../src/scheduled-tasks/repository.js")
})

function fixture() {
  const organizationId = createDenTypeId("organization")
  const otherOrganizationId = createDenTypeId("organization")
  const userId = createDenTypeId("user")
  const memberId = createDenTypeId("member")
  const workerId = createDenTypeId("worker")
  const taskId = createDenTypeId("scheduledTask")
  const revisionId = createDenTypeId("scheduledTaskRevision")
  const grantId = createDenTypeId("scheduledTaskGrant")
  const runId = createDenTypeId("scheduledTaskRun")
  const attemptId = createDenTypeId("scheduledTaskAttempt")
  const placement = scheduledTaskPlacementSchema.parse({
    target: {
      kind: "den-worker",
      organizationId,
      workerId,
      workspaceId: "workspace-1",
    },
    schedulerOwner: "den",
    executionAvailability: "cloud",
    executionPrincipal: {
      kind: "den-membership",
      organizationId,
      membershipId: memberId,
    },
    capabilityReferences: [{
      id: "workspace.files.read",
      source: "openwork",
      actionClass: "read",
      reviewedVersion: "1",
      reviewedDigest: null,
    }],
  })
  const definition = scheduledTaskDefinitionSchema.parse({
    name: "Remote route task",
    description: "",
    prompt: "Summarize the workspace.",
    workspaceId: "workspace-1",
    placement,
    schedule: { kind: "manual", timezone: "UTC" },
    model: { providerId: null, modelId: null, agent: null },
    maximumRuntimeMs: 60_000,
    overlapPolicy: "skip",
    retryPolicy: { maximumAttempts: 1, delayMs: 0 },
    missedRunPolicy: { kind: "skip", graceMs: 0, maximumRecoverableOccurrences: 1 },
  })
  const revision = scheduledTaskRevisionSchema.parse({
    id: revisionId,
    taskId,
    revision: 1,
    definition,
    createdAt: 1_000,
    createdBy: memberId,
    reviewedAt: 1_000,
    reviewedBy: memberId,
  })
  const grant = scheduledTaskGrantSchema.parse({
    id: grantId,
    taskId,
    revision: 1,
    taskRevisionId: revisionId,
    workspaceId: "workspace-1",
    placement,
    placementIdentity: scheduledTaskPlacementIdentity(placement),
    filesystemScope: { kind: "den-worker-relative-roots", roots: ["."] },
    authorizedWorkspaceRoots: [],
    capabilityIds: ["workspace.files.read"],
    actionClasses: ["read"],
    filesystem: { read: true, write: false },
    maximumRuntimeMs: 60_000,
    model: definition.model,
    communicationPolicy: "deny",
    destructiveActionPolicy: "deny",
    selfModificationPolicy: "deny",
    grantor: memberId,
    reviewedAt: 1_000,
    expiresAt: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: 1_000,
  })
  const run = scheduledTaskRunSchema.parse({
    id: runId,
    taskId,
    taskRevisionId: revisionId,
    grantRevisionId: grantId,
    placement,
    occurrenceId: `manual-${runId}`,
    trigger: "manual",
    status: "scheduled",
    scheduledFor: null,
    claimedAt: 2_000,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    idempotencyKey: "request-1",
    sessionId: null,
    attemptCount: 0,
    boundedUsage: { inputTokens: null, outputTokens: null, costMicros: null },
    error: null,
    needsAttention: null,
    artifacts: [],
    cancelRequestedAt: null,
    createdAt: 2_000,
    updatedAt: 2_000,
  })
  const task = scheduledTaskSchema.parse({
    id: taskId,
    workspaceId: definition.workspaceId,
    state: "ready",
    enabled: false,
    draftRevisionId: revisionId,
    activeRevisionId: revisionId,
    activeGrantId: grantId,
    nextRunAt: null,
    needsAttention: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    deletedAt: null,
  })
  return {
    organizationId,
    otherOrganizationId,
    userId,
    memberId,
    workerId,
    taskId,
    revisionId,
    runId,
    attemptId,
    definition,
    revision,
    grant,
    run,
    task,
  }
}

function context(values: ReturnType<typeof fixture>, organizationId = values.organizationId): OrganizationContext {
  const now = new Date(0)
  return {
    organization: {
      id: organizationId,
      name: "Scheduled Tasks Test",
      slug: `scheduled-${organizationId}`,
      logo: null,
      allowedEmailDomains: null,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    },
    currentMember: {
      id: values.memberId,
      userId: values.userId,
      role: "member",
      createdAt: now,
      joinedAt: now,
      isOwner: false,
    },
    members: [],
    invitations: [],
    roles: [],
    teams: [],
  }
}

function makeApp(input: {
  values: ReturnType<typeof fixture>
  service: DenScheduledTaskService
}) {
  const app = new Hono<{
    Variables: WorkerRouteVariables & Partial<OrganizationContextVariables>
  }>()
  const orgMemberRoute: MiddlewareHandler = async (c, next) => {
    const selected = c.req.header("x-test-other-org")
      ? input.values.otherOrganizationId
      : input.values.organizationId
    c.set("organizationContext", context(input.values, selected))
    await next()
  }
  routes.registerScheduledTaskRoutes(app, {
    service: input.service,
    orgMemberRoute,
    authenticateWorker: async () => true,
    internalSecret: "a-secret-long-enough-for-a-signed-scheduler",
    replayStore: {
      async reserve() { return true },
      async markProcessed() {},
    },
  })
  return app
}

function stubService(overrides: Partial<DenScheduledTaskService>): DenScheduledTaskService {
  return {
    async list() { return [] },
    async get() { return null },
    async createDraft() { throw new Error("not implemented") },
    async review() { throw new Error("not implemented") },
    async enable() { throw new Error("not implemented") },
    async pause() { throw new Error("not implemented") },
    async runOnce() { throw new Error("not implemented") },
    async receipt() { return null },
    async cancel() { return null },
    async tick(input) {
      return {
        processedAt: input.now,
        source: input.source,
        selectedTaskIds: [],
        claimedRunIds: [],
        nextDueAt: null,
      }
    },
    async claim() { return null },
    async heartbeat() { return { leaseExpiresAt: 0, cancelRequestedAt: null } },
    async appendEvent() { return { duplicate: false } },
    async complete() { throw new Error("not implemented") },
    ...overrides,
  }
}

describe("Scheduled Tasks Den routes", () => {
  test("carries the active organization and member through draft, review, run-once, and receipt", async () => {
    const values = fixture()
    const scopes: Array<{ organizationId: string; memberId: string }> = []
    const service = stubService({
      async createDraft(input) {
        scopes.push(input)
        return { taskId: values.taskId, revisionId: values.revisionId }
      },
      async list(input) {
        scopes.push(input)
        return [{ task: values.task, revision: values.revision, grant: values.grant }]
      },
      async get(input) {
        scopes.push(input)
        if (input.organizationId !== values.organizationId) return null
        return {
          task: values.task,
          draftRevision: values.revision,
          activeRevision: values.revision,
          grant: values.grant,
        }
      },
      async review(input) {
        scopes.push(input)
        return values.grant
      },
      async runOnce(input) {
        scopes.push(input)
        return { kind: "queued", run: values.run }
      },
      async enable(input) {
        scopes.push(input)
        return { ...values.task, state: "enabled", enabled: true }
      },
      async pause(input) {
        scopes.push(input)
        return { ...values.task, state: "paused", enabled: false }
      },
      async receipt(input) {
        scopes.push(input)
        if (input.organizationId !== values.organizationId) return null
        return {
          run: values.run,
          taskRevision: values.revision,
          grantRevision: values.grant,
          placement: values.definition.placement,
          attempts: [],
          sessionRoute: null,
          artifacts: [],
        }
      },
      async cancel(input) {
        scopes.push(input)
        if (input.organizationId !== values.organizationId) return null
        return { ...values.run, status: "cancelled" }
      },
    })
    const app = makeApp({ values, service })

    const created = await app.request("/v1/scheduled-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values.definition),
    })
    expect(created.status).toBe(201)

    const listed = await app.request("/v1/scheduled-tasks")
    expect(listed.status).toBe(200)
    expect((await listed.json()).tasks).toHaveLength(1)

    const detail = await app.request(`/v1/scheduled-tasks/${values.taskId}`)
    expect(detail.status).toBe(200)

    const reviewed = await app.request(`/v1/scheduled-tasks/${values.taskId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevisionId: values.revisionId,
        filesystemScope: { kind: "den-worker-relative-roots", roots: ["."] },
        authorizedWorkspaceRoots: [],
        capabilityIds: ["workspace.files.read"],
        actionClasses: ["read"],
        filesystem: { read: true, write: false },
        maximumRuntimeMs: 60_000,
        model: values.definition.model,
        expiresAt: null,
      }),
    })
    expect(reviewed.status).toBe(200)

    const enabled = await app.request(`/v1/scheduled-tasks/${values.taskId}/enable`, {
      method: "POST",
    })
    expect(enabled.status).toBe(200)

    const paused = await app.request(`/v1/scheduled-tasks/${values.taskId}/pause`, {
      method: "POST",
    })
    expect(paused.status).toBe(200)

    const queued = await app.request(`/v1/scheduled-tasks/${values.taskId}/runs`, {
      method: "POST",
      headers: { "idempotency-key": "request-1" },
    })
    expect(queued.status).toBe(202)

    const receipt = await app.request(`/v1/scheduled-tasks/${values.taskId}/runs/${values.runId}`)
    expect(receipt.status).toBe(200)

    const cancelled = await app.request(
      `/v1/scheduled-tasks/${values.taskId}/runs/${values.runId}/cancel`,
      { method: "POST" },
    )
    expect(cancelled.status).toBe(200)
    expect((await cancelled.json()).run.status).toBe("cancelled")
    expect(scopes).toHaveLength(9)
    expect(scopes.every((scope) =>
      scope.organizationId === values.organizationId
      && scope.memberId === values.memberId
    )).toBe(true)

    const crossOrganization = await app.request(
      `/v1/scheduled-tasks/${values.taskId}/runs/${values.runId}`,
      { headers: { "x-test-other-org": "1" } },
    )
    expect(crossOrganization.status).toBe(404)

    const crossOrganizationTask = await app.request(
      `/v1/scheduled-tasks/${values.taskId}`,
      { headers: { "x-test-other-org": "1" } },
    )
    expect(crossOrganizationTask.status).toBe(404)
  })

  test("exposes worker claim, exact event replay, and conflicting event order semantics", async () => {
    const values = fixture()
    const seenSequences = new Set<number>()
    const service = stubService({
      async claim() {
        return {
          lease: {
            runId: values.runId,
            attemptId: values.attemptId,
            generation: 1,
            expiresAt: 60_000,
            token: "lease-token-that-is-at-least-thirty-two-characters",
          },
          request: {
            runId: values.runId,
            attemptId: values.attemptId,
            idempotencyKey: values.run.idempotencyKey,
            placement: values.definition.placement,
            taskRevision: values.revision,
            grantRevision: values.grant,
          },
        }
      },
      async appendEvent(input) {
        if (seenSequences.has(input.sequence)) return { duplicate: true }
        const latest = Math.max(0, ...seenSequences)
        if (input.sequence !== latest + 1) {
          throw new repositoryModule.DenScheduledTaskRepositoryError("conflicting_replay")
        }
        seenSequences.add(input.sequence)
        return { duplicate: false }
      },
    })
    const app = makeApp({ values, service })
    const authorization = { authorization: "Bearer execution-token" }
    const claimed = await app.request(
      `/v1/workers/${values.workerId}/scheduled-task-runs/claim`,
      { method: "POST", headers: authorization },
    )
    expect(claimed.status).toBe(200)

    const event = {
      sequence: 1,
      event: { type: "session-created", at: 2_100, sessionId: "session-1" },
    }
    const eventHeaders = {
      ...authorization,
      "content-type": "application/json",
      "x-openwork-scheduled-task-lease": "lease-token-that-is-at-least-thirty-two-characters",
    }
    const accepted = await app.request(
      `/v1/workers/${values.workerId}/scheduled-task-attempts/${values.attemptId}/events`,
      { method: "POST", headers: eventHeaders, body: JSON.stringify(event) },
    )
    expect(accepted.status).toBe(200)
    expect((await accepted.json()).duplicate).toBe(false)

    const replayed = await app.request(
      `/v1/workers/${values.workerId}/scheduled-task-attempts/${values.attemptId}/events`,
      { method: "POST", headers: eventHeaders, body: JSON.stringify(event) },
    )
    expect(replayed.status).toBe(200)
    expect((await replayed.json()).duplicate).toBe(true)

    const outOfOrder = await app.request(
      `/v1/workers/${values.workerId}/scheduled-task-attempts/${values.attemptId}/events`,
      {
        method: "POST",
        headers: eventHeaders,
        body: JSON.stringify({ ...event, sequence: 99 }),
      },
    )
    expect(outOfOrder.status).toBe(409)
  })
})
