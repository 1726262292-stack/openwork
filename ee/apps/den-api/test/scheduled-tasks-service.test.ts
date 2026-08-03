import { beforeAll, describe, expect, test } from "bun:test"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import {
  scheduledTaskDefinitionSchema,
  scheduledTaskGrantSchema,
  scheduledTaskPlacementSchema,
  scheduledTaskPlacementIdentity,
  scheduledTaskRevisionSchema,
  scheduledTaskSchema,
} from "@openwork/scheduled-tasks"
import type {
  DenScheduledTaskRepository,
} from "../src/scheduled-tasks/repository.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
}

let createDenScheduledTaskService: typeof import("../src/scheduled-tasks/service.js")["createDenScheduledTaskService"]
let denScheduledTaskDispatchDeadline: typeof import("../src/scheduled-tasks/service.js")["denScheduledTaskDispatchDeadline"]
let scheduledTaskAbandonmentDisposition: typeof import("../src/scheduled-tasks/repository.js")["scheduledTaskAbandonmentDisposition"]
let scheduledTaskRetryNotBefore: typeof import("../src/scheduled-tasks/repository.js")["scheduledTaskRetryNotBefore"]

beforeAll(async () => {
  seedRequiredEnv()
  const [serviceModule, repositoryModule] = await Promise.all([
    import("../src/scheduled-tasks/service.js"),
    import("../src/scheduled-tasks/repository.js"),
  ])
  createDenScheduledTaskService = serviceModule.createDenScheduledTaskService
  denScheduledTaskDispatchDeadline = serviceModule.denScheduledTaskDispatchDeadline
  scheduledTaskAbandonmentDisposition = repositoryModule.scheduledTaskAbandonmentDisposition
  scheduledTaskRetryNotBefore = repositoryModule.scheduledTaskRetryNotBefore
})

function fakeRepository(
  overrides: Partial<DenScheduledTaskRepository> = {},
): DenScheduledTaskRepository {
  return {
    async createDraft() {},
    async listOwnedTasks() { return [] },
    async getOwnedTask() { return null },
    async activateGrant() { return false },
    async setOwnedScheduleState() { return null },
    async recordMissedOccurrence() { return { kind: "stale" } },
    async enqueueRunOnce() { return { kind: "overlap" } },
    async enqueueScheduledOccurrence() { return { kind: "stale" } },
    async getOwnedRunReceipt() { return null },
    async requestCancellation() { return null },
    async recoverAbandonedExecutions() {
      return { requeuedRunIds: [], terminalRunIds: [] }
    },
    async findQueuedExecution() { return null },
    async claimExecution() { return null },
    async heartbeat() { return { leaseExpiresAt: 0, cancelRequestedAt: null } },
    async appendEvent() { return { duplicate: false } },
    async complete() { throw new Error("not implemented") },
    async nextDueAt() { return null },
    ...overrides,
  }
}

