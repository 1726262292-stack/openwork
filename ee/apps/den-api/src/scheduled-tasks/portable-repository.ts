import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
} from "@openwork-ee/den-db/drizzle"
import {
  ScheduledTaskAttemptTable,
  ScheduledTaskGrantTable,
  ScheduledTaskRevisionTable,
  ScheduledTaskRunTable,
  ScheduledTaskTable,
} from "@openwork-ee/den-db/schema"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import {
  isTerminalScheduledTaskRunStatus,
  scheduledTaskPlacementIdentity,
  type ScheduledTaskClaimResult,
  type ScheduledTaskDetail,
  type ScheduledTaskOccurrenceRecord,
  type ScheduledTaskRepository,
  type ScheduledTaskRepositoryFilter,
} from "@openwork/scheduled-tasks"
import type {
  ScheduledTask,
  ScheduledTaskAttempt,
  ScheduledTaskExecutionTarget,
  ScheduledTaskGrant,
  ScheduledTaskPlacement,
  ScheduledTaskRevision,
  ScheduledTaskRun,
} from "@openwork/types/scheduled-tasks"
import { db } from "../db.js"
import {
  attemptFromRow,
  databaseDenScheduledTaskRepository,
  grantFromRow,
  revisionFromRow,
  runFromRow,
  taskFromRow,
  type DenScheduledTaskMemberId,
  type DenScheduledTaskOrganizationId,
} from "./repository.js"

export type DenScheduledTaskRepositoryScope = {
  organizationId: DenScheduledTaskOrganizationId
  ownerMemberId: DenScheduledTaskMemberId
}

type DenPlacement = ScheduledTaskPlacement & {
  target: Extract<ScheduledTaskExecutionTarget, { kind: "den-worker" }>
  executionPrincipal: Extract<
    ScheduledTaskPlacement["executionPrincipal"],
    { kind: "den-membership" }
  >
}

function date(value: number | null) {
  return value === null ? null : new Date(value)
}

function denPlacement(
  placement: ScheduledTaskPlacement | null | undefined,
  scope: DenScheduledTaskRepositoryScope,
): DenPlacement {
  if (
    !placement
    || placement.target.kind !== "den-worker"
    || placement.schedulerOwner !== "den"
    || placement.target.organizationId !== scope.organizationId
    || placement.executionPrincipal.kind !== "den-membership"
    || placement.executionPrincipal.organizationId !== scope.organizationId
    || placement.executionPrincipal.membershipId !== scope.ownerMemberId
  ) {
    throw new Error("den_scheduled_task_scope_mismatch")
  }
  return placement as DenPlacement
}

function targetEquals(
  left: ScheduledTaskExecutionTarget,
  right: ScheduledTaskExecutionTarget,
) {
  if (left.kind !== right.kind) return false
  if (left.kind === "local-workspace" || right.kind === "local-workspace") {
    return left.kind === "local-workspace"
      && right.kind === "local-workspace"
      && left.workspaceId === right.workspaceId
  }
  return left.organizationId === right.organizationId
    && left.workerId === right.workerId
    && left.workspaceId === right.workspaceId
}

function matchesScope(input: {
  filter?: ScheduledTaskRepositoryFilter
  scope: DenScheduledTaskRepositoryScope
  task: ScheduledTask
  revision: ScheduledTaskRevision
}) {
  const filter = input.filter
  if (filter === undefined || (typeof filter !== "string" && filter.kind === "all")) {
    return true
  }
  if (typeof filter === "string") return input.task.workspaceId === filter
  if (filter.kind === "workspace") return input.task.workspaceId === filter.workspaceId
  const placement = input.revision.definition.placement
  if (!placement) return false
  if (filter.kind === "target") return targetEquals(placement.target, filter.target)
  return filter.schedulerOwner === "den"
    && (!filter.organizationId || filter.organizationId === input.scope.organizationId)
}

function revisionInsert(
  scope: DenScheduledTaskRepositoryScope,
  revision: ScheduledTaskRevision,
) {
  const placement = denPlacement(revision.definition.placement, scope)
  return {
    id: normalizeDenTypeId("scheduledTaskRevision", revision.id),
    organization_id: scope.organizationId,
    task_id: normalizeDenTypeId("scheduledTask", revision.taskId),
    revision: revision.revision,
    definition: revision.definition,
    placement,
    placement_identity: scheduledTaskPlacementIdentity(placement),
    created_by_member_id: normalizeDenTypeId("member", revision.createdBy),
    reviewed_at: date(revision.reviewedAt),
    reviewed_by_member_id: revision.reviewedBy
      ? normalizeDenTypeId("member", revision.reviewedBy)
      : null,
    created_at: new Date(revision.createdAt),
  }
}

