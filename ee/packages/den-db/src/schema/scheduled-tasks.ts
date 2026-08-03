import type {
  ScheduledTaskArtifactReference,
  ScheduledTaskAttemptStatus,
  ScheduledTaskDefinition,
  ScheduledTaskExecutionEvent,
  ScheduledTaskGrant,
  ScheduledTaskNeedsAttention,
  ScheduledTaskPlacement,
  ScheduledTaskRunStatus,
  ScheduledTaskTypedError,
} from "@openwork/types/scheduled-tasks"
import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core"
import {
  compatJsonColumn,
  denTypeIdColumn,
  encryptedColumn,
  timestamps,
} from "../columns"

const taskStates = [
  "draft",
  "ready",
  "enabled",
  "paused",
  "needs-attention",
  "deleted",
] as const
const runTriggers = ["manual", "scheduled", "recovery"] as const
const runStatuses = [
  "scheduled",
  "claimed",
  "running",
  "retrying",
  "completed",
  "failed",
  "cancelled",
  "needs-attention",
  "missed",
  "skipped-overlap",
  "ambiguous",
] as const satisfies readonly ScheduledTaskRunStatus[]
const attemptStatuses = [
  "starting",
  "running",
  "completed",
  "failed",
  "cancelled",
  "needs-attention",
  "timed-out",
  "ambiguous",
] as const satisfies readonly ScheduledTaskAttemptStatus[]

const encryptedJsonColumn = <T>(name: string, dataType: "text" | "mediumtext" = "text") =>
  encryptedColumn<T>(name, {
    dataType,
    serialize: JSON.stringify,
    deserialize: (value) => JSON.parse(value) as T,
  })

export const ScheduledTaskTable = mysqlTable(
  "scheduled_task",
  {
    id: denTypeIdColumn("scheduledTask", "id").notNull().primaryKey(),
    organization_id: denTypeIdColumn("organization", "organization_id").notNull(),
    owner_member_id: denTypeIdColumn("member", "owner_member_id").notNull(),
    execution_member_id: denTypeIdColumn("member", "execution_member_id").notNull(),
    worker_id: denTypeIdColumn("worker", "worker_id").notNull(),
    workspace_id: varchar("workspace_id", { length: 240 }).notNull(),
    state: mysqlEnum("state", taskStates).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    draft_revision_id: denTypeIdColumn("scheduledTaskRevision", "draft_revision_id").notNull(),
    active_revision_id: denTypeIdColumn("scheduledTaskRevision", "active_revision_id"),
    active_grant_id: denTypeIdColumn("scheduledTaskGrant", "active_grant_id"),
    active_run_id: denTypeIdColumn("scheduledTaskRun", "active_run_id"),
    next_due_at: timestamp("next_due_at", { fsp: 3 }),
    needs_attention: compatJsonColumn<ScheduledTaskNeedsAttention | null>("needs_attention"),
    deleted_at: timestamp("deleted_at", { fsp: 3 }),
    ...timestamps,
  },
  (table) => [
    index("scheduled_task_org_owner").on(table.organization_id, table.owner_member_id),
    index("scheduled_task_worker_state").on(table.worker_id, table.state),
    index("scheduled_task_due").on(table.enabled, table.next_due_at),
  ],
)

export const ScheduledTaskRevisionTable = mysqlTable(
  "scheduled_task_revision",
  {
    id: denTypeIdColumn("scheduledTaskRevision", "id").notNull().primaryKey(),
    organization_id: denTypeIdColumn("organization", "organization_id").notNull(),
    task_id: denTypeIdColumn("scheduledTask", "task_id").notNull(),
    revision: int("revision").notNull(),
    definition: encryptedJsonColumn<ScheduledTaskDefinition>("definition", "mediumtext").notNull(),
    placement: json("placement").$type<ScheduledTaskPlacement>().notNull(),
    placement_identity: varchar("placement_identity", { length: 4096 }).notNull(),
    created_by_member_id: denTypeIdColumn("member", "created_by_member_id").notNull(),
    reviewed_at: timestamp("reviewed_at", { fsp: 3 }),
    reviewed_by_member_id: denTypeIdColumn("member", "reviewed_by_member_id"),
    created_at: timestamps.created_at,
  },
  (table) => [
    uniqueIndex("scheduled_task_revision_number").on(table.task_id, table.revision),
    index("scheduled_task_revision_org_task").on(table.organization_id, table.task_id),
  ],
)

