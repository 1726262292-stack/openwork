import {
  scheduledTaskAttemptSchema,
  scheduledTaskDefinitionSchema,
  scheduledTaskGrantSchema,
  scheduledTaskPlacementSchema,
  scheduledTaskRevisionSchema,
  scheduledTaskRunSchema,
  scheduledTaskSchema,
  type ScheduledTask,
  type ScheduledTaskAttempt,
  type ScheduledTaskFilesystemScope,
  type ScheduledTaskGrant,
  type ScheduledTaskPlacement,
  type ScheduledTaskRevision,
  type ScheduledTaskRun,
} from "@openwork/types/scheduled-tasks"
import type { Awaitable, ScheduledTaskRepository } from "./ports.js"
import {
  scheduledTaskPlacementIdentity,
  type ScheduledTaskRepositoryFilter,
} from "./contracts.js"

export interface ScheduledTaskRepositoryConformanceFixtureIds {
  taskId: string
  revision1Id: string
  revision2Id: string
  reviewedRevisionId: string
  grantId: string
  run1Id: string
  run1OverlapTemplateId: string
  run1DuplicateId: string
  run2Id: string
  run2OverlapId: string
  attemptId: string
}

export interface ScheduledTaskRepositoryConformanceFixtureOptions {
  ids?: ScheduledTaskRepositoryConformanceFixtureIds
  workspaceId?: string
  placement?: ScheduledTaskPlacement
  filesystemScope?: ScheduledTaskFilesystemScope
  authorizedWorkspaceRoots?: readonly string[]
  targetScope?: ScheduledTaskRepositoryFilter
  isolationScope?: ScheduledTaskRepositoryFilter
  actorId?: string
  revokerId?: string
  sessionId?: string
}

export interface ScheduledTaskRepositoryConformanceOptions {
  createRepository(): Awaitable<ScheduledTaskRepository>
  fixtures?: ScheduledTaskRepositoryConformanceFixtureOptions
}

