import { createHash, randomBytes } from "node:crypto"
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  or,
} from "@openwork-ee/den-db/drizzle"
import {
  ScheduledTaskArtifactTable,
  ScheduledTaskAttemptTable,
  ScheduledTaskEventTable,
  ScheduledTaskGrantTable,
  ScheduledTaskRevisionTable,
  ScheduledTaskRunTable,
  ScheduledTaskTable,
} from "@openwork-ee/den-db/schema"
import {
  createDenTypeId,
  type DenTypeId,
} from "@openwork-ee/utils/typeid"
import {
  scheduledTaskAttemptSchema,
  scheduledTaskExecutionEventSchema,
  scheduledTaskExecutionResultSchema,
  scheduledTaskGrantSchema,
  scheduledTaskRevisionSchema,
  scheduledTaskRunSchema,
  scheduledTaskSchema,
  type ScheduledTask,
  type ScheduledTaskArtifactReference,
  type ScheduledTaskAttempt,
  type ScheduledTaskExecutionEvent,
  type ScheduledTaskExecutionResult,
  type ScheduledTaskGrant,
  type ScheduledTaskNeedsAttention,
  type ScheduledTaskRevision,
  type ScheduledTaskRun,
  type ScheduledTaskRunReceipt,
  type ScheduledTaskState,
  type ScheduledTaskTypedError,
} from "@openwork/types/scheduled-tasks"
import type { ScheduledTaskListItem } from "@openwork/scheduled-tasks"
import { db } from "../db.js"

export type DenScheduledTaskOrganizationId = DenTypeId<"organization">
export type DenScheduledTaskMemberId = DenTypeId<"member">
export type DenScheduledTaskWorkerId = DenTypeId<"worker">
export type DenScheduledTaskId = DenTypeId<"scheduledTask">
export type DenScheduledTaskRunId = DenTypeId<"scheduledTaskRun">
export type DenScheduledTaskAttemptId = DenTypeId<"scheduledTaskAttempt">

type TaskRow = typeof ScheduledTaskTable.$inferSelect
type RevisionRow = typeof ScheduledTaskRevisionTable.$inferSelect
type GrantRow = typeof ScheduledTaskGrantTable.$inferSelect
type RunRow = typeof ScheduledTaskRunTable.$inferSelect
type AttemptRow = typeof ScheduledTaskAttemptTable.$inferSelect

const EMPTY_USAGE = {
  inputTokens: null,
  outputTokens: null,
  costMicros: null,
}

function toMillis(value: Date) {
  return value.getTime()
}

function nullableMillis(value: Date | null) {
  return value ? value.getTime() : null
}

export function taskFromRow(row: TaskRow): ScheduledTask {
  return scheduledTaskSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    state: row.state,
    enabled: row.enabled,
    draftRevisionId: row.draft_revision_id,
    activeRevisionId: row.active_revision_id,
    activeGrantId: row.active_grant_id,
    nextRunAt: nullableMillis(row.next_due_at),
    needsAttention: row.needs_attention ?? null,
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at),
    deletedAt: nullableMillis(row.deleted_at),
  })
}

export function revisionFromRow(row: RevisionRow): ScheduledTaskRevision {
  return scheduledTaskRevisionSchema.parse({
    id: row.id,
    taskId: row.task_id,
    revision: row.revision,
    definition: row.definition,
    createdAt: toMillis(row.created_at),
    createdBy: row.created_by_member_id,
    reviewedAt: nullableMillis(row.reviewed_at),
    reviewedBy: row.reviewed_by_member_id,
  })
}

export function grantFromRow(row: GrantRow): ScheduledTaskGrant {
  return scheduledTaskGrantSchema.parse({
    ...row.grant,
    expiresAt: nullableMillis(row.expires_at),
    revokedAt: nullableMillis(row.revoked_at),
    revocationReason: row.revocation_reason,
  })
}

export function runFromRow(
  row: RunRow,
  artifacts: ScheduledTaskArtifactReference[] = [],
): ScheduledTaskRun {
  return scheduledTaskRunSchema.parse({
    id: row.id,
    taskId: row.task_id,
    taskRevisionId: row.task_revision_id,
    grantRevisionId: row.grant_revision_id,
    placement: row.placement,
    occurrenceId: row.occurrence_id,
    trigger: row.trigger,
    status: row.status,
    scheduledFor: nullableMillis(row.scheduled_for),
    claimedAt: toMillis(row.claimed_at),
    startedAt: nullableMillis(row.started_at),
    completedAt: nullableMillis(row.completed_at),
    durationMs: row.duration_ms,
    idempotencyKey: row.idempotency_key,
    sessionId: row.session_id,
    attemptCount: row.attempt_count,
    boundedUsage: row.bounded_usage,
    error: row.error ?? null,
    needsAttention: row.needs_attention ?? null,
    artifacts,
    cancelRequestedAt: nullableMillis(row.cancel_requested_at),
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at),
  })
}

