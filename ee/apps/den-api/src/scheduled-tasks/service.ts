import { createDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import {
  nextScheduledTaskOccurrence,
  scheduledTaskOccurrenceIdentity,
  scheduledTaskPlacementIdentity,
  type ScheduledTaskTickInput,
  type ScheduledTaskTickResult,
} from "@openwork/scheduled-tasks"
import type { ScheduledTaskWorkerClaimResponse } from "@openwork/scheduled-tasks-den"
import type {
  ReviewScheduledTaskGrant,
  ScheduledTaskDefinition,
  ScheduledTaskExecutionEvent,
  ScheduledTaskExecutionResult,
  ScheduledTaskGrant,
  ScheduledTaskNeedsAttention,
  ScheduledTask,
  ScheduledTaskRunReceipt,
} from "@openwork/types/scheduled-tasks"
import {
  scheduledTaskGrantSchema,
  scheduledTaskRevisionSchema,
} from "@openwork/types/scheduled-tasks"
import {
  databaseDenScheduledTaskRepository,
  listDueDenScheduledTaskRows,
  type DenScheduledTaskAttemptId,
  type DenScheduledTaskId,
  type DenScheduledTaskMemberId,
  type DenScheduledTaskOrganizationId,
  type DenScheduledTaskRepository,
  type DenScheduledTaskRunId,
  type DenScheduledTaskWorkerId,
} from "./repository.js"
import {
  validateCurrentDenScheduledTaskAuthority,
  type DenScheduledTaskAuthorityResult,
} from "./authority.js"
import { wakeCloudWorker } from "../workers/cloud-lifecycle.js"

const EMPTY_USAGE = {
  inputTokens: null,
  outputTokens: null,
  costMicros: null,
}

export const DEN_SCHEDULED_TASK_MINIMUM_DISPATCH_MS = 60_000

export function denScheduledTaskDispatchDeadline(input: {
  queuedAt: number
  scheduledFor: number | null
  reviewedGraceMs: number
}) {
  const occurrenceReference = input.scheduledFor ?? input.queuedAt
  return Math.max(
    input.queuedAt + DEN_SCHEDULED_TASK_MINIMUM_DISPATCH_MS,
    occurrenceReference + Math.max(0, input.reviewedGraceMs),
  )
}

type DueTaskRow = Awaited<ReturnType<typeof listDueDenScheduledTaskRows>>[number]

export class DenScheduledTaskServiceError extends Error {
  constructor(readonly code: "authority_unavailable" | "invalid_placement" | "manual_only" | "not_found" | "revision_conflict") {
    super(code)
  }
}

export interface DenScheduledTaskServiceDependencies {
  repository: DenScheduledTaskRepository
  listDueTasks(now: number, limit: number): Promise<DueTaskRow[]>
  validateAuthority(input: {
    definition: Parameters<typeof validateCurrentDenScheduledTaskAuthority>[0]["definition"]
    grant: Parameters<typeof validateCurrentDenScheduledTaskAuthority>[0]["grant"]
    now: number
  }): Promise<DenScheduledTaskAuthorityResult>
  now(): number
  leaseDurationMs: number
  startWorkerWake(workerId: DenScheduledTaskWorkerId): void
}

export interface DenScheduledTaskService {
  list(input: {
    organizationId: DenScheduledTaskOrganizationId
    memberId: DenScheduledTaskMemberId
  }): ReturnType<DenScheduledTaskRepository["listOwnedTasks"]>
  get(input: {
    organizationId: DenScheduledTaskOrganizationId
    memberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
  }): ReturnType<DenScheduledTaskRepository["getOwnedTask"]>
  createDraft(input: {
    organizationId: DenScheduledTaskOrganizationId
    memberId: DenScheduledTaskMemberId
    definition: ScheduledTaskDefinition
  }): Promise<{ taskId: DenScheduledTaskId; revisionId: string }>
  review(input: {
    organizationId: DenScheduledTaskOrganizationId
    memberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
    review: Omit<ReviewScheduledTaskGrant, "grantor">
  }): Promise<ScheduledTaskGrant>
  enable(input: {
    organizationId: DenScheduledTaskOrganizationId
    memberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
  }): Promise<ScheduledTask>
  pause(input: {
    organizationId: DenScheduledTaskOrganizationId
    memberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
  }): Promise<ScheduledTask>
  runOnce(input: {
    organizationId: DenScheduledTaskOrganizationId
    memberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
    nonce: string
  }): ReturnType<DenScheduledTaskRepository["enqueueRunOnce"]>
  receipt(input: {
    organizationId: DenScheduledTaskOrganizationId
    memberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
    runId: DenScheduledTaskRunId
  }): Promise<ScheduledTaskRunReceipt | null>
  cancel(input: {
    organizationId: DenScheduledTaskOrganizationId
    memberId: DenScheduledTaskMemberId
    taskId: DenScheduledTaskId
    runId: DenScheduledTaskRunId
  }): ReturnType<DenScheduledTaskRepository["requestCancellation"]>
  tick(input: ScheduledTaskTickInput): Promise<ScheduledTaskTickResult>
  claim(workerId: DenScheduledTaskWorkerId): Promise<ScheduledTaskWorkerClaimResponse | null>
  heartbeat(input: {
    workerId: DenScheduledTaskWorkerId
    attemptId: DenScheduledTaskAttemptId
    leaseToken: string
    sessionId?: string | null
  }): ReturnType<DenScheduledTaskRepository["heartbeat"]>
  appendEvent(input: {
    workerId: DenScheduledTaskWorkerId
    attemptId: DenScheduledTaskAttemptId
    leaseToken: string
    sequence: number
    event: ScheduledTaskExecutionEvent
  }): ReturnType<DenScheduledTaskRepository["appendEvent"]>
  complete(input: {
    workerId: DenScheduledTaskWorkerId
    attemptId: DenScheduledTaskAttemptId
    leaseToken: string
    result: ScheduledTaskExecutionResult
  }): ReturnType<DenScheduledTaskRepository["complete"]>
}

function requireRemotePlacement(row: DueTaskRow) {
  const placement = row.worker_id && row.workspace_id
  if (!placement) throw new DenScheduledTaskServiceError("authority_unavailable")
  return {
    workerId: row.worker_id,
    workspaceId: row.workspace_id,
  }
}

export function createDenScheduledTaskService(
  overrides: Partial<DenScheduledTaskServiceDependencies> = {},
): DenScheduledTaskService {
  const dependencies: DenScheduledTaskServiceDependencies = {
    repository: databaseDenScheduledTaskRepository,
    listDueTasks: listDueDenScheduledTaskRows,
    validateAuthority: validateCurrentDenScheduledTaskAuthority,
    now: Date.now,
    leaseDurationMs: 60_000,
    startWorkerWake: (workerId) => { void wakeCloudWorker(workerId) },
    ...overrides,
  }

  return {
    list(input) {
      return dependencies.repository.listOwnedTasks({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
      })
    },

    get(input) {
      return dependencies.repository.getOwnedTask({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
        taskId: input.taskId,
      })
    },

    async createDraft(input) {
      const placement = input.definition.placement
      if (
        !placement
        || placement.target.kind !== "den-worker"
        || placement.target.organizationId !== input.organizationId
        || placement.executionPrincipal.kind !== "den-membership"
        || placement.executionPrincipal.organizationId !== input.organizationId
        || placement.executionPrincipal.membershipId !== input.memberId
        || placement.target.workspaceId !== input.definition.workspaceId
      ) {
        throw new DenScheduledTaskServiceError("invalid_placement")
      }
      const taskId = createDenTypeId("scheduledTask")
      const revisionId = createDenTypeId("scheduledTaskRevision")
      await dependencies.repository.createDraft({
        revisionRow: {
          id: revisionId,
          organization_id: input.organizationId,
          task_id: taskId,
          revision: 1,
          definition: input.definition,
          placement,
          placement_identity: scheduledTaskPlacementIdentity(placement),
          created_by_member_id: input.memberId,
        },
        taskRow: {
          id: taskId,
          organization_id: input.organizationId,
          owner_member_id: input.memberId,
          execution_member_id: input.memberId,
          worker_id: normalizeDenTypeId("worker", placement.target.workerId),
          workspace_id: placement.target.workspaceId,
          state: "draft",
          enabled: false,
          draft_revision_id: revisionId,
        },
      })
      return { taskId, revisionId }
    },

    async review(input) {
      const bundle = await dependencies.repository.getOwnedTask({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
        taskId: input.taskId,
      })
      if (!bundle) throw new DenScheduledTaskServiceError("not_found")
      if (bundle.draftRevision.id !== input.review.expectedRevisionId) {
        throw new DenScheduledTaskServiceError("revision_conflict")
      }
      const placement = bundle.draftRevision.definition.placement
      if (!placement || placement.target.kind !== "den-worker") {
        throw new DenScheduledTaskServiceError("invalid_placement")
      }
      const now = dependencies.now()
      const grant = scheduledTaskGrantSchema.parse({
        id: createDenTypeId("scheduledTaskGrant"),
        taskId: input.taskId,
        revision: 1,
        taskRevisionId: bundle.draftRevision.id,
        workspaceId: bundle.draftRevision.definition.workspaceId,
        placement,
        placementIdentity: scheduledTaskPlacementIdentity(placement),
        filesystemScope: input.review.filesystemScope,
        authorizedWorkspaceRoots: [],
        capabilityIds: input.review.capabilityIds,
        actionClasses: input.review.actionClasses,
        filesystem: input.review.filesystem,
        maximumRuntimeMs: input.review.maximumRuntimeMs,
        model: input.review.model,
        communicationPolicy: "deny",
        destructiveActionPolicy: "deny",
        selfModificationPolicy: "deny",
        grantor: input.memberId,
        reviewedAt: now,
        expiresAt: input.review.expiresAt,
        revokedAt: null,
        revocationReason: null,
        createdAt: now,
      })
      const authority = await dependencies.validateAuthority({
        definition: bundle.draftRevision.definition,
        grant,
        now,
      })
      if (
        !authority.ok
        && authority.code !== "worker-stopped"
        && authority.code !== "worker-starting"
      ) {
        throw new DenScheduledTaskServiceError("authority_unavailable")
      }
      const reviewedRevision = scheduledTaskRevisionSchema.parse({
        ...bundle.draftRevision,
        reviewedAt: now,
        reviewedBy: input.memberId,
      })
      const activated = await dependencies.repository.activateGrant({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
        taskId: input.taskId,
        expectedRevisionId: normalizeDenTypeId(
          "scheduledTaskRevision",
          bundle.draftRevision.id,
        ),
        reviewedRevision,
        grantRow: {
          id: normalizeDenTypeId("scheduledTaskGrant", grant.id),
          organization_id: input.organizationId,
          task_id: input.taskId,
          task_revision_id: normalizeDenTypeId(
            "scheduledTaskRevision",
            grant.taskRevisionId,
          ),
          revision: grant.revision,
          grant,
          placement_identity: grant.placementIdentity ?? "",
          reviewed_by_member_id: input.memberId,
          reviewed_at: new Date(now),
          expires_at: grant.expiresAt === null ? null : new Date(grant.expiresAt),
        },
      })
      if (!activated) throw new DenScheduledTaskServiceError("revision_conflict")
      return grant
    },

    async enable(input) {
      const bundle = await dependencies.repository.getOwnedTask({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
        taskId: input.taskId,
      })
      if (!bundle?.activeRevision || !bundle.grant) {
        throw new DenScheduledTaskServiceError("not_found")
      }
      if (bundle.activeRevision.definition.schedule.kind === "manual") {
        throw new DenScheduledTaskServiceError("manual_only")
      }
      const now = dependencies.now()
      const authority = await dependencies.validateAuthority({
        definition: bundle.activeRevision.definition,
        grant: bundle.grant,
        now,
      })
      if (
        !authority.ok
        && authority.code !== "worker-stopped"
        && authority.code !== "worker-starting"
      ) {
        throw new DenScheduledTaskServiceError("authority_unavailable")
      }
      const nextDueAt = nextScheduledTaskOccurrence(
        bundle.activeRevision.definition.schedule,
        now,
      )
      const updated = await dependencies.repository.setOwnedScheduleState({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
        taskId: input.taskId,
        expectedRevisionId: normalizeDenTypeId(
          "scheduledTaskRevision",
          bundle.activeRevision.id,
        ),
        expectedGrantId: normalizeDenTypeId(
          "scheduledTaskGrant",
          bundle.grant.id,
        ),
        state: "enabled",
        enabled: true,
        nextDueAt,
        preserveExistingDue: true,
        now,
      })
      if (!updated) throw new DenScheduledTaskServiceError("revision_conflict")
      return updated
    },

    async pause(input) {
      const bundle = await dependencies.repository.getOwnedTask({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
        taskId: input.taskId,
      })
      if (!bundle?.activeRevision || !bundle.grant) {
        throw new DenScheduledTaskServiceError("not_found")
      }
      const updated = await dependencies.repository.setOwnedScheduleState({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
        taskId: input.taskId,
        expectedRevisionId: normalizeDenTypeId(
          "scheduledTaskRevision",
          bundle.activeRevision.id,
        ),
        expectedGrantId: normalizeDenTypeId(
          "scheduledTaskGrant",
          bundle.grant.id,
        ),
        state: "paused",
        enabled: false,
        nextDueAt: null,
        preserveExistingDue: false,
        now: dependencies.now(),
      })
      if (!updated) throw new DenScheduledTaskServiceError("revision_conflict")
      return updated
    },

    async runOnce(input) {
      const bundle = await dependencies.repository.getOwnedTask({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
        taskId: input.taskId,
      })
      if (!bundle?.activeRevision || !bundle.grant) {
        throw new DenScheduledTaskServiceError("not_found")
      }
      const placement = bundle.activeRevision.definition.placement
      if (!placement || placement.target.kind !== "den-worker") {
        throw new DenScheduledTaskServiceError("invalid_placement")
      }
      const now = dependencies.now()
      const authority = await dependencies.validateAuthority({
        definition: bundle.activeRevision.definition,
        grant: bundle.grant,
        now,
      })
      if (
        !authority.ok
        && authority.code !== "worker-stopped"
        && authority.code !== "worker-starting"
      ) {
        throw new DenScheduledTaskServiceError("authority_unavailable")
      }
      const occurrence = scheduledTaskOccurrenceIdentity({
        taskId: input.taskId,
        taskRevisionId: bundle.activeRevision.id,
        trigger: "manual",
        scheduledFor: null,
        nonce: input.nonce,
      })
      const queued = await dependencies.repository.enqueueRunOnce({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
        taskId: input.taskId,
        runRow: {
          id: createDenTypeId("scheduledTaskRun"),
          organization_id: input.organizationId,
          task_id: input.taskId,
          task_revision_id: normalizeDenTypeId(
            "scheduledTaskRevision",
            bundle.activeRevision.id,
          ),
          grant_revision_id: normalizeDenTypeId(
            "scheduledTaskGrant",
            bundle.grant.id,
          ),
          owner_member_id: input.memberId,
          execution_member_id: normalizeDenTypeId(
            "member",
            placement.executionPrincipal.kind === "den-membership"
              ? placement.executionPrincipal.membershipId
              : input.memberId,
          ),
          worker_id: normalizeDenTypeId("worker", placement.target.workerId),
          workspace_id: placement.target.workspaceId,
          placement,
          occurrence_id: occurrence.occurrenceId,
          trigger: "manual",
          status: "scheduled",
          scheduled_for: null,
          claimed_at: new Date(now),
          dispatch_deadline: new Date(denScheduledTaskDispatchDeadline({
            queuedAt: now,
            scheduledFor: null,
            reviewedGraceMs: bundle.activeRevision.definition.missedRunPolicy.graceMs,
          })),
          idempotency_key: occurrence.idempotencyKey,
          attempt_count: 0,
          bounded_usage: EMPTY_USAGE,
        },
      })
      if (!authority.ok && authority.code === "worker-stopped") {
        dependencies.startWorkerWake(
          normalizeDenTypeId("worker", placement.target.workerId),
        )
      }
      return queued
    },

    receipt(input) {
      return dependencies.repository.getOwnedRunReceipt({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
        taskId: input.taskId,
        runId: input.runId,
      })
    },

    cancel(input) {
      return dependencies.repository.requestCancellation({
        organizationId: input.organizationId,
        ownerMemberId: input.memberId,
        taskId: input.taskId,
        runId: input.runId,
        now: dependencies.now(),
      })
    },

    async tick(input) {
      const batchSize = Math.max(1, Math.min(Math.floor(input.batchSize ?? 100), 500))
      await dependencies.repository.recoverAbandonedExecutions({
        now: input.now,
        limit: batchSize,
      })
      const dueRows = await dependencies.listDueTasks(input.now, batchSize)
      const selectedTaskIds: string[] = []
      const claimedRunIds: string[] = []

      for (const row of dueRows) {
        if (!row.next_due_at || !row.active_revision_id || !row.active_grant_id) continue
        const target = requireRemotePlacement(row)
        const bundle = await dependencies.repository.getOwnedTask({
          organizationId: row.organization_id,
          ownerMemberId: row.owner_member_id,
          taskId: row.id,
        })
        if (!bundle?.activeRevision || !bundle.grant) continue
        const placement = bundle.activeRevision.definition.placement
        if (!placement || placement.target.kind !== "den-worker") continue
        selectedTaskIds.push(row.id)
        const authority = await dependencies.validateAuthority({
          definition: bundle.activeRevision.definition,
          grant: bundle.grant,
          now: input.now,
        })
        const scheduledFor = row.next_due_at.getTime()
        const missed = input.now - scheduledFor
          > bundle.activeRevision.definition.missedRunPolicy.graceMs
        const nextDueAt = nextScheduledTaskOccurrence(
          bundle.activeRevision.definition.schedule,
          scheduledFor,
        )
        if (missed) {
          const runId = createDenTypeId("scheduledTaskRun")
          const occurrence = scheduledTaskOccurrenceIdentity({
            taskId: row.id,
            taskRevisionId: row.active_revision_id,
            trigger: "recovery",
            scheduledFor,
          })
          const attention: ScheduledTaskNeedsAttention = {
            code: "missed-occurrence",
            message: "A scheduled occurrence was missed before its reviewed Den worker became ready.",
            repairable: true,
            runId,
            sessionId: null,
            createdAt: input.now,
          }
          await dependencies.repository.recordMissedOccurrence({
            organizationId: row.organization_id,
            ownerMemberId: row.owner_member_id,
            taskId: row.id,
            expectedDueAt: scheduledFor,
            attention,
            runRow: {
              id: runId,
              organization_id: row.organization_id,
              task_id: row.id,
              task_revision_id: row.active_revision_id,
              grant_revision_id: row.active_grant_id,
              owner_member_id: row.owner_member_id,
              execution_member_id: row.execution_member_id,
              worker_id: target.workerId,
              workspace_id: target.workspaceId,
              placement,
              occurrence_id: occurrence.occurrenceId,
              trigger: "recovery",
              status: "missed",
              scheduled_for: new Date(scheduledFor),
              claimed_at: new Date(input.now),
              dispatch_deadline: new Date(input.now),
              completed_at: new Date(input.now),
              duration_ms: 0,
              idempotency_key: occurrence.idempotencyKey,
              attempt_count: 0,
              bounded_usage: EMPTY_USAGE,
              needs_attention: attention,
            },
          })
          continue
        }
        if (
          !authority.ok
          && authority.code !== "worker-stopped"
          && authority.code !== "worker-starting"
        ) {
          continue
        }
        const occurrence = scheduledTaskOccurrenceIdentity({
          taskId: row.id,
          taskRevisionId: row.active_revision_id,
          trigger: "scheduled",
          scheduledFor,
        })
        const runId = createDenTypeId("scheduledTaskRun")
        const queued = await dependencies.repository.enqueueScheduledOccurrence({
          organizationId: row.organization_id,
          ownerMemberId: row.owner_member_id,
          taskId: row.id,
          expectedDueAt: scheduledFor,
          nextDueAt,
          now: input.now,
          runRow: {
            id: runId,
            organization_id: row.organization_id,
            task_id: row.id,
            task_revision_id: row.active_revision_id,
            grant_revision_id: row.active_grant_id,
            owner_member_id: row.owner_member_id,
            execution_member_id: row.execution_member_id,
            worker_id: target.workerId,
            workspace_id: target.workspaceId,
            placement,
            occurrence_id: occurrence.occurrenceId,
            trigger: "scheduled",
            status: "scheduled",
            scheduled_for: new Date(scheduledFor),
            claimed_at: new Date(input.now),
            dispatch_deadline: new Date(denScheduledTaskDispatchDeadline({
              queuedAt: input.now,
              scheduledFor,
              reviewedGraceMs: bundle.activeRevision.definition.missedRunPolicy.graceMs,
            })),
            idempotency_key: occurrence.idempotencyKey,
            attempt_count: 0,
            bounded_usage: EMPTY_USAGE,
          },
        })
        if (
          !authority.ok
          && authority.code === "worker-stopped"
          && queued.kind !== "stale"
        ) {
          dependencies.startWorkerWake(target.workerId)
        }
        if (
          queued.kind !== "overlap"
          && queued.kind !== "stale"
        ) claimedRunIds.push(queued.run.id)
      }

      return {
        processedAt: input.now,
        source: input.source,
        selectedTaskIds,
        claimedRunIds,
        nextDueAt: await dependencies.repository.nextDueAt(),
      }
    },

    async claim(workerId) {
      const now = dependencies.now()
      await dependencies.repository.recoverAbandonedExecutions({ now, workerId })
      const candidate = await dependencies.repository.findQueuedExecution({ workerId, now })
      if (!candidate) return null
      const placement = candidate.revision.definition.placement
      if (
        !placement
        || placement.target.kind !== "den-worker"
        || placement.target.workerId !== workerId
        || candidate.taskRow.active_run_id !== candidate.run.id
        || candidate.taskRow.active_revision_id !== candidate.revision.id
        || candidate.taskRow.active_grant_id !== candidate.grant.id
      ) {
        throw new DenScheduledTaskServiceError("authority_unavailable")
      }
      const authority = await dependencies.validateAuthority({
        definition: candidate.revision.definition,
        grant: candidate.grant,
        now,
      })
      if (!authority.ok) throw new DenScheduledTaskServiceError("authority_unavailable")

      const claimed = await dependencies.repository.claimExecution({
        workerId,
        runId: candidate.run.id as DenScheduledTaskRunId,
        now,
        leaseDurationMs: dependencies.leaseDurationMs,
      })
      if (!claimed) return null
      return {
        lease: {
          runId: claimed.run.id,
          attemptId: claimed.attempt.id,
          generation: claimed.lease.generation,
          expiresAt: claimed.lease.expiresAt,
          token: claimed.lease.token,
        },
        request: {
          runId: claimed.run.id,
          attemptId: claimed.attempt.id,
          idempotencyKey: claimed.run.idempotencyKey,
          placement,
          taskRevision: claimed.revision,
          grantRevision: claimed.grant,
        },
      }
    },

    heartbeat(input) {
      return dependencies.repository.heartbeat({
        ...input,
        now: dependencies.now(),
        leaseDurationMs: dependencies.leaseDurationMs,
      })
    },

    appendEvent(input) {
      return dependencies.repository.appendEvent({ ...input, now: dependencies.now() })
    },

    complete(input) {
      return dependencies.repository.complete({ ...input, now: dependencies.now() })
    },
  }
}