function grantInsert(
  scope: DenScheduledTaskRepositoryScope,
  grant: ScheduledTaskGrant,
) {
  denPlacement(grant.placement, scope)
  return {
    id: normalizeDenTypeId("scheduledTaskGrant", grant.id),
    organization_id: scope.organizationId,
    task_id: normalizeDenTypeId("scheduledTask", grant.taskId),
    task_revision_id: normalizeDenTypeId("scheduledTaskRevision", grant.taskRevisionId),
    revision: grant.revision,
    grant,
    placement_identity: grant.placementIdentity
      ?? scheduledTaskPlacementIdentity(denPlacement(grant.placement, scope)),
    reviewed_by_member_id: normalizeDenTypeId("member", grant.grantor),
    reviewed_at: new Date(grant.reviewedAt),
    expires_at: date(grant.expiresAt),
    revoked_at: date(grant.revokedAt),
    revocation_reason: grant.revocationReason,
    created_at: new Date(grant.createdAt),
  }
}

function taskUpdate(task: ScheduledTask) {
  return {
    workspace_id: task.workspaceId,
    state: task.state,
    enabled: task.enabled,
    draft_revision_id: normalizeDenTypeId("scheduledTaskRevision", task.draftRevisionId),
    active_revision_id: task.activeRevisionId
      ? normalizeDenTypeId("scheduledTaskRevision", task.activeRevisionId)
      : null,
    active_grant_id: task.activeGrantId
      ? normalizeDenTypeId("scheduledTaskGrant", task.activeGrantId)
      : null,
    next_due_at: date(task.nextRunAt),
    needs_attention: task.needsAttention,
    deleted_at: date(task.deletedAt),
    updated_at: new Date(task.updatedAt),
  }
}

function runInsert(
  scope: DenScheduledTaskRepositoryScope,
  run: ScheduledTaskRun,
) {
  const placement = denPlacement(run.placement, scope)
  return {
    id: normalizeDenTypeId("scheduledTaskRun", run.id),
    organization_id: scope.organizationId,
    task_id: normalizeDenTypeId("scheduledTask", run.taskId),
    task_revision_id: normalizeDenTypeId("scheduledTaskRevision", run.taskRevisionId),
    grant_revision_id: normalizeDenTypeId("scheduledTaskGrant", run.grantRevisionId),
    owner_member_id: scope.ownerMemberId,
    execution_member_id: scope.ownerMemberId,
    worker_id: normalizeDenTypeId("worker", placement.target.workerId),
    workspace_id: placement.target.workspaceId,
    placement,
    occurrence_id: run.occurrenceId,
    trigger: run.trigger,
    status: run.status,
    scheduled_for: date(run.scheduledFor),
    claimed_at: new Date(run.claimedAt),
    dispatch_deadline: new Date(run.claimedAt + 60_000),
    started_at: date(run.startedAt),
    completed_at: date(run.completedAt),
    duration_ms: run.durationMs,
    idempotency_key: run.idempotencyKey,
    session_id: run.sessionId,
    attempt_count: run.attemptCount,
    bounded_usage: run.boundedUsage,
    error: run.error,
    needs_attention: run.needsAttention,
    cancel_requested_at: date(run.cancelRequestedAt),
    result_digest: null,
    created_at: new Date(run.createdAt),
    updated_at: new Date(run.updatedAt),
  }
}

/**
 * Tenant-bound implementation of the portable repository port. Production Den
 * APIs keep organization/member identity explicit, while this adapter proves
 * that the same durable ledger contract used by SQLite is implemented by MySQL.
 */