export function attemptFromRow(row: AttemptRow): ScheduledTaskAttempt {
  return scheduledTaskAttemptSchema.parse({
    id: row.id,
    runId: row.run_id,
    attempt: row.attempt,
    status: row.status,
    sessionId: row.session_id,
    startedAt: toMillis(row.started_at),
    completedAt: nullableMillis(row.completed_at),
    error: row.error ?? null,
  })
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function leaseToken() {
  return randomBytes(32).toString("base64url")
}

export function hashScheduledTaskLeaseToken(token: string) {
  return createHash("sha256").update(token).digest("base64url")
}

function terminalAttemptStatus(status: AttemptRow["status"]) {
  return !["starting", "running"].includes(status)
}

export function isNextScheduledTaskEventSequence(input: {
  sequence: number
  latestSequence: number | null
}) {
  return input.sequence === (input.latestSequence ?? 0) + 1
}

export type DenScheduledTaskAbandonmentDisposition = "requeue" | "ambiguous"

export function scheduledTaskAbandonmentDisposition(input: {
  attempt: number
  maximumAttempts: number
  cancelRequested: boolean
}): DenScheduledTaskAbandonmentDisposition {
  if (input.cancelRequested) return "ambiguous"
  return input.attempt < input.maximumAttempts ? "requeue" : "ambiguous"
}

export function scheduledTaskRetryNotBefore(now: number, delayMs: number) {
  return now + Math.max(0, Math.floor(delayMs))
}

const ABANDONED_EXECUTION_ERROR: ScheduledTaskTypedError = {
  code: "ambiguous-outcome",
  message: "The worker lease expired before Den could reconcile the execution outcome.",
  retryable: true,
  ambiguous: true,
}

const QUEUED_CANCELLATION_ERROR: ScheduledTaskTypedError = {
  code: "cancellation-failed",
  message: "The run was cancelled before a worker claimed it.",
  retryable: false,
  ambiguous: false,
}

export type DenScheduledTaskBundle = {
  task: ScheduledTask
  draftRevision: ScheduledTaskRevision
  activeRevision: ScheduledTaskRevision | null
  grant: ScheduledTaskGrant | null
}

export type DenScheduledTaskExecutionBundle = {
  taskRow: TaskRow
  task: ScheduledTask
  revision: ScheduledTaskRevision
  grant: ScheduledTaskGrant
  run: ScheduledTaskRun
}

export type DenScheduledTaskClaim = {
  run: ScheduledTaskRun
  revision: ScheduledTaskRevision
  grant: ScheduledTaskGrant
  attempt: ScheduledTaskAttempt
  lease: {
    token: string
    generation: number
    expiresAt: number
  }
}

export type DenScheduledTaskLeaseFailure =
  | "attempt_not_found"
  | "stale_lease"
  | "lease_expired"
  | "conflicting_replay"

export class DenScheduledTaskRepositoryError extends Error {
  constructor(readonly code: DenScheduledTaskLeaseFailure | "task_not_found" | "run_not_found") {
    super(code)
  }
}

export interface DenScheduledTaskRepository {
  createDraft(input: {
    taskRow: typeof ScheduledTaskTable.$inferInsert
    revisionRow: typeof ScheduledTaskRevisionTable.$inferInsert
  }): Promise<void>
  listOwnedTasks(input: {
    organizationId: DenScheduledTaskOrganizationId
    ownerMemberId: DenScheduledTaskMemberId
  }): Promise<ScheduledTaskListItem[]>
  getOwnedTask(input: {
    organizationId: DenScheduledTaskOrganizationId
    ownerMemberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
  }): Promise<DenScheduledTaskBundle | null>
  activateGrant(input: {
    organizationId: DenScheduledTaskOrganizationId
    ownerMemberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
    expectedRevisionId: DenTypeId<"scheduledTaskRevision">
    reviewedRevision: ScheduledTaskRevision
    grantRow: typeof ScheduledTaskGrantTable.$inferInsert
  }): Promise<boolean>
  setOwnedScheduleState(input: {
    organizationId: DenScheduledTaskOrganizationId
    ownerMemberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
    expectedRevisionId: DenTypeId<"scheduledTaskRevision">
    expectedGrantId: DenTypeId<"scheduledTaskGrant">
    state: Extract<ScheduledTaskState, "enabled" | "paused">
    enabled: boolean
    nextDueAt: number | null
    preserveExistingDue: boolean
    now: number
  }): Promise<ScheduledTask | null>
  recordMissedOccurrence(input: {
    organizationId: DenScheduledTaskOrganizationId
    ownerMemberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
    expectedDueAt: number
    runRow: typeof ScheduledTaskRunTable.$inferInsert
    attention: ScheduledTaskNeedsAttention
  }): Promise<{ kind: "recorded" | "duplicate" | "stale"; run?: ScheduledTaskRun }>
  enqueueRunOnce(input: {
    organizationId: DenScheduledTaskOrganizationId
    ownerMemberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
    runRow: typeof ScheduledTaskRunTable.$inferInsert
  }): Promise<{ kind: "queued" | "duplicate"; run: ScheduledTaskRun } | { kind: "overlap" }>
  enqueueScheduledOccurrence(input: {
    organizationId: DenScheduledTaskOrganizationId
    ownerMemberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
    expectedDueAt: number
    nextDueAt: number | null
    runRow: typeof ScheduledTaskRunTable.$inferInsert
    now: number
  }): Promise<
    | { kind: "queued" | "duplicate" | "overlap"; run: ScheduledTaskRun }
    | { kind: "stale" }
  >
  getOwnedRunReceipt(input: {
    organizationId: DenScheduledTaskOrganizationId
    ownerMemberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
    runId: DenScheduledTaskRunId
  }): Promise<ScheduledTaskRunReceipt | null>
  requestCancellation(input: {
    organizationId: DenScheduledTaskOrganizationId
    ownerMemberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
    runId: DenScheduledTaskRunId
    now: number
  }): Promise<ScheduledTaskRun | null>
  findQueuedExecution(input: {
    workerId: DenScheduledTaskWorkerId
    now: number
  }): Promise<DenScheduledTaskExecutionBundle | null>
  recoverAbandonedExecutions(input: {
    now: number
    workerId?: DenScheduledTaskWorkerId
    limit?: number
  }): Promise<{
    requeuedRunIds: DenScheduledTaskRunId[]
    terminalRunIds: DenScheduledTaskRunId[]
  }>
  claimExecution(input: {
    workerId: DenScheduledTaskWorkerId
    runId: DenScheduledTaskRunId
    now: number
    leaseDurationMs: number
  }): Promise<DenScheduledTaskClaim | null>
  heartbeat(input: {
    workerId: DenScheduledTaskWorkerId
    attemptId: DenScheduledTaskAttemptId
    leaseToken: string
    sessionId?: string | null
    now: number
    leaseDurationMs: number
  }): Promise<{ leaseExpiresAt: number; cancelRequestedAt: number | null }>
  appendEvent(input: {
    workerId: DenScheduledTaskWorkerId
    attemptId: DenScheduledTaskAttemptId
    leaseToken: string
    sequence: number
    event: ScheduledTaskExecutionEvent
    now: number
  }): Promise<{ duplicate: boolean }>
  complete(input: {
    workerId: DenScheduledTaskWorkerId
    attemptId: DenScheduledTaskAttemptId
    leaseToken: string
    result: ScheduledTaskExecutionResult
    now: number
  }): Promise<{ duplicate: boolean; run: ScheduledTaskRun }>
  nextDueAt(): Promise<number | null>
}

async function artifactsForRun(runId: DenScheduledTaskRunId) {
  const rows = await db
    .select({ reference: ScheduledTaskArtifactTable.reference })
    .from(ScheduledTaskArtifactTable)
    .where(eq(ScheduledTaskArtifactTable.run_id, runId))
    .orderBy(asc(ScheduledTaskArtifactTable.created_at))
  return rows.map((row) => row.reference)
}

async function attemptsForRun(runId: DenScheduledTaskRunId) {
  const rows = await db
    .select()
    .from(ScheduledTaskAttemptTable)
    .where(eq(ScheduledTaskAttemptTable.run_id, runId))
    .orderBy(asc(ScheduledTaskAttemptTable.attempt))
  return rows.map(attemptFromRow)
}

async function readBundle(taskRow: TaskRow): Promise<DenScheduledTaskBundle | null> {
  const revisionIds = [
    taskRow.draft_revision_id,
    ...(taskRow.active_revision_id ? [taskRow.active_revision_id] : []),
  ]
  const revisions = await db
    .select()
    .from(ScheduledTaskRevisionTable)
    .where(and(
      eq(ScheduledTaskRevisionTable.organization_id, taskRow.organization_id),
      inArray(ScheduledTaskRevisionTable.id, revisionIds),
    ))
  const draft = revisions.find((row) => row.id === taskRow.draft_revision_id)
  if (!draft) return null
  const active = taskRow.active_revision_id
    ? revisions.find((row) => row.id === taskRow.active_revision_id) ?? null
    : null
  const [grant] = taskRow.active_grant_id
    ? await db
        .select()
        .from(ScheduledTaskGrantTable)
        .where(and(
          eq(ScheduledTaskGrantTable.organization_id, taskRow.organization_id),
          eq(ScheduledTaskGrantTable.id, taskRow.active_grant_id),
        ))
        .limit(1)
    : []
  return {
    task: taskFromRow(taskRow),
    draftRevision: revisionFromRow(draft),
    activeRevision: active ? revisionFromRow(active) : null,
    grant: grant ? grantFromRow(grant) : null,
  }
}

async function assertLiveLease(input: {
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0]
  workerId: DenScheduledTaskWorkerId
  attemptId: DenScheduledTaskAttemptId
  tokenHash: string
  now: Date
  allowTerminalReplay?: boolean
}) {
  const [attempt] = await input.tx
    .select()
    .from(ScheduledTaskAttemptTable)
    .where(and(
      eq(ScheduledTaskAttemptTable.id, input.attemptId),
      eq(ScheduledTaskAttemptTable.worker_id, input.workerId),
    ))
    .for("update")
    .limit(1)
  if (!attempt) throw new DenScheduledTaskRepositoryError("attempt_not_found")
  if (attempt.lease_token_hash !== input.tokenHash) {
    throw new DenScheduledTaskRepositoryError("stale_lease")
  }
  if (terminalAttemptStatus(attempt.status)) {
    if (input.allowTerminalReplay) return attempt
    throw new DenScheduledTaskRepositoryError("stale_lease")
  }
  if (attempt.lease_expires_at.getTime() < input.now.getTime()) {
    throw new DenScheduledTaskRepositoryError("lease_expired")
  }
  return attempt
}