export const ScheduledTaskGrantTable = mysqlTable(
  "scheduled_task_grant_revision",
  {
    id: denTypeIdColumn("scheduledTaskGrant", "id").notNull().primaryKey(),
    organization_id: denTypeIdColumn("organization", "organization_id").notNull(),
    task_id: denTypeIdColumn("scheduledTask", "task_id").notNull(),
    task_revision_id: denTypeIdColumn("scheduledTaskRevision", "task_revision_id").notNull(),
    revision: int("revision").notNull(),
    grant: encryptedJsonColumn<ScheduledTaskGrant>("grant", "mediumtext").notNull(),
    placement_identity: varchar("placement_identity", { length: 4096 }).notNull(),
    reviewed_by_member_id: denTypeIdColumn("member", "reviewed_by_member_id").notNull(),
    reviewed_at: timestamp("reviewed_at", { fsp: 3 }).notNull(),
    expires_at: timestamp("expires_at", { fsp: 3 }),
    revoked_at: timestamp("revoked_at", { fsp: 3 }),
    revoked_by_member_id: denTypeIdColumn("member", "revoked_by_member_id"),
    revocation_reason: varchar("revocation_reason", { length: 2000 }),
    created_at: timestamps.created_at,
  },
  (table) => [
    uniqueIndex("scheduled_task_grant_number").on(table.task_id, table.revision),
    index("scheduled_task_grant_org_task").on(table.organization_id, table.task_id),
    index("scheduled_task_grant_revision").on(table.task_revision_id),
  ],
)