export interface ScheduledTaskRepositoryConformanceResult {
  checked: string[]
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ScheduledTaskRepository conformance: ${message}`)
}

const DEFAULT_FIXTURE_IDS: ScheduledTaskRepositoryConformanceFixtureIds = {
  taskId: "task_conformance",
  revision1Id: "rev_conformance_1",
  revision2Id: "rev_conformance_2",
  reviewedRevisionId: "rev_conformance_3",
  grantId: "grant_conformance_1",
  run1Id: "run_conformance_1",
  run1OverlapTemplateId: "run_conformance_overlap_template",
  run1DuplicateId: "run_conformance_duplicate",
  run2Id: "run_conformance_2",
  run2OverlapId: "run_conformance_overlap_2",
  attemptId: "attempt_conformance_1",
}

function createFixtures(options: ScheduledTaskRepositoryConformanceFixtureOptions = {}) {
  const createdAt = 1_000
  const ids = options.ids ?? DEFAULT_FIXTURE_IDS
  const defaultActorId = "member_conformance"
  const workspaceId = options.placement?.target.workspaceId
    ?? options.workspaceId
    ?? "ws_conformance"
  const placement = scheduledTaskPlacementSchema.parse(
    options.placement ?? {
      target: { kind: "local-workspace", workspaceId },
      schedulerOwner: "local-server",
      executionAvailability: "app-open",
      executionPrincipal: { kind: "local-user", identityId: defaultActorId },
      capabilityReferences: [{
        id: "workspace.files.read",
        source: "openwork",
        actionClass: "read",
        reviewedVersion: "1",
        reviewedDigest: null,
      }],
    },
  )
  const actorId = options.actorId ?? (
    placement.executionPrincipal.kind === "den-membership"
      ? placement.executionPrincipal.membershipId
      : placement.executionPrincipal.identityId
  )
  const definition = scheduledTaskDefinitionSchema.parse({
    name: "Repository conformance",
    description: "Portable repository behavior",
    prompt: "Write a deterministic result.",
    workspaceId,
    placement,
    schedule: {
      kind: "daily",
      timezone: "UTC",
      hour: 9,
      minute: 0,
    },
    model: { providerId: null, modelId: null, agent: null },
    maximumRuntimeMs: 60_000,
    overlapPolicy: "skip",
    retryPolicy: { maximumAttempts: 1, delayMs: 0 },
    missedRunPolicy: {
      kind: "skip",
      graceMs: 60_000,
      maximumRecoverableOccurrences: 1,
    },
  })
  const revision1 = scheduledTaskRevisionSchema.parse({
    id: ids.revision1Id,
    taskId: ids.taskId,
    revision: 1,
    definition,
    createdAt,
    createdBy: actorId,
    reviewedAt: null,
    reviewedBy: null,
  })
  const task1 = scheduledTaskSchema.parse({
    id: revision1.taskId,
    workspaceId,
    state: "draft",
    enabled: false,
    draftRevisionId: revision1.id,
    activeRevisionId: null,
    activeGrantId: null,
    nextRunAt: null,
    needsAttention: null,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  })
  const revision2 = scheduledTaskRevisionSchema.parse({
    ...revision1,
    id: ids.revision2Id,
    revision: 2,
    createdAt: createdAt + 1,
  })
  const task2 = scheduledTaskSchema.parse({
    ...task1,
    draftRevisionId: revision2.id,
    updatedAt: createdAt + 1,
  })
  const reviewedRevision = scheduledTaskRevisionSchema.parse({
    ...revision2,
    id: ids.reviewedRevisionId,
    revision: 3,
    createdAt: createdAt + 2,
    reviewedAt: createdAt + 2,
    reviewedBy: actorId,
  })
  const grant = scheduledTaskGrantSchema.parse({
    id: ids.grantId,
    taskId: task1.id,
    revision: 1,
    taskRevisionId: reviewedRevision.id,
    workspaceId,
    placement,
    placementIdentity: scheduledTaskPlacementIdentity(placement),
    filesystemScope: options.filesystemScope ?? {
      kind: "local-workspace-roots",
      roots: ["/conformance/workspace"],
    },
    authorizedWorkspaceRoots: [
      ...(options.authorizedWorkspaceRoots ?? ["/conformance/workspace"]),
    ],
    capabilityIds: ["workspace.files.read"],
    actionClasses: ["read"],
    filesystem: { read: true, write: false },
    maximumRuntimeMs: definition.maximumRuntimeMs,
    model: definition.model,
    communicationPolicy: "deny",
    destructiveActionPolicy: "deny",
    selfModificationPolicy: "deny",
    grantor: actorId,
    reviewedAt: createdAt + 2,
    expiresAt: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: createdAt + 2,
  })
  const activeTask = scheduledTaskSchema.parse({
    ...task2,
    state: "enabled",
    enabled: true,
    draftRevisionId: reviewedRevision.id,
    activeRevisionId: reviewedRevision.id,
    activeGrantId: grant.id,
    nextRunAt: createdAt + 100,
    updatedAt: createdAt + 2,
  })
  return {
    createdAt,
    workspaceId,
    revision1,
    task1,
    revision2,
    task2,
    reviewedRevision,
    grant,
    activeTask,
    placement,
    ids,
    targetScope: options.targetScope ?? {
      kind: "target",
      target: placement.target,
    },
    isolationScope: options.isolationScope ?? {
      kind: "scheduler-owner",
      schedulerOwner: "den",
      organizationId: "org_other",
    },
    revokerId: options.revokerId ?? actorId,
    sessionId: options.sessionId ?? "session_conformance_1",
  }
}

function runFixture(input: {
  id: string
  occurrenceId: string
  idempotencyKey: string
  task: ScheduledTask
  revision: ScheduledTaskRevision
  grant: ScheduledTaskGrant
  claimedAt: number
  status?: ScheduledTaskRun["status"]
}): ScheduledTaskRun {
  return scheduledTaskRunSchema.parse({
    id: input.id,
    taskId: input.task.id,
    taskRevisionId: input.revision.id,
    grantRevisionId: input.grant.id,
    placement: input.grant.placement,
    occurrenceId: input.occurrenceId,
    trigger: "scheduled",
    status: input.status ?? "claimed",
    scheduledFor: input.claimedAt,
    claimedAt: input.claimedAt,
    startedAt: null,
    completedAt: input.status === "skipped-overlap" ? input.claimedAt : null,
    durationMs: input.status === "skipped-overlap" ? 0 : null,
    idempotencyKey: input.idempotencyKey,
    sessionId: null,
    attemptCount: 0,
    boundedUsage: { inputTokens: null, outputTokens: null, costMicros: null },
    error: null,
    needsAttention: null,
    artifacts: [],
    cancelRequestedAt: null,
    createdAt: input.claimedAt,
    updatedAt: input.claimedAt,
  })
}

function attemptFixture(input: {
  run: ScheduledTaskRun
  attemptId: string
  sessionId: string
}): ScheduledTaskAttempt {
  return scheduledTaskAttemptSchema.parse({
    id: input.attemptId,
    runId: input.run.id,
    attempt: 1,
    status: "running",
    sessionId: input.sessionId,
    startedAt: input.run.claimedAt + 1,
    completedAt: null,
    error: null,
  })
}

/**
 * Framework-neutral adapter contract. SQLite and Den MySQL tests call this
 * same verifier with their own isolated repository factory.
 */
export async function verifyScheduledTaskRepositoryConformance(
  options: ScheduledTaskRepositoryConformanceOptions,
): Promise<ScheduledTaskRepositoryConformanceResult> {
  const repository = await options.createRepository()
  const checked: string[] = []
  const fixtures = createFixtures(options.fixtures)
  try {
    await repository.createTask(fixtures.task1, fixtures.revision1)
    invariant(
      (await repository.getTask(fixtures.task1.id))?.draftRevisionId ===
        fixtures.revision1.id,
      "createTask must persist the task and initial revision atomically",
    )
    checked.push("task-and-initial-revision")

    await repository.createRevision(fixtures.task2, fixtures.revision2)
    invariant(
      (await repository.getRevision(fixtures.revision2.id))?.revision === 2,
      "createRevision must persist immutable revision history",
    )
    checked.push("immutable-revisions")

    await repository.activateGrant(
      fixtures.activeTask,
      fixtures.reviewedRevision,
      fixtures.grant,
    )
    const detail = await repository.getDetail(fixtures.activeTask.id)
    invariant(
      detail?.activeRevision?.id === fixtures.reviewedRevision.id &&
        detail.grant?.id === fixtures.grant.id,
      "activateGrant must atomically bind the reviewed revision and grant",
    )
    checked.push("reviewed-authority-binding")

    const due = await repository.listDueTasks(fixtures.createdAt + 100)
    invariant(
      due.map((task) => task.id).includes(fixtures.activeTask.id),
      "listDueTasks must return enabled due tasks",
    )
    invariant(
      (await repository.nextDueAt(fixtures.workspaceId)) ===
        fixtures.createdAt + 100,
      "nextDueAt must expose the earliest enabled occurrence",
    )
    invariant(
      (await repository.listTasks(fixtures.targetScope)).some(
        (item) => item.task.id === fixtures.activeTask.id,
      ),
      "target scopes must select tasks bound to that execution target",
    )
    invariant(
      (await repository.listTasks(fixtures.isolationScope)).length === 0,
      "scheduler-owner scopes must not leak tasks from another runtime",
    )
    checked.push("due-selection")
    checked.push("runtime-scope-isolation")

    const run = runFixture({
      id: fixtures.ids.run1Id,
      occurrenceId: "occ_conformance_1",
      idempotencyKey: "scheduled:conformance:1",
      task: fixtures.activeTask,
      revision: fixtures.reviewedRevision,
      grant: fixtures.grant,
      claimedAt: fixtures.createdAt + 100,
    })
    const overlap = runFixture({
      id: fixtures.ids.run1OverlapTemplateId,
      occurrenceId: run.occurrenceId,
      idempotencyKey: run.idempotencyKey,
      task: fixtures.activeTask,
      revision: fixtures.reviewedRevision,
      grant: fixtures.grant,
      claimedAt: run.claimedAt,
      status: "skipped-overlap",
    })
    const taskAfterClaim = scheduledTaskSchema.parse({
      ...fixtures.activeTask,
      nextRunAt: fixtures.createdAt + 200,
      updatedAt: fixtures.createdAt + 100,
    })
    const claimed = await repository.claimOccurrence(
      {
        id: run.occurrenceId,
        taskId: run.taskId,
        taskRevisionId: run.taskRevisionId,
        scheduledFor: run.scheduledFor,
        trigger: run.trigger,
        status: run.status,
        claimedAt: run.claimedAt,
      },
      run,
      overlap,
      taskAfterClaim,
    )
    invariant(claimed.kind === "claimed", "the first occurrence must be claimed")
    const duplicate = await repository.claimOccurrence(
      {
        id: run.occurrenceId,
        taskId: run.taskId,
        taskRevisionId: run.taskRevisionId,
        scheduledFor: run.scheduledFor,
        trigger: run.trigger,
        status: run.status,
        claimedAt: run.claimedAt,
      },
      runFixture({
        id: fixtures.ids.run1DuplicateId,
        occurrenceId: run.occurrenceId,
        idempotencyKey: run.idempotencyKey,
        task: fixtures.activeTask,
        revision: fixtures.reviewedRevision,
        grant: fixtures.grant,
        claimedAt: run.claimedAt,
      }),
      overlap,
    )
    invariant(
      duplicate.kind === "duplicate" && duplicate.run.id === run.id,
      "claimOccurrence must return the original run for a duplicate identity",
    )
    checked.push("atomic-idempotent-claim")

    const secondRun = runFixture({
      id: fixtures.ids.run2Id,
      occurrenceId: "occ_conformance_2",
      idempotencyKey: "scheduled:conformance:2",
      task: taskAfterClaim,
      revision: fixtures.reviewedRevision,
      grant: fixtures.grant,
      claimedAt: fixtures.createdAt + 200,
    })
    const secondOverlap = runFixture({
      id: fixtures.ids.run2OverlapId,
      occurrenceId: secondRun.occurrenceId,
      idempotencyKey: secondRun.idempotencyKey,
      task: taskAfterClaim,
      revision: fixtures.reviewedRevision,
      grant: fixtures.grant,
      claimedAt: secondRun.claimedAt,
      status: "skipped-overlap",
    })
    const overlapResult = await repository.claimOccurrence(
      {
        id: secondRun.occurrenceId,
        taskId: secondRun.taskId,
        taskRevisionId: secondRun.taskRevisionId,
        scheduledFor: secondRun.scheduledFor,
        trigger: secondRun.trigger,
        status: secondRun.status,
        claimedAt: secondRun.claimedAt,
      },
      secondRun,
      secondOverlap,
    )
    invariant(
      overlapResult.kind === "overlap" &&
        overlapResult.run.status === "skipped-overlap",
      "an active run must make the next occurrence a durable overlap result",
    )
    checked.push("atomic-overlap-policy")

    const attempt = attemptFixture({
      run,
      attemptId: fixtures.ids.attemptId,
      sessionId: fixtures.sessionId,
    })
    await repository.createAttempt(attempt)
    invariant(
      (await repository.listAttempts(run.id))[0]?.id === attempt.id,
      "attempts must be listed in attempt order",
    )
    await repository.saveAttempt(
      scheduledTaskAttemptSchema.parse({
        ...attempt,
        status: "completed",
        completedAt: fixtures.createdAt + 150,
      }),
    )
    checked.push("attempt-ledger")

    const completedRun = scheduledTaskRunSchema.parse({
      ...run,
      status: "completed",
      completedAt: fixtures.createdAt + 150,
      durationMs: 50,
      attemptCount: 1,
      updatedAt: fixtures.createdAt + 150,
    })
    await repository.saveRun(completedRun)
    invariant(
      (await repository.getRun(run.id))?.status === "completed",
      "saveRun must durably update a claimed run",
    )
    invariant(
      (await repository.listInterruptedRuns()).every(
        (interrupted) => interrupted.id !== run.id,
      ),
      "terminal runs must not be returned as interrupted",
    )
    checked.push("durable-terminal-run")

    const revoked = await repository.revokeGrant(
      fixtures.grant.id,
      fixtures.createdAt + 300,
      "conformance revocation",
      fixtures.revokerId,
    )
    invariant(
      revoked.revokedAt === fixtures.createdAt + 300 &&
        (await repository.getGrant(fixtures.grant.id))?.revokedAt ===
          fixtures.createdAt + 300,
      "grant revocation must be durable and observable",
    )
    checked.push("grant-revocation")

    return { checked }
  } finally {
    await repository.close()
  }
}