export const databaseDenScheduledTaskRepository: DenScheduledTaskRepository = {
  async createDraft(input) {
    await db.transaction(async (tx) => {
      await tx.insert(ScheduledTaskRevisionTable).values(input.revisionRow)
      await tx.insert(ScheduledTaskTable).values(input.taskRow)
    })
  },

  async listOwnedTasks(input) {
    const tasks = await db
      .select()
      .from(ScheduledTaskTable)
      .where(and(
        eq(ScheduledTaskTable.organization_id, input.organizationId),
        eq(ScheduledTaskTable.owner_member_id, input.ownerMemberId),
        isNull(ScheduledTaskTable.deleted_at),
      ))
      .orderBy(desc(ScheduledTaskTable.updated_at))
    const items: ScheduledTaskListItem[] = []
    for (const taskRow of tasks) {
      const bundle = await readBundle(taskRow)
      if (!bundle) continue
      const [latestRun] = await db
        .select()
        .from(ScheduledTaskRunTable)
        .where(and(
          eq(ScheduledTaskRunTable.organization_id, input.organizationId),
          eq(ScheduledTaskRunTable.task_id, taskRow.id),
        ))
        .orderBy(desc(ScheduledTaskRunTable.created_at))
        .limit(1)
      items.push({
        task: bundle.task,
        revision: bundle.activeRevision ?? bundle.draftRevision,
        ...(bundle.grant ? { grant: bundle.grant } : {}),
        ...(latestRun ? { latestRun: runFromRow(latestRun) } : {}),
      })
    }
    return items
  },

  async getOwnedTask(input) {
    const [taskRow] = await db
      .select()
      .from(ScheduledTaskTable)
      .where(and(
        eq(ScheduledTaskTable.id, input.taskId),
        eq(ScheduledTaskTable.organization_id, input.organizationId),
        eq(ScheduledTaskTable.owner_member_id, input.ownerMemberId),
        isNull(ScheduledTaskTable.deleted_at),
      ))
      .limit(1)
    return taskRow ? readBundle(taskRow) : null
  },

  async activateGrant(input) {
    return db.transaction(async (tx) => {
      const [taskRow] = await tx
        .select()
        .from(ScheduledTaskTable)
        .where(and(
          eq(ScheduledTaskTable.id, input.taskId),
          eq(ScheduledTaskTable.organization_id, input.organizationId),
          eq(ScheduledTaskTable.owner_member_id, input.ownerMemberId),
        ))
        .for("update")
        .limit(1)
      if (!taskRow || taskRow.draft_revision_id !== input.expectedRevisionId) return false
      await tx
        .update(ScheduledTaskRevisionTable)
        .set({
          definition: input.reviewedRevision.definition,
          placement: input.reviewedRevision.definition.placement,
          reviewed_at: new Date(input.reviewedRevision.reviewedAt ?? Date.now()),
          reviewed_by_member_id: input.grantRow.reviewed_by_member_id,
        })
        .where(and(
          eq(ScheduledTaskRevisionTable.id, input.expectedRevisionId),
          eq(ScheduledTaskRevisionTable.organization_id, input.organizationId),
        ))
      await tx.insert(ScheduledTaskGrantTable).values(input.grantRow)
      await tx
        .update(ScheduledTaskTable)
        .set({
          state: "ready",
          enabled: false,
          active_revision_id: input.expectedRevisionId,
          active_grant_id: input.grantRow.id,
          next_due_at: null,
          needs_attention: null,
        })
        .where(eq(ScheduledTaskTable.id, input.taskId))
      return true
    })
  },

  async setOwnedScheduleState(input) {
    return db.transaction(async (tx) => {
      const [taskRow] = await tx
        .select()
        .from(ScheduledTaskTable)
        .where(and(
          eq(ScheduledTaskTable.id, input.taskId),
          eq(ScheduledTaskTable.organization_id, input.organizationId),
          eq(ScheduledTaskTable.owner_member_id, input.ownerMemberId),
          isNull(ScheduledTaskTable.deleted_at),
        ))
        .for("update")
        .limit(1)
      if (
        !taskRow
        || taskRow.active_revision_id !== input.expectedRevisionId
        || taskRow.active_grant_id !== input.expectedGrantId
      ) {
        return null
      }
      const nextDueAt = input.enabled
        && input.preserveExistingDue
        && taskRow.enabled
        && taskRow.next_due_at
        ? taskRow.next_due_at
        : input.nextDueAt === null ? null : new Date(input.nextDueAt)
      await tx
        .update(ScheduledTaskTable)
        .set({
          state: input.state,
          enabled: input.enabled,
          next_due_at: nextDueAt,
          needs_attention: null,
          updated_at: new Date(input.now),
        })
        .where(eq(ScheduledTaskTable.id, input.taskId))
      const [updated] = await tx
        .select()
        .from(ScheduledTaskTable)
        .where(eq(ScheduledTaskTable.id, input.taskId))
        .limit(1)
      return updated ? taskFromRow(updated) : null
    })
  },

  async recordMissedOccurrence(input) {
    return db.transaction(async (tx) => {
      const [taskRow] = await tx
        .select()
        .from(ScheduledTaskTable)
        .where(and(
          eq(ScheduledTaskTable.id, input.taskId),
          eq(ScheduledTaskTable.organization_id, input.organizationId),
          eq(ScheduledTaskTable.owner_member_id, input.ownerMemberId),
          isNull(ScheduledTaskTable.deleted_at),
        ))
        .for("update")
        .limit(1)
      if (!taskRow) return { kind: "stale" as const }
      const [existing] = await tx
        .select()
        .from(ScheduledTaskRunTable)
        .where(and(
          eq(ScheduledTaskRunTable.task_id, input.taskId),
          eq(ScheduledTaskRunTable.idempotency_key, input.runRow.idempotency_key),
        ))
        .limit(1)
      if (existing) {
        return { kind: "duplicate" as const, run: runFromRow(existing) }
      }
      if (
        !taskRow.enabled
        || taskRow.active_run_id
        || taskRow.next_due_at?.getTime() !== input.expectedDueAt
        || taskRow.active_revision_id !== input.runRow.task_revision_id
        || taskRow.active_grant_id !== input.runRow.grant_revision_id
      ) {
        return { kind: "stale" as const }
      }
      await tx.insert(ScheduledTaskRunTable).values(input.runRow)
      await tx
        .update(ScheduledTaskTable)
        .set({
          state: "needs-attention",
          enabled: false,
          next_due_at: null,
          needs_attention: input.attention,
        })
        .where(and(
          eq(ScheduledTaskTable.id, input.taskId),
          eq(ScheduledTaskTable.next_due_at, new Date(input.expectedDueAt)),
        ))
      const [created] = await tx
        .select()
        .from(ScheduledTaskRunTable)
        .where(eq(ScheduledTaskRunTable.id, input.runRow.id))
        .limit(1)
      return created
        ? { kind: "recorded" as const, run: runFromRow(created) }
        : { kind: "stale" as const }
    })
  },

  async enqueueRunOnce(input) {
    return db.transaction(async (tx) => {
      const [taskRow] = await tx
        .select()
        .from(ScheduledTaskTable)
        .where(and(
          eq(ScheduledTaskTable.id, input.taskId),
          eq(ScheduledTaskTable.organization_id, input.organizationId),
          eq(ScheduledTaskTable.owner_member_id, input.ownerMemberId),
        ))
        .for("update")
        .limit(1)
      if (!taskRow) throw new DenScheduledTaskRepositoryError("task_not_found")
      const [existing] = await tx
        .select()
        .from(ScheduledTaskRunTable)
        .where(and(
          eq(ScheduledTaskRunTable.task_id, input.taskId),
          eq(ScheduledTaskRunTable.idempotency_key, input.runRow.idempotency_key),
        ))
        .limit(1)
      if (existing) return { kind: "duplicate" as const, run: runFromRow(existing) }
      if (taskRow.active_run_id) return { kind: "overlap" as const }
      if (
        !taskRow.active_revision_id
        || !taskRow.active_grant_id
        || taskRow.active_revision_id !== input.runRow.task_revision_id
        || taskRow.active_grant_id !== input.runRow.grant_revision_id
      ) {
        throw new DenScheduledTaskRepositoryError("task_not_found")
      }
      await tx.insert(ScheduledTaskRunTable).values(input.runRow)
      await tx
        .update(ScheduledTaskTable)
        .set({ active_run_id: input.runRow.id })
        .where(eq(ScheduledTaskTable.id, input.taskId))
      const [created] = await tx
        .select()
        .from(ScheduledTaskRunTable)
        .where(eq(ScheduledTaskRunTable.id, input.runRow.id))
        .limit(1)
      if (!created) throw new DenScheduledTaskRepositoryError("run_not_found")
      return { kind: "queued" as const, run: runFromRow(created) }
    })
  },

  async enqueueScheduledOccurrence(input) {
    return db.transaction(async (tx) => {
      const [taskRow] = await tx
        .select()
        .from(ScheduledTaskTable)
        .where(and(
          eq(ScheduledTaskTable.id, input.taskId),
          eq(ScheduledTaskTable.organization_id, input.organizationId),
          eq(ScheduledTaskTable.owner_member_id, input.ownerMemberId),
          isNull(ScheduledTaskTable.deleted_at),
        ))
        .for("update")
        .limit(1)
      if (!taskRow) return { kind: "stale" as const }
      const [existing] = await tx
        .select()
        .from(ScheduledTaskRunTable)
        .where(and(
          eq(ScheduledTaskRunTable.task_id, input.taskId),
          eq(ScheduledTaskRunTable.idempotency_key, input.runRow.idempotency_key),
        ))
        .limit(1)
      if (existing) {
        return { kind: "duplicate" as const, run: runFromRow(existing) }
      }
      if (
        taskRow.state !== "enabled"
        || !taskRow.enabled
        || taskRow.next_due_at?.getTime() !== input.expectedDueAt
        || taskRow.active_revision_id !== input.runRow.task_revision_id
        || taskRow.active_grant_id !== input.runRow.grant_revision_id
      ) {
        return { kind: "stale" as const }
      }
      const nextDueAt = input.nextDueAt === null ? null : new Date(input.nextDueAt)
      if (taskRow.active_run_id) {
        await tx.insert(ScheduledTaskRunTable).values({
          ...input.runRow,
          status: "skipped-overlap",
          completed_at: new Date(input.now),
          duration_ms: 0,
        })
        await tx
          .update(ScheduledTaskTable)
          .set({ next_due_at: nextDueAt })
          .where(eq(ScheduledTaskTable.id, input.taskId))
        const [skipped] = await tx
          .select()
          .from(ScheduledTaskRunTable)
          .where(eq(ScheduledTaskRunTable.id, input.runRow.id))
          .limit(1)
        return skipped
          ? { kind: "overlap" as const, run: runFromRow(skipped) }
          : { kind: "stale" as const }
      }
      await tx.insert(ScheduledTaskRunTable).values(input.runRow)
      await tx
        .update(ScheduledTaskTable)
        .set({
          active_run_id: input.runRow.id,
          next_due_at: nextDueAt,
        })
        .where(eq(ScheduledTaskTable.id, input.taskId))
      const [created] = await tx
        .select()
        .from(ScheduledTaskRunTable)
        .where(eq(ScheduledTaskRunTable.id, input.runRow.id))
        .limit(1)
      return created
        ? { kind: "queued" as const, run: runFromRow(created) }
        : { kind: "stale" as const }
    })
  },

  async getOwnedRunReceipt(input) {
    const [runRow] = await db
      .select()
      .from(ScheduledTaskRunTable)
      .where(and(
        eq(ScheduledTaskRunTable.id, input.runId),
        eq(ScheduledTaskRunTable.task_id, input.taskId),
        eq(ScheduledTaskRunTable.organization_id, input.organizationId),
        eq(ScheduledTaskRunTable.owner_member_id, input.ownerMemberId),
      ))
      .limit(1)
    if (!runRow) return null
    const [[revision], [grant], attempts, artifacts] = await Promise.all([
      db.select().from(ScheduledTaskRevisionTable).where(and(
        eq(ScheduledTaskRevisionTable.id, runRow.task_revision_id),
        eq(ScheduledTaskRevisionTable.organization_id, input.organizationId),
      )).limit(1),
      db.select().from(ScheduledTaskGrantTable).where(and(
        eq(ScheduledTaskGrantTable.id, runRow.grant_revision_id),
        eq(ScheduledTaskGrantTable.organization_id, input.organizationId),
      )).limit(1),
      attemptsForRun(input.runId),
      artifactsForRun(input.runId),
    ])
    if (!revision || !grant) return null
    return {
      run: runFromRow(runRow, artifacts),
      taskRevision: revisionFromRow(revision),
      grantRevision: grantFromRow(grant),
      placement: runRow.placement,
      attempts,
      sessionRoute: null,
      artifacts,
    }
  },

  async requestCancellation(input) {
    return db.transaction(async (tx) => {
      const now = new Date(input.now)
      const [runRow] = await tx
        .select()
        .from(ScheduledTaskRunTable)
        .where(and(
          eq(ScheduledTaskRunTable.id, input.runId),
          eq(ScheduledTaskRunTable.task_id, input.taskId),
          eq(ScheduledTaskRunTable.organization_id, input.organizationId),
          eq(ScheduledTaskRunTable.owner_member_id, input.ownerMemberId),
        ))
        .for("update")
        .limit(1)
      if (!runRow) return null
      if (["scheduled", "retrying"].includes(runRow.status)) {
        const result = {
          status: "cancelled" as const,
          sessionId: null,
          error: QUEUED_CANCELLATION_ERROR,
        }
        const resultDigest = digest(result)
        await tx
          .update(ScheduledTaskRunTable)
          .set({
            status: "cancelled",
            cancel_requested_at: now,
            completed_at: now,
            duration_ms: Math.max(0, input.now - runRow.claimed_at.getTime()),
            error: QUEUED_CANCELLATION_ERROR,
            result_digest: resultDigest,
          })
          .where(eq(ScheduledTaskRunTable.id, runRow.id))
        await tx
          .update(ScheduledTaskTable)
          .set({ active_run_id: null })
          .where(and(
            eq(ScheduledTaskTable.id, runRow.task_id),
            eq(ScheduledTaskTable.active_run_id, runRow.id),
          ))
        return runFromRow({
          ...runRow,
          status: "cancelled",
          cancel_requested_at: now,
          completed_at: now,
          duration_ms: Math.max(0, input.now - runRow.claimed_at.getTime()),
          error: QUEUED_CANCELLATION_ERROR,
          result_digest: resultDigest,
          updated_at: now,
        })
      }
      if (["claimed", "running"].includes(runRow.status)) {
        await tx
          .update(ScheduledTaskRunTable)
          .set({ cancel_requested_at: now })
          .where(eq(ScheduledTaskRunTable.id, runRow.id))
        return runFromRow({ ...runRow, cancel_requested_at: now, updated_at: now })
      }
      return runFromRow(runRow)
    })
  },

  async recoverAbandonedExecutions(input) {
    const now = new Date(input.now)
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 100), 500))
    const conditions = [
      inArray(ScheduledTaskAttemptTable.status, ["starting", "running"]),
      lte(ScheduledTaskAttemptTable.lease_expires_at, now),
      ...(input.workerId
        ? [eq(ScheduledTaskAttemptTable.worker_id, input.workerId)]
        : []),
    ]
    const candidates = await db
      .select({ id: ScheduledTaskAttemptTable.id })
      .from(ScheduledTaskAttemptTable)
      .where(and(...conditions))
      .orderBy(asc(ScheduledTaskAttemptTable.lease_expires_at))
      .limit(limit)
    const requeuedRunIds: DenScheduledTaskRunId[] = []
    const terminalRunIds: DenScheduledTaskRunId[] = []

    for (const candidate of candidates) {
      const recovered = await db.transaction(async (tx) => {
        const [attempt] = await tx
          .select()
          .from(ScheduledTaskAttemptTable)
          .where(eq(ScheduledTaskAttemptTable.id, candidate.id))
          .for("update")
          .limit(1)
        if (
          !attempt
          || terminalAttemptStatus(attempt.status)
          || attempt.lease_expires_at.getTime() > input.now
        ) {
          return null
        }
        const [runRow] = await tx
          .select()
          .from(ScheduledTaskRunTable)
          .where(eq(ScheduledTaskRunTable.id, attempt.run_id))
          .for("update")
          .limit(1)
        if (
          !runRow
          || !["claimed", "running", "retrying"].includes(runRow.status)
          || runRow.attempt_count !== attempt.attempt
        ) {
          return null
        }
        const [revision] = await tx
          .select({ definition: ScheduledTaskRevisionTable.definition })
          .from(ScheduledTaskRevisionTable)
          .where(and(
            eq(ScheduledTaskRevisionTable.id, runRow.task_revision_id),
            eq(ScheduledTaskRevisionTable.organization_id, runRow.organization_id),
          ))
          .limit(1)
        const disposition = scheduledTaskAbandonmentDisposition({
          attempt: attempt.attempt,
          maximumAttempts: revision?.definition.retryPolicy.maximumAttempts
            ?? attempt.attempt,
          cancelRequested: runRow.cancel_requested_at !== null,
        })
        const abandonedError: ScheduledTaskTypedError = {
          ...ABANDONED_EXECUTION_ERROR,
          retryable: disposition === "requeue",
        }
        const result = {
          status: "ambiguous" as const,
          sessionId: attempt.session_id ?? runRow.session_id,
          error: abandonedError,
        }
        const resultDigest = digest(result)
        await tx
          .update(ScheduledTaskAttemptTable)
          .set({
            status: "ambiguous",
            completed_at: now,
            error: abandonedError,
            result_digest: resultDigest,
            lease_expires_at: now,
          })
          .where(eq(ScheduledTaskAttemptTable.id, attempt.id))

        if (disposition === "requeue") {
          await tx
            .update(ScheduledTaskRunTable)
            .set({
              status: "retrying",
              session_id: null,
              started_at: null,
              error: null,
              result_digest: null,
              retry_not_before: new Date(
                scheduledTaskRetryNotBefore(
                  input.now,
                  revision?.definition.retryPolicy.delayMs ?? 0,
                ),
              ),
            })
            .where(eq(ScheduledTaskRunTable.id, runRow.id))
          return { kind: "requeued" as const, runId: runRow.id }
        }

        const attention: ScheduledTaskNeedsAttention = {
          code: "approval-required",
          message: "This remote run may still have changed the workspace. Review it before resuming the schedule.",
          repairable: true,
          runId: runRow.id,
          sessionId: attempt.session_id ?? runRow.session_id,
          createdAt: input.now,
        }
        await tx
          .update(ScheduledTaskRunTable)
          .set({
            status: "ambiguous",
            completed_at: now,
            duration_ms: Math.max(0, input.now - runRow.claimed_at.getTime()),
            error: abandonedError,
            needs_attention: attention,
            result_digest: resultDigest,
          })
          .where(eq(ScheduledTaskRunTable.id, runRow.id))
        await tx
          .update(ScheduledTaskTable)
          .set({
            state: "needs-attention",
            enabled: false,
            active_run_id: null,
            next_due_at: null,
            needs_attention: attention,
          })
          .where(and(
            eq(ScheduledTaskTable.id, runRow.task_id),
            eq(ScheduledTaskTable.active_run_id, runRow.id),
          ))
        return { kind: "terminal" as const, runId: runRow.id }
      })
      if (recovered?.kind === "requeued") requeuedRunIds.push(recovered.runId)
      if (recovered?.kind === "terminal") terminalRunIds.push(recovered.runId)
    }

    const remaining = Math.max(0, limit - terminalRunIds.length - requeuedRunIds.length)
    if (remaining > 0) {
      const unclaimed = await db
        .select({ id: ScheduledTaskRunTable.id })
        .from(ScheduledTaskRunTable)
        .where(and(
          eq(ScheduledTaskRunTable.status, "scheduled"),
          lte(ScheduledTaskRunTable.dispatch_deadline, now),
          ...(input.workerId
            ? [eq(ScheduledTaskRunTable.worker_id, input.workerId)]
            : []),
        ))
        .orderBy(asc(ScheduledTaskRunTable.dispatch_deadline))
        .limit(remaining)
      for (const candidate of unclaimed) {
        const terminalized = await db.transaction(async (tx) => {
          const [runRow] = await tx
            .select()
            .from(ScheduledTaskRunTable)
            .where(eq(ScheduledTaskRunTable.id, candidate.id))
            .for("update")
            .limit(1)
          if (
            !runRow
            || runRow.status !== "scheduled"
          ) return null
          if (
            runRow.dispatch_deadline.getTime() > input.now
          ) return null
          const manual = runRow.scheduled_for === null
          const attention: ScheduledTaskNeedsAttention = {
            code: "missed-occurrence",
            message: manual
              ? "The reviewed Den worker did not claim this manual run before its grace period ended."
              : "The reviewed Den worker did not claim this occurrence before its grace period ended.",
            repairable: true,
            runId: runRow.id,
            sessionId: null,
            createdAt: input.now,
          }
          await tx
            .update(ScheduledTaskRunTable)
            .set({
              status: "missed",
              completed_at: now,
              duration_ms: 0,
              needs_attention: attention,
            })
            .where(eq(ScheduledTaskRunTable.id, runRow.id))
          await tx
            .update(ScheduledTaskTable)
            .set({
              state: "needs-attention",
              enabled: false,
              active_run_id: null,
              next_due_at: null,
              needs_attention: attention,
            })
            .where(and(
              eq(ScheduledTaskTable.id, runRow.task_id),
              eq(ScheduledTaskTable.active_run_id, runRow.id),
            ))
          return runRow.id
        })
        if (terminalized) terminalRunIds.push(terminalized)
      }
    }

    return { requeuedRunIds, terminalRunIds }
  },

  async findQueuedExecution(input) {
    const now = new Date(input.now)
    const [runRow] = await db
      .select()
      .from(ScheduledTaskRunTable)
      .where(and(
        eq(ScheduledTaskRunTable.worker_id, input.workerId),
        or(
          eq(ScheduledTaskRunTable.status, "scheduled"),
          and(
            eq(ScheduledTaskRunTable.status, "retrying"),
            lte(ScheduledTaskRunTable.retry_not_before, now),
          ),
        ),
        isNull(ScheduledTaskRunTable.cancel_requested_at),
      ))
      .orderBy(asc(ScheduledTaskRunTable.created_at))
      .limit(1)
    if (!runRow) return null
    const [[taskRow], [revision], [grant]] = await Promise.all([
      db.select().from(ScheduledTaskTable).where(and(
        eq(ScheduledTaskTable.id, runRow.task_id),
        eq(ScheduledTaskTable.organization_id, runRow.organization_id),
      )).limit(1),
      db.select().from(ScheduledTaskRevisionTable).where(and(
        eq(ScheduledTaskRevisionTable.id, runRow.task_revision_id),
        eq(ScheduledTaskRevisionTable.organization_id, runRow.organization_id),
      )).limit(1),
      db.select().from(ScheduledTaskGrantTable).where(and(
        eq(ScheduledTaskGrantTable.id, runRow.grant_revision_id),
        eq(ScheduledTaskGrantTable.organization_id, runRow.organization_id),
      )).limit(1),
    ])
    if (!taskRow || !revision || !grant) return null
    return {
      taskRow,
      task: taskFromRow(taskRow),
      revision: revisionFromRow(revision),
      grant: grantFromRow(grant),
      run: runFromRow(runRow),
    }
  },

  async claimExecution(input) {
    return db.transaction(async (tx) => {
      const [runRow] = await tx
        .select()
        .from(ScheduledTaskRunTable)
        .where(and(
          eq(ScheduledTaskRunTable.id, input.runId),
          eq(ScheduledTaskRunTable.worker_id, input.workerId),
        ))
        .for("update")
        .limit(1)
      if (
        !runRow
        || !["scheduled", "retrying"].includes(runRow.status)
        || runRow.cancel_requested_at
        || (runRow.retry_not_before && runRow.retry_not_before.getTime() > input.now)
      ) return null
      const [[revision], [grant]] = await Promise.all([
        tx.select().from(ScheduledTaskRevisionTable).where(and(
          eq(ScheduledTaskRevisionTable.id, runRow.task_revision_id),
          eq(ScheduledTaskRevisionTable.organization_id, runRow.organization_id),
        )).limit(1),
        tx.select().from(ScheduledTaskGrantTable).where(and(
          eq(ScheduledTaskGrantTable.id, runRow.grant_revision_id),
          eq(ScheduledTaskGrantTable.organization_id, runRow.organization_id),
        )).limit(1),
      ])
      if (!revision || !grant) return null
      const attemptNumber = runRow.attempt_count + 1
      const now = new Date(input.now)
      if (attemptNumber > revision.definition.retryPolicy.maximumAttempts) {
        const terminalError: ScheduledTaskTypedError = {
          ...ABANDONED_EXECUTION_ERROR,
          retryable: false,
        }
        const result = {
          status: "ambiguous" as const,
          sessionId: runRow.session_id,
          error: terminalError,
        }
        const resultDigest = digest(result)
        const attention: ScheduledTaskNeedsAttention = {
          code: "approval-required",
          message: "This remote run exhausted its reviewed attempt ceiling. Review it before resuming the schedule.",
          repairable: true,
          runId: runRow.id,
          sessionId: runRow.session_id,
          createdAt: input.now,
        }
        await tx
          .update(ScheduledTaskRunTable)
          .set({
            status: "ambiguous",
            completed_at: now,
            duration_ms: Math.max(0, input.now - runRow.claimed_at.getTime()),
            error: terminalError,
            needs_attention: attention,
            result_digest: resultDigest,
          })
          .where(eq(ScheduledTaskRunTable.id, runRow.id))
        await tx
          .update(ScheduledTaskTable)
          .set({
            state: "needs-attention",
            enabled: false,
            active_run_id: null,
            next_due_at: null,
            needs_attention: attention,
          })
          .where(and(
            eq(ScheduledTaskTable.id, runRow.task_id),
            eq(ScheduledTaskTable.active_run_id, runRow.id),
          ))
        return null
      }
      const token = leaseToken()
      const attemptId = createDenTypeId("scheduledTaskAttempt")
      const expiresAt = new Date(input.now + input.leaseDurationMs)
      await tx.insert(ScheduledTaskAttemptTable).values({
        id: attemptId,
        organization_id: runRow.organization_id,
        run_id: runRow.id,
        worker_id: input.workerId,
        attempt: attemptNumber,
        status: "starting",
        lease_generation: attemptNumber,
        lease_token_hash: hashScheduledTaskLeaseToken(token),
        lease_expires_at: expiresAt,
        last_heartbeat_at: now,
        started_at: now,
      })
      await tx
        .update(ScheduledTaskRunTable)
        .set({
          status: "claimed",
          attempt_count: attemptNumber,
          retry_not_before: null,
        })
        .where(eq(ScheduledTaskRunTable.id, runRow.id))
      return {
        run: runFromRow({ ...runRow, status: "claimed", attempt_count: attemptNumber }),
        revision: revisionFromRow(revision),
        grant: grantFromRow(grant),
        attempt: scheduledTaskAttemptSchema.parse({
          id: attemptId,
          runId: runRow.id,
          attempt: attemptNumber,
          status: "starting",
          sessionId: null,
          startedAt: input.now,
          completedAt: null,
          error: null,
        }),
        lease: {
          token,
          generation: attemptNumber,
          expiresAt: expiresAt.getTime(),
        },
      }
    })
  },

  async heartbeat(input) {
    const now = new Date(input.now)
    const expiresAt = new Date(input.now + input.leaseDurationMs)
    return db.transaction(async (tx) => {
      const attempt = await assertLiveLease({
        tx,
        workerId: input.workerId,
        attemptId: input.attemptId,
        tokenHash: hashScheduledTaskLeaseToken(input.leaseToken),
        now,
      })
      await tx
        .update(ScheduledTaskAttemptTable)
        .set({
          lease_expires_at: expiresAt,
          last_heartbeat_at: now,
          ...(input.sessionId !== undefined ? { session_id: input.sessionId } : {}),
        })
        .where(eq(ScheduledTaskAttemptTable.id, input.attemptId))
      const [runRow] = await tx
        .select()
        .from(ScheduledTaskRunTable)
        .where(eq(ScheduledTaskRunTable.id, attempt.run_id))
        .limit(1)
      if (!runRow) throw new DenScheduledTaskRepositoryError("run_not_found")
      return {
        leaseExpiresAt: expiresAt.getTime(),
        cancelRequestedAt: nullableMillis(runRow.cancel_requested_at),
      }
    })
  },

  async appendEvent(input) {
    const event = scheduledTaskExecutionEventSchema.parse(input.event)
    const eventDigest = digest(event)
    const now = new Date(input.now)
    return db.transaction(async (tx) => {
      const attempt = await assertLiveLease({
        tx,
        workerId: input.workerId,
        attemptId: input.attemptId,
        tokenHash: hashScheduledTaskLeaseToken(input.leaseToken),
        now,
      })
      const [existing] = await tx
        .select()
        .from(ScheduledTaskEventTable)
        .where(and(
          eq(ScheduledTaskEventTable.attempt_id, input.attemptId),
          eq(ScheduledTaskEventTable.sequence, input.sequence),
        ))
        .limit(1)
      if (existing) {
        if (existing.event_digest !== eventDigest) {
          throw new DenScheduledTaskRepositoryError("conflicting_replay")
        }
        return { duplicate: true }
      }
      const [latest] = await tx
        .select({ sequence: ScheduledTaskEventTable.sequence })
        .from(ScheduledTaskEventTable)
        .where(eq(ScheduledTaskEventTable.attempt_id, input.attemptId))
        .orderBy(desc(ScheduledTaskEventTable.sequence))
        .limit(1)
      if (!isNextScheduledTaskEventSequence({
        sequence: input.sequence,
        latestSequence: latest?.sequence ?? null,
      })) {
        throw new DenScheduledTaskRepositoryError("conflicting_replay")
      }
      await tx.insert(ScheduledTaskEventTable).values({
        id: createDenTypeId("scheduledTaskEvent"),
        organization_id: attempt.organization_id,
        run_id: attempt.run_id,
        attempt_id: input.attemptId,
        sequence: input.sequence,
        event_type: event.type,
        event,
        event_digest: eventDigest,
      })
      if ("sessionId" in event) {
        await tx
          .update(ScheduledTaskAttemptTable)
          .set({ session_id: event.sessionId, status: "running" })
          .where(eq(ScheduledTaskAttemptTable.id, input.attemptId))
        await tx
          .update(ScheduledTaskRunTable)
          .set({ session_id: event.sessionId, status: "running", started_at: now })
          .where(eq(ScheduledTaskRunTable.id, attempt.run_id))
      }
      return { duplicate: false }
    })
  },

  async complete(input) {
    const result = scheduledTaskExecutionResultSchema.parse(input.result)
    const resultDigest = digest(result)
    const now = new Date(input.now)
    return db.transaction(async (tx) => {
      const attempt = await assertLiveLease({
        tx,
        workerId: input.workerId,
        attemptId: input.attemptId,
        tokenHash: hashScheduledTaskLeaseToken(input.leaseToken),
        now,
        allowTerminalReplay: true,
      })
      const [runRow] = await tx
        .select()
        .from(ScheduledTaskRunTable)
        .where(eq(ScheduledTaskRunTable.id, attempt.run_id))
        .for("update")
        .limit(1)
      if (!runRow) throw new DenScheduledTaskRepositoryError("run_not_found")
      if (terminalAttemptStatus(attempt.status)) {
        if (attempt.result_digest !== resultDigest || runRow.result_digest !== resultDigest) {
          throw new DenScheduledTaskRepositoryError("conflicting_replay")
        }
        return {
          duplicate: true,
          run: runFromRow(runRow, await artifactsForRun(runRow.id)),
        }
      }
      if (runRow.attempt_count !== attempt.attempt) {
        throw new DenScheduledTaskRepositoryError("stale_lease")
      }

      const sessionId = result.sessionId ?? attempt.session_id
      const runStatus = result.status
      const attemptStatus = result.status === "needs-attention"
        ? "needs-attention"
        : result.status
      const runError = "error" in result ? result.error : null
      const needsAttention = result.status === "needs-attention"
        ? result.attention
        : null
      const boundedUsage = result.status === "completed"
        ? result.boundedUsage
        : runRow.bounded_usage ?? EMPTY_USAGE
      await tx
        .update(ScheduledTaskAttemptTable)
        .set({
          status: attemptStatus,
          session_id: sessionId,
          completed_at: now,
          error: runError,
          result_digest: resultDigest,
          lease_expires_at: now,
        })
        .where(eq(ScheduledTaskAttemptTable.id, input.attemptId))
      await tx
        .update(ScheduledTaskRunTable)
        .set({
          status: runStatus,
          session_id: sessionId,
          completed_at: now,
          duration_ms: Math.max(0, input.now - runRow.claimed_at.getTime()),
          bounded_usage: boundedUsage,
          error: runError,
          needs_attention: needsAttention,
          result_digest: resultDigest,
        })
        .where(eq(ScheduledTaskRunTable.id, runRow.id))
      if (result.status === "completed") {
        for (const reference of result.artifacts) {
          await tx.insert(ScheduledTaskArtifactTable).values({
            id: createDenTypeId("scheduledTaskArtifact"),
            organization_id: runRow.organization_id,
            run_id: runRow.id,
            attempt_id: input.attemptId,
            kind: reference.kind,
            value: reference.value,
            name: reference.name,
            reference,
          })
        }
      }
      await tx
        .update(ScheduledTaskTable)
        .set({
          active_run_id: null,
          ...(needsAttention
            ? { state: "needs-attention", needs_attention: needsAttention }
            : {}),
        })
        .where(and(
          eq(ScheduledTaskTable.id, runRow.task_id),
          eq(ScheduledTaskTable.active_run_id, runRow.id),
        ))
      const completedRun = runFromRow({
        ...runRow,
        status: runStatus,
        session_id: sessionId,
        completed_at: now,
        duration_ms: Math.max(0, input.now - runRow.claimed_at.getTime()),
        bounded_usage: boundedUsage,
        error: runError,
        needs_attention: needsAttention,
        result_digest: resultDigest,
        updated_at: now,
      }, result.status === "completed" ? result.artifacts : [])
      return { duplicate: false, run: completedRun }
    })
  },

  async nextDueAt() {
    const [row] = await db
      .select({ nextDueAt: ScheduledTaskTable.next_due_at })
      .from(ScheduledTaskTable)
      .where(and(
        eq(ScheduledTaskTable.enabled, true),
        eq(ScheduledTaskTable.state, "enabled"),
        isNull(ScheduledTaskTable.deleted_at),
      ))
      .orderBy(asc(ScheduledTaskTable.next_due_at))
      .limit(1)
    return row?.nextDueAt?.getTime() ?? null
  },
}

export async function listDueDenScheduledTaskRows(now: number, limit: number) {
  return db
    .select()
    .from(ScheduledTaskTable)
    .where(and(
      eq(ScheduledTaskTable.enabled, true),
      eq(ScheduledTaskTable.state, "enabled"),
      lte(ScheduledTaskTable.next_due_at, new Date(now)),
      isNull(ScheduledTaskTable.deleted_at),
    ))
    .orderBy(asc(ScheduledTaskTable.next_due_at))
    .limit(limit)
}