export function createScopedDenScheduledTaskRepository(
  scope: DenScheduledTaskRepositoryScope,
): ScheduledTaskRepository {
  const taskWhere = (taskId: string) => and(
    eq(ScheduledTaskTable.id, normalizeDenTypeId("scheduledTask", taskId)),
    eq(ScheduledTaskTable.organization_id, scope.organizationId),
    eq(ScheduledTaskTable.owner_member_id, scope.ownerMemberId),
  )

  const repository: ScheduledTaskRepository = {
    async createTask(task, revision) {
      const placement = denPlacement(revision.definition.placement, scope)
      await databaseDenScheduledTaskRepository.createDraft({
        revisionRow: revisionInsert(scope, revision),
        taskRow: {
          id: normalizeDenTypeId("scheduledTask", task.id),
          organization_id: scope.organizationId,
          owner_member_id: scope.ownerMemberId,
          execution_member_id: scope.ownerMemberId,
          worker_id: normalizeDenTypeId("worker", placement.target.workerId),
          ...taskUpdate(task),
          created_at: new Date(task.createdAt),
        },
      })
    },

    async createRevision(task, revision) {
      await db.transaction(async (tx) => {
        const [owned] = await tx.select({ id: ScheduledTaskTable.id })
          .from(ScheduledTaskTable).where(taskWhere(task.id)).for("update").limit(1)
        if (!owned) throw new Error("den_scheduled_task_not_found")
        await tx.insert(ScheduledTaskRevisionTable).values(revisionInsert(scope, revision))
        await tx.update(ScheduledTaskTable).set(taskUpdate(task)).where(taskWhere(task.id))
      })
    },

    async activateGrant(task, reviewedRevision, grant) {
      await db.transaction(async (tx) => {
        const [owned] = await tx.select({ id: ScheduledTaskTable.id })
          .from(ScheduledTaskTable).where(taskWhere(task.id)).for("update").limit(1)
        if (!owned) throw new Error("den_scheduled_task_not_found")
        await tx.insert(ScheduledTaskRevisionTable).values(revisionInsert(scope, reviewedRevision))
        await tx.insert(ScheduledTaskGrantTable).values(grantInsert(scope, grant))
        await tx.update(ScheduledTaskTable).set(taskUpdate(task)).where(taskWhere(task.id))
      })
    },

    async saveTask(task) {
      await db.update(ScheduledTaskTable).set(taskUpdate(task)).where(taskWhere(task.id))
    },

    async getTask(taskId) {
      const [row] = await db.select().from(ScheduledTaskTable).where(taskWhere(taskId)).limit(1)
      return row ? taskFromRow(row) : null
    },

    async getRevision(revisionId) {
      const [row] = await db.select().from(ScheduledTaskRevisionTable).where(and(
        eq(ScheduledTaskRevisionTable.id, normalizeDenTypeId("scheduledTaskRevision", revisionId)),
        eq(ScheduledTaskRevisionTable.organization_id, scope.organizationId),
      )).limit(1)
      if (!row || !(await repository.getTask(row.task_id))) return null
      return revisionFromRow(row)
    },

    async getGrant(grantId) {
      const [row] = await db.select().from(ScheduledTaskGrantTable).where(and(
        eq(ScheduledTaskGrantTable.id, normalizeDenTypeId("scheduledTaskGrant", grantId)),
        eq(ScheduledTaskGrantTable.organization_id, scope.organizationId),
      )).limit(1)
      if (!row || !(await repository.getTask(row.task_id))) return null
      return grantFromRow(row)
    },

    async revokeGrant(grantId, revokedAt, reason, revokedBy) {
      await db.transaction(async (tx) => {
        const normalizedGrantId = normalizeDenTypeId("scheduledTaskGrant", grantId)
        const [grant] = await tx.select().from(ScheduledTaskGrantTable).where(and(
          eq(ScheduledTaskGrantTable.id, normalizedGrantId),
          eq(ScheduledTaskGrantTable.organization_id, scope.organizationId),
        )).for("update").limit(1)
        if (!grant || !(await repository.getTask(grant.task_id))) {
          throw new Error("den_scheduled_task_grant_not_found")
        }
        if (!grant.revoked_at) {
          await tx.update(ScheduledTaskGrantTable).set({
            revoked_at: new Date(revokedAt),
            revoked_by_member_id: normalizeDenTypeId("member", revokedBy),
            revocation_reason: reason,
          }).where(eq(ScheduledTaskGrantTable.id, normalizedGrantId))
        }
      })
      const revoked = await repository.getGrant(grantId)
      if (!revoked) throw new Error("den_scheduled_task_grant_not_found")
      return revoked
    },

    async getDetail(taskId, runLimit = 100): Promise<ScheduledTaskDetail | null> {
      const task = await repository.getTask(taskId)
      if (!task) return null
      const draftRevision = await repository.getRevision(task.draftRevisionId)
      if (!draftRevision) throw new Error("den_scheduled_task_revision_not_found")
      return {
        task,
        draftRevision,
        activeRevision: task.activeRevisionId
          ? await repository.getRevision(task.activeRevisionId)
          : null,
        grant: task.activeGrantId ? await repository.getGrant(task.activeGrantId) : null,
        runs: await repository.listRuns(task.id, runLimit),
      }
    },

    async listTasks(filter) {
      const items = await databaseDenScheduledTaskRepository.listOwnedTasks({
        organizationId: scope.organizationId,
        ownerMemberId: scope.ownerMemberId,
      })
      return items.filter((item) => matchesScope({
        filter,
        scope,
        task: item.task,
        revision: item.revision,
      }))
    },

    async listDueTasks(now, filter) {
      const items = await repository.listTasks(filter ?? { kind: "all" })
      return items.map((item) => item.task).filter((task) =>
        task.enabled
        && task.state === "enabled"
        && task.deletedAt === null
        && task.nextRunAt !== null
        && task.nextRunAt <= now)
        .sort((left, right) => (left.nextRunAt ?? 0) - (right.nextRunAt ?? 0))
    },

    async nextDueAt(filter) {
      const due = (await repository.listTasks(filter ?? { kind: "all" }))
        .map((item) => item.task)
        .filter((task) => task.enabled && task.state === "enabled" && task.nextRunAt !== null)
        .map((task) => task.nextRunAt as number)
      return due.length ? Math.min(...due) : null
    },

    async claimOccurrence(
      occurrence: ScheduledTaskOccurrenceRecord,
      claimedRun: ScheduledTaskRun,
      overlapRun: ScheduledTaskRun,
      taskAfterClaim?: ScheduledTask,
    ): Promise<ScheduledTaskClaimResult> {
      return db.transaction(async (tx) => {
        const [taskRow] = await tx.select().from(ScheduledTaskTable)
          .where(taskWhere(occurrence.taskId)).for("update").limit(1)
        if (!taskRow) throw new Error("den_scheduled_task_not_found")
        const [existing] = await tx.select().from(ScheduledTaskRunTable).where(and(
          eq(ScheduledTaskRunTable.organization_id, scope.organizationId),
          eq(ScheduledTaskRunTable.task_id, normalizeDenTypeId("scheduledTask", occurrence.taskId)),
          or(
            eq(ScheduledTaskRunTable.idempotency_key, claimedRun.idempotencyKey),
            eq(ScheduledTaskRunTable.occurrence_id, occurrence.id),
          ),
        )).limit(1)
        if (existing) {
          if (taskAfterClaim) {
            await tx.update(ScheduledTaskTable).set(taskUpdate(taskAfterClaim))
              .where(taskWhere(taskAfterClaim.id))
          }
          return { kind: "duplicate" as const, run: runFromRow(existing) }
        }

        if (taskRow.active_run_id) {
          await tx.insert(ScheduledTaskRunTable).values(runInsert(scope, overlapRun))
          return { kind: "overlap" as const, run: overlapRun }
        }
        await tx.insert(ScheduledTaskRunTable).values(runInsert(scope, claimedRun))
        await tx.update(ScheduledTaskTable).set({
          ...(taskAfterClaim ? taskUpdate(taskAfterClaim) : {}),
          active_run_id: normalizeDenTypeId("scheduledTaskRun", claimedRun.id),
        }).where(taskWhere(occurrence.taskId))
        return { kind: "claimed" as const, run: claimedRun }
      })
    },

    async saveRun(run) {
      const normalizedRunId = normalizeDenTypeId("scheduledTaskRun", run.id)
      await db.transaction(async (tx) => {
        const [owned] = await tx.select({ taskId: ScheduledTaskRunTable.task_id })
          .from(ScheduledTaskRunTable).where(and(
            eq(ScheduledTaskRunTable.id, normalizedRunId),
            eq(ScheduledTaskRunTable.organization_id, scope.organizationId),
            eq(ScheduledTaskRunTable.owner_member_id, scope.ownerMemberId),
          )).for("update").limit(1)
        if (!owned) throw new Error("den_scheduled_task_run_not_found")
        await tx.update(ScheduledTaskRunTable).set({
          status: run.status,
          started_at: date(run.startedAt),
          completed_at: date(run.completedAt),
          duration_ms: run.durationMs,
          session_id: run.sessionId,
          attempt_count: run.attemptCount,
          bounded_usage: run.boundedUsage,
          error: run.error,
          needs_attention: run.needsAttention,
          cancel_requested_at: date(run.cancelRequestedAt),
          updated_at: new Date(run.updatedAt),
        }).where(eq(ScheduledTaskRunTable.id, normalizedRunId))
        if (isTerminalScheduledTaskRunStatus(run.status)) {
          await tx.update(ScheduledTaskTable).set({ active_run_id: null }).where(and(
            taskWhere(owned.taskId),
            eq(ScheduledTaskTable.active_run_id, normalizedRunId),
          ))
        }
      })
    },

    async getRun(runId) {
      const [row] = await db.select().from(ScheduledTaskRunTable).where(and(
        eq(ScheduledTaskRunTable.id, normalizeDenTypeId("scheduledTaskRun", runId)),
        eq(ScheduledTaskRunTable.organization_id, scope.organizationId),
        eq(ScheduledTaskRunTable.owner_member_id, scope.ownerMemberId),
      )).limit(1)
      return row ? runFromRow(row) : null
    },

    async listRuns(taskId, limit = 100) {
      if (!(await repository.getTask(taskId))) return []
      const rows = await db.select().from(ScheduledTaskRunTable).where(and(
        eq(ScheduledTaskRunTable.organization_id, scope.organizationId),
        eq(ScheduledTaskRunTable.owner_member_id, scope.ownerMemberId),
        eq(ScheduledTaskRunTable.task_id, normalizeDenTypeId("scheduledTask", taskId)),
      )).orderBy(desc(ScheduledTaskRunTable.created_at)).limit(limit)
      return rows.map((row) => runFromRow(row))
    },

    async listInterruptedRuns() {
      const rows = await db.select().from(ScheduledTaskRunTable).where(and(
        eq(ScheduledTaskRunTable.organization_id, scope.organizationId),
        eq(ScheduledTaskRunTable.owner_member_id, scope.ownerMemberId),
        inArray(ScheduledTaskRunTable.status, ["scheduled", "claimed", "running", "retrying"]),
      )).orderBy(asc(ScheduledTaskRunTable.claimed_at))
      return rows.map((row) => runFromRow(row))
    },

    async createAttempt(attempt) {
      const run = await repository.getRun(attempt.runId)
      if (!run) throw new Error("den_scheduled_task_run_not_found")
      const placement = denPlacement(run.placement, scope)
      await db.insert(ScheduledTaskAttemptTable).values({
        id: normalizeDenTypeId("scheduledTaskAttempt", attempt.id),
        organization_id: scope.organizationId,
        run_id: normalizeDenTypeId("scheduledTaskRun", attempt.runId),
        worker_id: normalizeDenTypeId("worker", placement.target.workerId),
        attempt: attempt.attempt,
        status: attempt.status,
        lease_generation: attempt.attempt,
        lease_token_hash: "portable-conformance",
        lease_expires_at: new Date(attempt.startedAt + 60_000),
        last_heartbeat_at: new Date(attempt.startedAt),
        session_id: attempt.sessionId,
        started_at: new Date(attempt.startedAt),
        completed_at: date(attempt.completedAt),
        error: attempt.error,
        created_at: new Date(attempt.startedAt),
      })
    },

    async saveAttempt(attempt) {
      const run = await repository.getRun(attempt.runId)
      if (!run) throw new Error("den_scheduled_task_run_not_found")
      await db.update(ScheduledTaskAttemptTable).set({
        status: attempt.status,
        session_id: attempt.sessionId,
        completed_at: date(attempt.completedAt),
        error: attempt.error,
      }).where(and(
        eq(ScheduledTaskAttemptTable.id, normalizeDenTypeId("scheduledTaskAttempt", attempt.id)),
        eq(ScheduledTaskAttemptTable.organization_id, scope.organizationId),
      ))
    },

    async listAttempts(runId) {
      if (!(await repository.getRun(runId))) return []
      const rows = await db.select().from(ScheduledTaskAttemptTable).where(and(
        eq(ScheduledTaskAttemptTable.organization_id, scope.organizationId),
        eq(ScheduledTaskAttemptTable.run_id, normalizeDenTypeId("scheduledTaskRun", runId)),
      )).orderBy(asc(ScheduledTaskAttemptTable.attempt))
      return rows.map((row) => attemptFromRow(row))
    },

    async close() {},
  }
  return repository
}