function fixture() {
  const organizationId = createDenTypeId("organization")
  const memberId = createDenTypeId("member")
  const workerId = createDenTypeId("worker")
  const taskId = createDenTypeId("scheduledTask")
  const revisionId = createDenTypeId("scheduledTaskRevision")
  const grantId = createDenTypeId("scheduledTaskGrant")
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
    name: "Remote report",
    description: "",
    prompt: "Read the workspace and summarize it.",
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
  const task = scheduledTaskSchema.parse({
    id: taskId,
    workspaceId: "workspace-1",
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
  return { organizationId, memberId, workerId, taskId, revision, grant, task }
}

function recurringFixture() {
  const values = fixture()
  const definition = scheduledTaskDefinitionSchema.parse({
    ...values.revision.definition,
    schedule: { kind: "daily", hour: 0, minute: 1, timezone: "UTC" },
    missedRunPolicy: { kind: "skip", graceMs: 60_000, maximumRecoverableOccurrences: 1 },
  })
  const revision = scheduledTaskRevisionSchema.parse({
    ...values.revision,
    definition,
  })
  const grant = scheduledTaskGrantSchema.parse({
    ...values.grant,
    model: definition.model,
    maximumRuntimeMs: definition.maximumRuntimeMs,
  })
  return { ...values, revision, grant }
}

describe("Den Scheduled Tasks service", () => {
  test("requeues abandoned executions only while retry attempts remain", () => {
    expect(scheduledTaskAbandonmentDisposition({
      attempt: 1,
      maximumAttempts: 2,
      cancelRequested: false,
    })).toBe("requeue")
    expect(scheduledTaskAbandonmentDisposition({
      attempt: 2,
      maximumAttempts: 2,
      cancelRequested: false,
    })).toBe("ambiguous")
    expect(scheduledTaskAbandonmentDisposition({
      attempt: 1,
      maximumAttempts: 2,
      cancelRequested: true,
    })).toBe("ambiguous")
    expect(scheduledTaskRetryNotBefore(5_000, 30_000)).toBe(35_000)
    expect(denScheduledTaskDispatchDeadline({
      queuedAt: 5_000,
      scheduledFor: 5_000,
      reviewedGraceMs: 0,
    })).toBe(65_000)
    expect(denScheduledTaskDispatchDeadline({
      queuedAt: 59_000,
      scheduledFor: 5_000,
      reviewedGraceMs: 60_000,
    })).toBe(119_000)
  })

  test("recovers worker-scoped abandoned executions before polling the queue", async () => {
    const values = fixture()
    const calls: string[] = []
    const repository = fakeRepository({
      async recoverAbandonedExecutions(input) {
        expect(input).toEqual({ now: 4_000, workerId: values.workerId })
        calls.push("recover")
        return { requeuedRunIds: [], terminalRunIds: [] }
      },
      async findQueuedExecution(input) {
        expect(input).toEqual({ workerId: values.workerId, now: 4_000 })
        calls.push("find")
        return null
      },
    })
    const service = createDenScheduledTaskService({
      repository,
      now: () => 4_000,
    })

    expect(await service.claim(values.workerId)).toBeNull()
    expect(calls).toEqual(["recover", "find"])
  })

  test("recovers globally abandoned executions before selecting due tasks", async () => {
    const calls: string[] = []
    const repository = fakeRepository({
      async recoverAbandonedExecutions(input) {
        expect(input).toEqual({ now: 5_000, limit: 7 })
        calls.push("recover")
        return { requeuedRunIds: [], terminalRunIds: [] }
      },
      async nextDueAt() {
        return null
      },
    })
    const service = createDenScheduledTaskService({
      repository,
      listDueTasks: async () => {
        calls.push("list")
        return []
      },
    })

    await service.tick({ now: 5_000, source: "cron", batchSize: 7 })
    expect(calls).toEqual(["recover", "list"])
  })

  test("enables and pauses a reviewed recurring task without requiring a stopped worker to be awake", async () => {
    const values = recurringFixture()
    const transitions: Array<Parameters<DenScheduledTaskRepository["setOwnedScheduleState"]>[0]> = []
    const repository = fakeRepository({
      async getOwnedTask() {
        return {
          task: values.task,
          draftRevision: values.revision,
          activeRevision: values.revision,
          grant: values.grant,
        }
      },
      async setOwnedScheduleState(input) {
        transitions.push(input)
        return scheduledTaskSchema.parse({
          ...values.task,
          state: input.state,
          enabled: input.enabled,
          nextRunAt: input.nextDueAt,
          updatedAt: input.now,
        })
      },
    })
    const service = createDenScheduledTaskService({
      repository,
      now: () => 0,
      validateAuthority: async () => ({
        ok: false,
        code: "worker-stopped",
        message: "wakeable",
      }),
    })

    const enabled = await service.enable({
      organizationId: values.organizationId,
      memberId: values.memberId,
      taskId: values.taskId,
    })
    expect(enabled.enabled).toBe(true)
    expect(transitions[0]?.nextDueAt).toBe(60_000)
    expect(transitions[0]?.preserveExistingDue).toBe(true)

    const paused = await service.pause({
      organizationId: values.organizationId,
      memberId: values.memberId,
      taskId: values.taskId,
    })
    expect(paused.enabled).toBe(false)
    expect(transitions[1]).toMatchObject({
      state: "paused",
      enabled: false,
      nextDueAt: null,
      preserveExistingDue: false,
    })
  })

  test("rejects enabling a manual task", async () => {
    const values = fixture()
    const service = createDenScheduledTaskService({
      repository: fakeRepository({
        async getOwnedTask() {
          return {
            task: values.task,
            draftRevision: values.revision,
            activeRevision: values.revision,
            grant: values.grant,
          }
        },
      }),
    })

    await expect(service.enable({
      organizationId: values.organizationId,
      memberId: values.memberId,
      taskId: values.taskId,
    })).rejects.toMatchObject({ code: "manual_only" })
  })

  test("atomically queues the exact due occurrence and wakes its stopped reviewed worker", async () => {
    const values = recurringFixture()
    const scheduledFor = 60_000
    const wakes: string[] = []
    let enqueued = false
    const repository = fakeRepository({
      async getOwnedTask() {
        return {
          task: { ...values.task, state: "enabled", enabled: true, nextRunAt: scheduledFor },
          draftRevision: values.revision,
          activeRevision: values.revision,
          grant: values.grant,
        }
      },
      async enqueueScheduledOccurrence(input) {
        enqueued = true
        expect(input.expectedDueAt).toBe(scheduledFor)
        expect(input.runRow.trigger).toBe("scheduled")
        return { kind: "overlap", run: {} as never }
      },
      async nextDueAt() { return scheduledFor },
    })
    const service = createDenScheduledTaskService({
      repository,
      listDueTasks: async () => [{
        id: values.taskId,
        organization_id: values.organizationId,
        owner_member_id: values.memberId,
        execution_member_id: values.memberId,
        worker_id: values.workerId,
        workspace_id: "workspace-1",
        state: "enabled",
        enabled: true,
        draft_revision_id: values.revision.id,
        active_revision_id: values.revision.id,
        active_grant_id: values.grant.id,
        active_run_id: null,
        next_due_at: new Date(scheduledFor),
        needs_attention: null,
        deleted_at: null,
        created_at: new Date(0),
        updated_at: new Date(0),
      }],
      validateAuthority: async () => ({
        ok: false,
        code: "worker-stopped",
        message: "wakeable",
      }),
      startWorkerWake: (workerId) => { wakes.push(workerId) },
    })

    const result = await service.tick({ now: scheduledFor + 30_000, source: "den-loop" })
    expect(result.selectedTaskIds).toEqual([values.taskId])
    expect(wakes).toEqual([values.workerId])
    expect(enqueued).toBe(true)
  })

  test("records one visible missed occurrence instead of consuming an unavailable due task", async () => {
    const values = recurringFixture()
    const scheduledFor = 60_000
    let missed: Parameters<DenScheduledTaskRepository["recordMissedOccurrence"]>[0] | null = null
    const repository = fakeRepository({
      async getOwnedTask() {
        return {
          task: { ...values.task, state: "enabled", enabled: true, nextRunAt: scheduledFor },
          draftRevision: values.revision,
          activeRevision: values.revision,
          grant: values.grant,
        }
      },
      async recordMissedOccurrence(input) {
        missed = input
        return { kind: "recorded" }
      },
    })
    const service = createDenScheduledTaskService({
      repository,
      listDueTasks: async () => [{
        id: values.taskId,
        organization_id: values.organizationId,
        owner_member_id: values.memberId,
        execution_member_id: values.memberId,
        worker_id: values.workerId,
        workspace_id: "workspace-1",
        state: "enabled",
        enabled: true,
        draft_revision_id: values.revision.id,
        active_revision_id: values.revision.id,
        active_grant_id: values.grant.id,
        active_run_id: null,
        next_due_at: new Date(scheduledFor),
        needs_attention: null,
        deleted_at: null,
        created_at: new Date(0),
        updated_at: new Date(0),
      }],
      validateAuthority: async () => ({
        ok: false,
        code: "worker-unavailable",
        message: "unavailable",
      }),
    })

    await service.tick({ now: scheduledFor + 60_001, source: "den-loop" })
    expect(missed?.runRow.status).toBe("missed")
    expect(missed?.runRow.trigger).toBe("recovery")
    expect(missed?.attention.code).toBe("missed-occurrence")
  })

  test("revalidates authority and queues a run-once request with the reviewed placement", async () => {
    const values = fixture()
    let queued: Parameters<DenScheduledTaskRepository["enqueueRunOnce"]>[0] | null = null
    let authorityChecks = 0
    const repository = fakeRepository({
      async getOwnedTask() {
        return {
          task: values.task,
          draftRevision: values.revision,
          activeRevision: values.revision,
          grant: values.grant,
        }
      },
      async enqueueRunOnce(input) {
        queued = input
        return { kind: "overlap" }
      },
    })
    const service = createDenScheduledTaskService({
      repository,
      now: () => 2_000,
      validateAuthority: async () => {
        authorityChecks += 1
        return { ok: true }
      },
    })

    const result = await service.runOnce({
      organizationId: values.organizationId,
      memberId: values.memberId,
      taskId: values.taskId,
      nonce: "request-1",
    })

    expect(result.kind).toBe("overlap")
    expect(authorityChecks).toBe(1)
    expect(queued?.runRow.worker_id).toBe(values.workerId)
    expect(queued?.runRow.placement).toEqual(values.revision.definition.placement)
    expect(queued?.runRow.idempotency_key).toContain("request-1")
  })

  test("queues run once and wakes a stopped reviewed cloud worker", async () => {
    const values = fixture()
    const wakes: string[] = []
    const repository = fakeRepository({
      async getOwnedTask() {
        return {
          task: values.task,
          draftRevision: values.revision,
          activeRevision: values.revision,
          grant: values.grant,
        }
      },
      async enqueueRunOnce() { return { kind: "overlap" } },
    })
    const service = createDenScheduledTaskService({
      repository,
      validateAuthority: async () => ({
        ok: false,
        code: "worker-stopped",
        message: "wakeable",
      }),
      startWorkerWake: (workerId) => { wakes.push(workerId) },
    })

    expect((await service.runOnce({
      organizationId: values.organizationId,
      memberId: values.memberId,
      taskId: values.taskId,
      nonce: "request-stopped",
    })).kind).toBe("overlap")
    expect(wakes).toEqual([values.workerId])
  })

  test("derives grantor identity and persists only a currently valid reviewed grant", async () => {
    const values = fixture()
    let activated: Parameters<DenScheduledTaskRepository["activateGrant"]>[0] | null = null
    const repository = fakeRepository({
      async getOwnedTask() {
        return {
          task: { ...values.task, state: "draft", activeRevisionId: null, activeGrantId: null },
          draftRevision: { ...values.revision, reviewedAt: null, reviewedBy: null },
          activeRevision: null,
          grant: null,
        }
      },
      async activateGrant(input) {
        activated = input
        return true
      },
    })
    const service = createDenScheduledTaskService({
      repository,
      now: () => 3_000,
      validateAuthority: async () => ({ ok: true }),
    })

    const grant = await service.review({
      organizationId: values.organizationId,
      memberId: values.memberId,
      taskId: values.taskId,
      review: {
        expectedRevisionId: values.revision.id,
        filesystemScope: { kind: "den-worker-relative-roots", roots: ["."] },
        authorizedWorkspaceRoots: [],
        capabilityIds: ["workspace.files.read"],
        actionClasses: ["read"],
        filesystem: { read: true, write: false },
        maximumRuntimeMs: 60_000,
        model: values.revision.definition.model,
        expiresAt: null,
      },
    })

    expect(grant.grantor).toBe(values.memberId)
    expect(grant.authorizedWorkspaceRoots).toEqual([])
    expect(grant.filesystemScope).toEqual({ kind: "den-worker-relative-roots", roots: ["."] })
    expect(activated?.grantRow.grant).toEqual(grant)
  })

  test("fails closed when current execution authority is no longer valid", async () => {
    const values = fixture()
    let enqueued = false
    const repository = fakeRepository({
      async getOwnedTask() {
        return {
          task: values.task,
          draftRevision: values.revision,
          activeRevision: values.revision,
          grant: values.grant,
        }
      },
      async enqueueRunOnce() {
        enqueued = true
        return { kind: "overlap" }
      },
    })
    const service = createDenScheduledTaskService({
      repository,
      validateAuthority: async () => ({
        ok: false,
        code: "worker-unavailable",
        message: "worker is no longer healthy",
      }),
    })

    await expect(service.runOnce({
      organizationId: values.organizationId,
      memberId: values.memberId,
      taskId: values.taskId,
      nonce: "request-2",
    })).rejects.toMatchObject({ code: "authority_unavailable" })
    expect(enqueued).toBe(false)
  })
})
