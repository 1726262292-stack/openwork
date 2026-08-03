import { beforeAll, describe, expect, test } from "bun:test"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { and, eq } from "@openwork-ee/den-db/drizzle"
import { WorkerTable, WorkerTokenTable } from "@openwork-ee/den-db/schema"
import {
  scheduledTaskDefinitionSchema,
  scheduledTaskGrantSchema,
  scheduledTaskOccurrenceIdentity,
  scheduledTaskPlacementIdentity,
  scheduledTaskPlacementSchema,
  scheduledTaskRevisionSchema,
} from "@openwork/scheduled-tasks"
import { verifyScheduledTaskRepositoryConformance } from "@openwork/scheduled-tasks/testing"

const mysqlUrl = process.env.DEN_SCHEDULED_TASK_MYSQL_TEST_URL
const mysqlDescribe = mysqlUrl ? describe : describe.skip

let repository: typeof import("../src/scheduled-tasks/repository.js")["databaseDenScheduledTaskRepository"]
let database: typeof import("../src/db.js")["db"]
let getOrCreateExecutionToken: typeof import("../src/scheduled-tasks/security.js")["getOrCreateDenScheduledTaskExecutionToken"]
let createScopedRepository: typeof import("../src/scheduled-tasks/portable-repository.js")["createScopedDenScheduledTaskRepository"]

beforeAll(async () => {
  if (!mysqlUrl) return
  process.env.DATABASE_URL = mysqlUrl
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
  repository = (await import("../src/scheduled-tasks/repository.js"))
    .databaseDenScheduledTaskRepository
  database = (await import("../src/db.js")).db
  getOrCreateExecutionToken = (await import("../src/scheduled-tasks/security.js"))
    .getOrCreateDenScheduledTaskExecutionToken
  createScopedRepository = (await import("../src/scheduled-tasks/portable-repository.js"))
    .createScopedDenScheduledTaskRepository
})