export const ScheduledTaskRunTable = mysqlTable(
  "scheduled_task_run",
  {
    id: denTypeIdColumn("scheduledTaskRun", "id").notNull().primaryKey(),
    organization_id: denTypeIdColumn("organization", "organization_id").notNull(),
    task_id: denTypeIdColumn("scheduledTask", "task_id").notNull(),
    task_revision_id: denTypeIdColumn("scheduledTaskRevision", "task_revision_id").notNull(),
    grant_revision_id: denTypeIdColumn("scheduledTaskGrant", "grant_revision_id").notNull(),
    owner_member_id: denTypeIdColumn("member", "owner_member_id").notNull(),
    execution_member_id: denTypeIdColumn("member", "execution_member_id").notNull(),
    worker_id: denTypeIdColumn("worker", "worker_id").notNull(),
    workspace_id: varchar("workspace_id", { length: 240 }).notNull(),
    placement: json("placement").$type<ScheduledTaskPlacement>().notNull(),
    occurrence_id: varchar("occurrence_id", { length: 512 }).notNull(),
    trigger: mysqlEnum("trigger", runTriggers).notNull(),
    status: mysqlEnum("status", runStatuses).notNull(),
    scheduled_for: timestamp("scheduled_for", { fsp: 3 }),
    claimed_at: timestamp("claimed_at", { fsp: 3 }).notNull(),
    dispatch_deadline: timestamp("dispatch_deadline", { fsp: 3 }).notNull(),
    started_at: timestamp("started_at", { fsp: 3 }),
    completed_at: timestamp("completed_at", { fsp: 3 }),
    duration_ms: int("duration_ms"),
    idempotency_key: varchar("idempotency_key", { length: 512 }).notNull(),
    session_id: varchar("session_id", { length: 240 }),
    attempt_count: int("attempt_count").notNull().default(0),
    bounded_usage: compatJsonColumn<{
      inputTokens: number | null
      outputTokens: number | null
      costMicros: number | null
    }>("bounded_usage").notNull(),
    error: compatJsonColumn<ScheduledTaskTypedError | null>("error"),
    needs_attention: compatJsonColumn<ScheduledTaskNeedsAttention | null>("needs_attention"),
    cancel_requested_at: timestamp("cancel_requested_at", { fsp: 3 }),
    retry_not_before: timestamp("retry_not_before", { fsp: 3 }),
    result_digest: varchar("result_digest", { length: 128 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("scheduled_task_run_occurrence").on(
      table.task_revision_id,
      table.trigger,
      table.occurrence_id,
    ),
    uniqueIndex("scheduled_task_run_idempotency").on(table.task_id, table.idempotency_key),
    index("scheduled_task_run_worker_queue").on(
      table.worker_id,
      table.status,
      table.dispatch_deadline,
    ),
    index("scheduled_task_run_org_task").on(table.organization_id, table.task_id),
  ],
)

export const ScheduledTaskAttemptTable = mysqlTable(
  "scheduled_task_attempt",
  {
    id: denTypeIdColumn("scheduledTaskAttempt", "id").notNull().primaryKey(),
    organization_id: denTypeIdColumn("organization", "organization_id").notNull(),
    run_id: denTypeIdColumn("scheduledTaskRun", "run_id").notNull(),
    worker_id: denTypeIdColumn("worker", "worker_id").notNull(),
    attempt: int("attempt").notNull(),
    status: mysqlEnum("status", attemptStatuses).notNull(),
    lease_generation: int("lease_generation").notNull(),
    lease_token_hash: varchar("lease_token_hash", { length: 128 }).notNull(),
    lease_expires_at: timestamp("lease_expires_at", { fsp: 3 }).notNull(),
    last_heartbeat_at: timestamp("last_heartbeat_at", { fsp: 3 }).notNull(),
    session_id: varchar("session_id", { length: 240 }),
    started_at: timestamp("started_at", { fsp: 3 }).notNull(),
    completed_at: timestamp("completed_at", { fsp: 3 }),
    error: compatJsonColumn<ScheduledTaskTypedError | null>("error"),
    result_digest: varchar("result_digest", { length: 128 }),
    created_at: timestamps.created_at,
  },
  (table) => [
    uniqueIndex("scheduled_task_attempt_number").on(table.run_id, table.attempt),
    index("scheduled_task_attempt_worker_lease").on(
      table.worker_id,
      table.status,
      table.lease_expires_at,
    ),
  ],
)

export const ScheduledTaskEventTable = mysqlTable(
  "scheduled_task_execution_event",
  {
    id: denTypeIdColumn("scheduledTaskEvent", "id").notNull().primaryKey(),
    organization_id: denTypeIdColumn("organization", "organization_id").notNull(),
    run_id: denTypeIdColumn("scheduledTaskRun", "run_id").notNull(),
    attempt_id: denTypeIdColumn("scheduledTaskAttempt", "attempt_id").notNull(),
    sequence: int("sequence").notNull(),
    event_type: varchar("event_type", { length: 64 }).notNull(),
    event: compatJsonColumn<ScheduledTaskExecutionEvent>("event").notNull(),
    event_digest: varchar("event_digest", { length: 128 }).notNull(),
    created_at: timestamps.created_at,
  },
  (table) => [
    uniqueIndex("scheduled_task_event_sequence").on(table.attempt_id, table.sequence),
    index("scheduled_task_event_org_run").on(table.organization_id, table.run_id),
  ],
)

export const ScheduledTaskArtifactTable = mysqlTable(
  "scheduled_task_artifact",
  {
    id: denTypeIdColumn("scheduledTaskArtifact", "id").notNull().primaryKey(),
    organization_id: denTypeIdColumn("organization", "organization_id").notNull(),
    run_id: denTypeIdColumn("scheduledTaskRun", "run_id").notNull(),
    attempt_id: denTypeIdColumn("scheduledTaskAttempt", "attempt_id").notNull(),
    kind: mysqlEnum("kind", ["file", "url"]).notNull(),
    value: varchar("value", { length: 8192 }).notNull(),
    name: varchar("name", { length: 512 }),
    reference: compatJsonColumn<ScheduledTaskArtifactReference>("reference").notNull(),
    created_at: timestamps.created_at,
  },
  (table) => [index("scheduled_task_artifact_org_run").on(table.organization_id, table.run_id)],
)

export const ScheduledTaskTickInvocationTable = mysqlTable(
  "scheduled_task_tick_invocation",
  {
    id: denTypeIdColumn("scheduledTaskTick", "id").notNull().primaryKey(),
    request_id: varchar("request_id", { length: 240 }).notNull(),
    source: mysqlEnum("source", ["vercel-cron", "den-loop"]).notNull(),
    request_digest: varchar("request_digest", { length: 128 }).notNull(),
    processed_at: timestamp("processed_at", { fsp: 3 }),
    created_at: timestamps.created_at,
  },
  (table) => [uniqueIndex("scheduled_task_tick_request").on(table.request_id)],
)