function fixture() {
  const organizationId = createDenTypeId("organization")
  const otherOrganizationId = createDenTypeId("organization")
  const memberId = createDenTypeId("member")
  const otherMemberId = createDenTypeId("member")
  const workerId = createDenTypeId("worker")
  const taskId = createDenTypeId("scheduledTask")
  const revisionId = createDenTypeId("scheduledTaskRevision")
  const grantId = createDenTypeId("scheduledTaskGrant")
  const placement = scheduledTaskPlacementSchema.parse({
    target: {
      kind: "den-worker",
      organizationId,
      workerId,
      workspaceId: "mysql-workspace",
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
    name: "MySQL Scheduled Task",
    description: "",
    prompt: "Read the workspace.",
    workspaceId: "mysql-workspace",
    placement,
    schedule: { kind: "daily", hour: 0, minute: 1, timezone: "UTC" },
    model: { providerId: null, modelId: null, agent: null },
    maximumRuntimeMs: 60_000,
    overlapPolicy: "skip",
    retryPolicy: { maximumAttempts: 2, delayMs: 30_000 },
    missedRunPolicy: { kind: "skip", graceMs: 60_000, maximumRecoverableOccurrences: 1 },
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
    workspaceId: definition.workspaceId,
    placement,
    placementIdentity: scheduledTaskPlacementIdentity(placement),
    filesystemScope: { kind: "den-worker-relative-roots", roots: ["."] },
    authorizedWorkspaceRoots: [],
    capabilityIds: ["workspace.files.read"],
    actionClasses: ["read"],
    filesystem: { read: true, write: false },
    maximumRuntimeMs: definition.maximumRuntimeMs,
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
  return {
    organizationId,
    otherOrganizationId,
    memberId,
    otherMemberId,
    workerId,
    taskId,
    revisionId,
    grantId,
    placement,
    definition,
    revision,
    grant,
  }
}

async function persistReviewedTask(values: ReturnType<typeof fixture>) {
  await repository.createDraft({
    revisionRow: {
      id: values.revisionId,
      organization_id: values.organizationId,
      task_id: values.taskId,
      revision: 1,
      definition: values.definition,
      placement: values.placement,
      placement_identity: scheduledTaskPlacementIdentity(values.placement),
      created_by_member_id: values.memberId,
    },
    taskRow: {
      id: values.taskId,
      organization_id: values.organizationId,
      owner_member_id: values.memberId,
      execution_member_id: values.memberId,
      worker_id: values.workerId,
      workspace_id: values.definition.workspaceId,
      state: "draft",
      enabled: false,
      draft_revision_id: values.revisionId,
    },
  })
  expect(await repository.activateGrant({
    organizationId: values.organizationId,
    ownerMemberId: values.memberId,
    taskId: values.taskId,
    expectedRevisionId: values.revisionId,
    reviewedRevision: values.revision,
    grantRow: {
      id: values.grantId,
      organization_id: values.organizationId,
      task_id: values.taskId,
      task_revision_id: values.revisionId,
      revision: 1,
      grant: values.grant,
      placement_identity: scheduledTaskPlacementIdentity(values.placement),
      reviewed_by_member_id: values.memberId,
      reviewed_at: new Date(1_000),
    },
  })).toBe(true)
}

mysqlDescribe("Den Scheduled Tasks MySQL repository", () => {
  test("passes the same portable repository contract as local SQLite", async () => {
    const values = fixture()
    const result = await verifyScheduledTaskRepositoryConformance({
      createRepository: () => createScopedRepository({
        organizationId: values.organizationId,
        ownerMemberId: values.memberId,
      }),
      fixtures: {
        ids: {
          taskId: createDenTypeId("scheduledTask"),
          revision1Id: createDenTypeId("scheduledTaskRevision"),
          revision2Id: createDenTypeId("scheduledTaskRevision"),
          reviewedRevisionId: createDenTypeId("scheduledTaskRevision"),
          grantId: createDenTypeId("scheduledTaskGrant"),
          run1Id: createDenTypeId("scheduledTaskRun"),
          run1OverlapTemplateId: createDenTypeId("scheduledTaskRun"),
          run1DuplicateId: createDenTypeId("scheduledTaskRun"),
          run2Id: createDenTypeId("scheduledTaskRun"),
          run2OverlapId: createDenTypeId("scheduledTaskRun"),
          attemptId: createDenTypeId("scheduledTaskAttempt"),
        },
        placement: values.placement,
        filesystemScope: { kind: "den-worker-relative-roots", roots: ["."] },
        authorizedWorkspaceRoots: [],
        isolationScope: {
          kind: "scheduler-owner",
          schedulerOwner: "den",
          organizationId: values.otherOrganizationId,
        },
        actorId: values.memberId,
        revokerId: values.memberId,
        sessionId: "mysql-conformance-session",
      },
    })
    expect(result.checked).toEqual([
      "task-and-initial-revision",
      "immutable-revisions",
      "reviewed-authority-binding",
      "due-selection",
      "runtime-scope-isolation",
      "atomic-idempotent-claim",
      "atomic-overlap-policy",
      "attempt-ledger",
      "durable-terminal-run",
      "grant-revocation",
    ])
  })

  test("keeps schedule lifecycle and missed-occurrence claims atomic and tenant-scoped", async () => {
    const values = fixture()
    await persistReviewedTask(values)

    const scheduleInput = {
      organizationId: values.organizationId,
      ownerMemberId: values.memberId,
      taskId: values.taskId,
      expectedRevisionId: values.revisionId,
      expectedGrantId: values.grantId,
      state: "enabled" as const,
      enabled: true,
      nextDueAt: 60_000,
      preserveExistingDue: true,
      now: 2_000,
    }
    expect((await repository.setOwnedScheduleState(scheduleInput))?.nextRunAt).toBe(60_000)
    expect((await repository.setOwnedScheduleState({
      ...scheduleInput,
      nextDueAt: 120_000,
      now: 3_000,
    }))?.nextRunAt).toBe(60_000)
    expect(await repository.setOwnedScheduleState({
      ...scheduleInput,
      organizationId: values.otherOrganizationId,
    })).toBeNull()
    expect(await repository.setOwnedScheduleState({
      ...scheduleInput,
      ownerMemberId: values.otherMemberId,
    })).toBeNull()

    expect((await repository.setOwnedScheduleState({
      ...scheduleInput,
      state: "paused",
      enabled: false,
      nextDueAt: null,
      preserveExistingDue: false,
      now: 4_000,
    }))?.nextRunAt).toBeNull()
    const scheduledOccurrence = scheduledTaskOccurrenceIdentity({
      taskId: values.taskId,
      taskRevisionId: values.revisionId,
      trigger: "scheduled",
      scheduledFor: 60_000,
    })
    expect((await repository.enqueueScheduledOccurrence({
      organizationId: values.organizationId,
      ownerMemberId: values.memberId,
      taskId: values.taskId,
      expectedDueAt: 60_000,
      nextDueAt: 120_000,
      now: 60_000,
      runRow: {
        id: createDenTypeId("scheduledTaskRun"),
        organization_id: values.organizationId,
        task_id: values.taskId,
        task_revision_id: values.revisionId,
        grant_revision_id: values.grantId,
        owner_member_id: values.memberId,
        execution_member_id: values.memberId,
        worker_id: values.workerId,
        workspace_id: values.definition.workspaceId,
        placement: values.placement,
        occurrence_id: scheduledOccurrence.occurrenceId,
        trigger: "scheduled",
        status: "scheduled",
        scheduled_for: new Date(60_000),
        claimed_at: new Date(60_000),
        dispatch_deadline: new Date(120_000),
        idempotency_key: scheduledOccurrence.idempotencyKey,
        attempt_count: 0,
        bounded_usage: { inputTokens: null, outputTokens: null, costMicros: null },
      },
    })).kind).toBe("stale")

    await repository.setOwnedScheduleState({ ...scheduleInput, now: 5_000 })
    const recoveryOccurrence = scheduledTaskOccurrenceIdentity({
      taskId: values.taskId,
      taskRevisionId: values.revisionId,
      trigger: "recovery",
      scheduledFor: 60_000,
    })
    const firstRunId = createDenTypeId("scheduledTaskRun")
    const missed = (runId: typeof firstRunId) => {
      const attention = {
        code: "missed-occurrence" as const,
        message: "The occurrence missed its grace period.",
        repairable: true,
        runId,
        sessionId: null,
        createdAt: 120_001,
      }
      return repository.recordMissedOccurrence({
        organizationId: values.organizationId,
        ownerMemberId: values.memberId,
        taskId: values.taskId,
        expectedDueAt: 60_000,
        attention,
        runRow: {
          id: runId,
          organization_id: values.organizationId,
          task_id: values.taskId,
          task_revision_id: values.revisionId,
          grant_revision_id: values.grantId,
          owner_member_id: values.memberId,
          execution_member_id: values.memberId,
          worker_id: values.workerId,
          workspace_id: values.definition.workspaceId,
          placement: values.placement,
          occurrence_id: recoveryOccurrence.occurrenceId,
          trigger: "recovery",
          status: "missed",
          scheduled_for: new Date(60_000),
          claimed_at: new Date(120_001),
          dispatch_deadline: new Date(120_001),
          completed_at: new Date(120_001),
          duration_ms: 0,
          idempotency_key: recoveryOccurrence.idempotencyKey,
          attempt_count: 0,
          bounded_usage: { inputTokens: null, outputTokens: null, costMicros: null },
          needs_attention: attention,
        },
      })
    }
    const results = await Promise.all([
      missed(firstRunId),
      missed(createDenTypeId("scheduledTaskRun")),
    ])
    expect(results.map((result) => result.kind).sort()).toEqual(["duplicate", "recorded"])
    expect((await repository.getOwnedTask({
      organizationId: values.organizationId,
      ownerMemberId: values.memberId,
      taskId: values.taskId,
    }))?.task).toMatchObject({
      state: "needs-attention",
      enabled: false,
      nextRunAt: null,
      needsAttention: { code: "missed-occurrence" },
    })
  })

  test("fences retries by the reviewed delay and pauses after an ambiguous attempt ceiling", async () => {
    const values = fixture()
    await persistReviewedTask(values)
    const runId = createDenTypeId("scheduledTaskRun")
    const occurrence = scheduledTaskOccurrenceIdentity({
      taskId: values.taskId,
      taskRevisionId: values.revisionId,
      trigger: "manual",
      scheduledFor: null,
      nonce: "mysql-retry-proof",
    })
    expect((await repository.enqueueRunOnce({
      organizationId: values.organizationId,
      ownerMemberId: values.memberId,
      taskId: values.taskId,
      runRow: {
        id: runId,
        organization_id: values.organizationId,
        task_id: values.taskId,
        task_revision_id: values.revisionId,
        grant_revision_id: values.grantId,
        owner_member_id: values.memberId,
        execution_member_id: values.memberId,
        worker_id: values.workerId,
        workspace_id: values.definition.workspaceId,
        placement: values.placement,
        occurrence_id: occurrence.occurrenceId,
        trigger: "manual",
        status: "scheduled",
        claimed_at: new Date(10_000),
        dispatch_deadline: new Date(70_000),
        idempotency_key: occurrence.idempotencyKey,
        attempt_count: 0,
        bounded_usage: { inputTokens: null, outputTokens: null, costMicros: null },
      },
    })).kind).toBe("queued")

    expect((await repository.claimExecution({
      workerId: values.workerId,
      runId,
      now: 10_000,
      leaseDurationMs: 1_000,
    }))?.attempt.attempt).toBe(1)
    expect(await repository.recoverAbandonedExecutions({
      now: 11_001,
      workerId: values.workerId,
    })).toEqual({ requeuedRunIds: [runId], terminalRunIds: [] })
    expect(await repository.findQueuedExecution({
      workerId: values.workerId,
      now: 40_999,
    })).toBeNull()
    expect((await repository.findQueuedExecution({
      workerId: values.workerId,
      now: 41_001,
    }))?.run.id).toBe(runId)

    expect((await repository.claimExecution({
      workerId: values.workerId,
      runId,
      now: 41_001,
      leaseDurationMs: 1_000,
    }))?.attempt.attempt).toBe(2)
    expect(await repository.recoverAbandonedExecutions({
      now: 42_002,
      workerId: values.workerId,
    })).toEqual({ requeuedRunIds: [], terminalRunIds: [runId] })
    expect((await repository.getOwnedTask({
      organizationId: values.organizationId,
      ownerMemberId: values.memberId,
      taskId: values.taskId,
    }))?.task).toMatchObject({
      state: "needs-attention",
      enabled: false,
      nextRunAt: null,
      needsAttention: { code: "approval-required", runId },
    })
  })

  test("serializes execution-token creation per worker", async () => {
    const workerId = createDenTypeId("worker")
    await database.insert(WorkerTable).values({
      id: workerId,
      org_id: createDenTypeId("organization"),
      name: "Scheduled Tasks token proof",
      destination: "cloud",
      status: "healthy",
      sandbox_backend: "cloud-instance",
    })

    const tokens = await Promise.all([
      getOrCreateExecutionToken(workerId),
      getOrCreateExecutionToken(workerId),
      getOrCreateExecutionToken(workerId),
    ])
    expect(new Set(tokens).size).toBe(1)
    const rows = await database
      .select({ id: WorkerTokenTable.id })
      .from(WorkerTokenTable)
      .where(and(
        eq(WorkerTokenTable.worker_id, workerId),
        eq(WorkerTokenTable.scope, "execution"),
      ))
    expect(rows).toHaveLength(1)
  })

  test("terminalizes an unclaimed manual run after the reviewed grace period", async () => {
    const values = fixture()
    await persistReviewedTask(values)
    const runId = createDenTypeId("scheduledTaskRun")
    const occurrence = scheduledTaskOccurrenceIdentity({
      taskId: values.taskId,
      taskRevisionId: values.revisionId,
      trigger: "manual",
      scheduledFor: null,
      nonce: "mysql-unclaimed-manual-proof",
    })
    expect((await repository.enqueueRunOnce({
      organizationId: values.organizationId,
      ownerMemberId: values.memberId,
      taskId: values.taskId,
      runRow: {
        id: runId,
        organization_id: values.organizationId,
        task_id: values.taskId,
        task_revision_id: values.revisionId,
        grant_revision_id: values.grantId,
        owner_member_id: values.memberId,
        execution_member_id: values.memberId,
        worker_id: values.workerId,
        workspace_id: values.definition.workspaceId,
        placement: values.placement,
        occurrence_id: occurrence.occurrenceId,
        trigger: "manual",
        status: "scheduled",
        scheduled_for: null,
        claimed_at: new Date(10_000),
        dispatch_deadline: new Date(70_000),
        idempotency_key: occurrence.idempotencyKey,
        attempt_count: 0,
        bounded_usage: { inputTokens: null, outputTokens: null, costMicros: null },
      },
    })).kind).toBe("queued")

    expect(await repository.recoverAbandonedExecutions({
      now: 70_001,
      workerId: values.workerId,
    })).toEqual({ requeuedRunIds: [], terminalRunIds: [runId] })
    expect((await repository.getOwnedTask({
      organizationId: values.organizationId,
      ownerMemberId: values.memberId,
      taskId: values.taskId,
    }))?.task).toMatchObject({
      state: "needs-attention",
      enabled: false,
      needsAttention: { code: "missed-occurrence", runId },
    })
  })
})
