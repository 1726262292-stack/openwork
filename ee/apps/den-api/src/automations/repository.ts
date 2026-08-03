import {
  AUTOMATION_DEFAULT_MAXIMUM_RUNTIME_MS,
  AUTOMATION_MAXIMUM_ATTEMPTS,
  automationEngineAdmissionReceiptSchema,
  automationEngineEventSchema,
  automationOccurrenceIdentity,
  automationRevisionDigest,
  nextAutomationOccurrence,
} from "@openwork/automations"
import type {
  AutomationEngineAdmissionReceipt,
  AutomationEngineEvent,
  AutomationClaimResult,
  AutomationListItem,
  AutomationRepository,
} from "@openwork/automations"
import type {
  Automation,
  AutomationRevision,
  AutomationRun,
  AutomationRunEvent,
  AutomationRunEventType,
  AutomationUsage,
} from "@openwork/types/automations"
import { and, asc, desc, eq, inArray, lt, sql } from "@openwork-ee/den-db/drizzle"
import {
  AutomationRevisionTable,
  AutomationRunEventTable,
  AutomationRunTable,
  AutomationTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "../db.js"

type AutomationRow = typeof AutomationTable.$inferSelect
type RevisionRow = typeof AutomationRevisionTable.$inferSelect
type RunRow = typeof AutomationRunTable.$inferSelect
type EventRow = typeof AutomationRunEventTable.$inferSelect

const emptyUsage: AutomationUsage = { inputTokens: null, outputTokens: null, costMicros: null }

const normalizeAutomationId = (value: string) => normalizeDenTypeId("automation", value)
const normalizeRevisionId = (value: string) => normalizeDenTypeId("automationRevision", value)
const normalizeRunId = (value: string) => normalizeDenTypeId("automationRun", value)
const normalizeOrganizationId = (value: string) => normalizeDenTypeId("organization", value)
const normalizeMemberId = (value: string) => normalizeDenTypeId("member", value)

const ms = (value: Date | null): number | null => value?.getTime() ?? null
const date = (value: number | null): Date | null => value === null ? null : new Date(value)

function mapAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ownerMemberId: row.owner_member_id,
    name: row.name,
    state: row.state,
    currentRevisionId: row.current_revision_id,
    nextDueAt: ms(row.next_due_at),
    latestRunAt: ms(row.latest_run_at),
    needsAttentionReason: row.needs_attention_reason ?? null,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    archivedAt: ms(row.archived_at),
  }
}

function mapRevision(row: RevisionRow): AutomationRevision {
  return {
    id: row.id,
    automationId: row.automation_id,
    version: row.version,
    instructions: row.instructions,
    schedule: row.schedule_config,
    model: { providerId: row.provider_id, modelId: row.model_id },
    maximumRuntimeMs: row.maximum_runtime_ms,
    digest: row.digest,
    createdAt: row.created_at.getTime(),
  }
}

function mapRun(row: RunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    revisionId: row.revision_id,
    trigger: row.trigger,
    scheduledFor: ms(row.scheduled_for),
    idempotencyKey: row.idempotency_key,
    status: row.status,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: ms(row.lease_expires_at),
    heartbeatAt: ms(row.heartbeat_at),
    attemptCount: row.attempt_count,
    cloudThread: row.engine_kind ? {
      id: row.cloud_thread_id,
      threadKind: "automation",
      executionLocation: "cloud",
      automationId: row.automation_id,
      automationRunId: row.id,
      engineKind: row.engine_kind,
    } : null,
    providerId: row.provider_id,
    modelId: row.model_id,
    startedAt: ms(row.started_at),
    finishedAt: ms(row.finished_at),
    error: row.error ?? null,
    resultSummary: row.result_summary,
    usage: row.usage,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  }
}

function mapEvent(row: EventRow): AutomationRunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.event_type,
    payload: row.payload,
    createdAt: row.created_at.getTime(),
  }
}

async function latestRun(automationId: AutomationRow["id"]): Promise<AutomationRun | null> {
  const rows = await db.select().from(AutomationRunTable)
    .where(eq(AutomationRunTable.automation_id, automationId))
    .orderBy(desc(AutomationRunTable.created_at), desc(AutomationRunTable.id)).limit(1)
  return rows[0] ? mapRun(rows[0]) : null
}

async function itemFromRows(automation: AutomationRow, revision: RevisionRow): Promise<AutomationListItem> {
  return { automation: mapAutomation(automation), revision: mapRevision(revision), latestRun: await latestRun(automation.id) }
}

export class DenAutomationRepository implements AutomationRepository {
  async create(input: Parameters<AutomationRepository["create"]>[0]): Promise<AutomationListItem> {
    const now = new Date(input.now)
    const newAutomationId = createDenTypeId("automation")
    const newRevisionId = createDenTypeId("automationRevision")
    const maximumRuntimeMs = AUTOMATION_DEFAULT_MAXIMUM_RUNTIME_MS
    const digest = automationRevisionDigest({
      instructions: input.definition.instructions,
      schedule: input.definition.schedule,
      model: input.definition.model,
      maximumRuntimeMs,
    })
    const nextDueAt = nextAutomationOccurrence(input.definition.schedule, input.now)
    await db.transaction(async (tx) => {
      await tx.insert(AutomationRevisionTable).values({
        id: newRevisionId,
        automation_id: newAutomationId,
        version: 1,
        instructions: input.definition.instructions,
        schedule_kind: input.definition.schedule.kind,
        schedule_config: input.definition.schedule,
        timezone: input.definition.schedule.timezone,
        provider_id: input.definition.model.providerId,
        model_id: input.definition.model.modelId,
        maximum_runtime_ms: maximumRuntimeMs,
        digest,
        created_at: now,
      })
      await tx.insert(AutomationTable).values({
        id: newAutomationId,
        organization_id: normalizeOrganizationId(input.organizationId),
        owner_member_id: normalizeMemberId(input.ownerMemberId),
        name: input.definition.name,
        state: "active",
        current_revision_id: newRevisionId,
        next_due_at: date(nextDueAt),
        needs_attention_reason: null,
        archived_at: null,
        created_at: now,
        updated_at: now,
      })
    })
    const created = await this.get({
      organizationId: input.organizationId,
      ownerMemberId: input.ownerMemberId,
      automationId: newAutomationId,
    })
    if (!created) throw new Error("automation_create_not_durable")
    return created
  }

  async update(input: Parameters<AutomationRepository["update"]>[0]): Promise<AutomationListItem> {
    await db.transaction(async (tx) => {
      const automationRows = await tx.select().from(AutomationTable).where(and(
        eq(AutomationTable.id, normalizeAutomationId(input.automationId)),
        eq(AutomationTable.organization_id, normalizeOrganizationId(input.organizationId)),
        eq(AutomationTable.owner_member_id, normalizeMemberId(input.ownerMemberId)),
      )).limit(1).for("update")
      const automation = automationRows[0]
      if (!automation || automation.state === "archived") throw new Error("automation_not_found")
      const revisionRows = await tx.select().from(AutomationRevisionTable)
        .where(eq(AutomationRevisionTable.id, automation.current_revision_id)).limit(1)
      const current = revisionRows[0]
      if (!current) throw new Error("automation_revision_not_found")
      const instructions = input.changes.instructions ?? current.instructions
      const schedule = input.changes.schedule ?? current.schedule_config
      const model = input.changes.model ?? { providerId: current.provider_id, modelId: current.model_id }
      const newRevisionId = createDenTypeId("automationRevision")
      const digest = automationRevisionDigest({
        instructions,
        schedule,
        model,
        maximumRuntimeMs: current.maximum_runtime_ms,
      })
      await tx.insert(AutomationRevisionTable).values({
        id: newRevisionId,
        automation_id: automation.id,
        version: current.version + 1,
        instructions,
        schedule_kind: schedule.kind,
        schedule_config: schedule,
        timezone: schedule.timezone,
        provider_id: model.providerId,
        model_id: model.modelId,
        maximum_runtime_ms: current.maximum_runtime_ms,
        digest,
        created_at: new Date(input.now),
      })
      await tx.update(AutomationTable).set({
        name: input.changes.name ?? automation.name,
        current_revision_id: newRevisionId,
        next_due_at: date(nextAutomationOccurrence(schedule, input.now)),
        state: "active",
        needs_attention_reason: null,
        updated_at: new Date(input.now),
      }).where(eq(AutomationTable.id, automation.id))
    })
    const updated = await this.get(input)
    if (!updated) throw new Error("automation_update_not_durable")
    return updated
  }

  async list(input: Parameters<AutomationRepository["list"]>[0]): Promise<Awaited<ReturnType<AutomationRepository["list"]>>> {
    const limit = Math.max(1, Math.min(input.limit, 100))
    const conditions = [
      eq(AutomationTable.organization_id, normalizeOrganizationId(input.organizationId)),
      eq(AutomationTable.owner_member_id, normalizeMemberId(input.ownerMemberId)),
    ]
    if (input.cursor) conditions.push(lt(AutomationTable.id, normalizeAutomationId(input.cursor)))
    const rows = await db.select().from(AutomationTable).where(and(...conditions))
      .orderBy(desc(AutomationTable.id)).limit(limit + 1)
    const selected = rows.slice(0, limit)
    const items = await Promise.all(selected.map(async (automation) => {
      const revisions = await db.select().from(AutomationRevisionTable)
        .where(eq(AutomationRevisionTable.id, automation.current_revision_id)).limit(1)
      if (!revisions[0]) throw new Error("automation_revision_not_found")
      return itemFromRows(automation, revisions[0])
    }))
    return { items: await Promise.all(items), nextCursor: rows.length > limit ? selected.at(-1)?.id ?? null : null }
  }

  async get(input: Parameters<AutomationRepository["get"]>[0]): Promise<AutomationListItem | null> {
    const rows = await db.select().from(AutomationTable).where(and(
      eq(AutomationTable.id, normalizeAutomationId(input.automationId)),
      eq(AutomationTable.organization_id, normalizeOrganizationId(input.organizationId)),
      eq(AutomationTable.owner_member_id, normalizeMemberId(input.ownerMemberId)),
    )).limit(1)
    if (!rows[0]) return null
    const revisions = await db.select().from(AutomationRevisionTable)
      .where(eq(AutomationRevisionTable.id, rows[0].current_revision_id)).limit(1)
    return revisions[0] ? itemFromRows(rows[0], revisions[0]) : null
  }

  async setState(input: Parameters<AutomationRepository["setState"]>[0]): Promise<AutomationListItem | null> {
    const current = await this.get(input)
    if (!current) return null
    const same = current.automation.state === input.state
    if (!same) {
      await db.update(AutomationTable).set({
        state: input.state,
        next_due_at: input.state === "active"
          ? date(nextAutomationOccurrence(current.revision.schedule, input.now))
          : null,
        archived_at: input.state === "archived" ? new Date(input.now) : null,
        needs_attention_reason: null,
        updated_at: new Date(input.now),
      }).where(eq(AutomationTable.id, normalizeAutomationId(current.automation.id)))
    }
    return this.get(input)
  }

  async listDue(input: Parameters<AutomationRepository["listDue"]>[0]): Promise<AutomationListItem[]> {
    const rows = await db.select().from(AutomationTable).where(and(
      eq(AutomationTable.state, "active"),
      sql`${AutomationTable.next_due_at} <= ${new Date(input.now)}`,
    )).orderBy(asc(AutomationTable.next_due_at), asc(AutomationTable.id)).limit(input.limit)
    return Promise.all(rows.map(async (automation) => {
      const revisions = await db.select().from(AutomationRevisionTable)
        .where(eq(AutomationRevisionTable.id, automation.current_revision_id)).limit(1)
      if (!revisions[0]) throw new Error("automation_revision_not_found")
      return itemFromRows(automation, revisions[0])
    }))
  }

  async claim(input: Parameters<AutomationRepository["claim"]>[0]): Promise<AutomationClaimResult> {
    return db.transaction(async (tx) => {
      const locked = await tx.select().from(AutomationTable)
        .where(eq(AutomationTable.id, normalizeAutomationId(input.automation.id))).limit(1).for("update")
      if (!locked[0] || locked[0].state !== "active") throw new Error("automation_not_active")
      const identity = automationOccurrenceIdentity({
        automationId: input.automation.id,
        revisionId: input.revision.id,
        trigger: input.trigger,
        scheduledFor: input.scheduledFor,
        nonce: input.nonce,
      })
      const duplicates = await tx.select().from(AutomationRunTable)
        .where(eq(AutomationRunTable.idempotency_key, identity.idempotencyKey)).limit(1)
      if (duplicates[0]) return { kind: "duplicate", run: mapRun(duplicates[0]) }
      const active = await tx.select().from(AutomationRunTable).where(and(
        eq(AutomationRunTable.automation_id, normalizeAutomationId(input.automation.id)),
        inArray(AutomationRunTable.status, ["claimed", "running"]),
      )).limit(1)
      const overlap = active.length > 0
      const newRunId = createDenTypeId("automationRun")
      const newCloudThreadId = createDenTypeId("automationThread")
      const nextDueAt = input.trigger === "manual"
        ? input.automation.nextDueAt
        : nextAutomationOccurrence(input.revision.schedule, input.scheduledFor ?? input.now)
      await tx.insert(AutomationRunTable).values({
        id: newRunId,
        automation_id: normalizeAutomationId(input.automation.id),
        revision_id: normalizeRevisionId(input.revision.id),
        trigger: input.trigger,
        scheduled_for: date(input.scheduledFor),
        idempotency_key: identity.idempotencyKey,
        status: overlap ? "skipped" : "claimed",
        lease_owner: overlap ? null : input.leaseOwner,
        lease_expires_at: overlap ? null : new Date(input.now + input.leaseMs),
        heartbeat_at: overlap ? null : new Date(input.now),
        attempt_count: overlap ? 0 : 1,
        cloud_thread_id: newCloudThreadId,
        engine_kind: null,
        engine_receipt: null,
        engine_sequence: 0,
        engine_admitted_at: null,
        provider_id: input.revision.model.providerId,
        model_id: input.revision.model.modelId,
        finished_at: overlap ? new Date(input.now) : null,
        error: null,
        result_summary: overlap ? "Skipped because another occurrence is already active." : null,
        usage: emptyUsage,
        created_at: new Date(input.now),
        updated_at: new Date(input.now),
      })
      await tx.update(AutomationTable).set({
        next_due_at: date(nextDueAt),
        latest_run_at: new Date(input.now),
        updated_at: new Date(input.now),
      }).where(eq(AutomationTable.id, normalizeAutomationId(input.automation.id)))
      const runRows = await tx.select().from(AutomationRunTable).where(eq(AutomationRunTable.id, newRunId)).limit(1)
      if (!runRows[0]) throw new Error("automation_run_not_durable")
      return overlap
        ? { kind: "overlap", run: mapRun(runRows[0]) }
        : { kind: "claimed", run: mapRun(runRows[0]), revision: input.revision }
    })
  }

  async heartbeat(input: Parameters<AutomationRepository["heartbeat"]>[0]): Promise<boolean> {
    await db.update(AutomationRunTable).set({
      heartbeat_at: new Date(input.now),
      lease_expires_at: new Date(input.now + input.leaseMs),
      updated_at: new Date(input.now),
    }).where(and(
      eq(AutomationRunTable.id, normalizeRunId(input.runId)),
      eq(AutomationRunTable.lease_owner, input.leaseOwner),
      inArray(AutomationRunTable.status, ["claimed", "running"]),
    ))
    const rows = await db.select({ id: AutomationRunTable.id }).from(AutomationRunTable).where(and(
      eq(AutomationRunTable.id, normalizeRunId(input.runId)), eq(AutomationRunTable.lease_owner, input.leaseOwner),
      inArray(AutomationRunTable.status, ["claimed", "running"]),
    )).limit(1)
    return rows.length === 1
  }

  async appendEvent(input: Parameters<AutomationRepository["appendEvent"]>[0]): Promise<AutomationRunEvent> {
    return db.transaction(async (tx) => {
      const runs = await tx.select().from(AutomationRunTable).where(and(
        eq(AutomationRunTable.id, normalizeRunId(input.runId)), eq(AutomationRunTable.lease_owner, input.leaseOwner),
        inArray(AutomationRunTable.status, ["claimed", "running"]),
      )).limit(1).for("update")
      if (!runs[0]) throw new Error("automation_run_lease_lost")
      const sequences = await tx.select({ value: sql<number>`coalesce(max(${AutomationRunEventTable.sequence}), 0)` })
        .from(AutomationRunEventTable).where(eq(AutomationRunEventTable.run_id, normalizeRunId(input.runId)))
      const id = createDenTypeId("automationRunEvent")
      await tx.insert(AutomationRunEventTable).values({
        id,
        run_id: normalizeRunId(input.runId),
        sequence: Number(sequences[0]?.value ?? 0) + 1,
        event_type: input.type,
        payload: input.payload,
        created_at: new Date(input.now),
      })
      const rows = await tx.select().from(AutomationRunEventTable).where(eq(AutomationRunEventTable.id, id)).limit(1)
      if (!rows[0]) throw new Error("automation_run_event_not_durable")
      return mapEvent(rows[0])
    })
  }

  async complete(input: Parameters<AutomationRepository["complete"]>[0]): Promise<AutomationRun> {
    await db.update(AutomationRunTable).set({
      status: input.status,
      result_summary: input.resultSummary,
      usage: input.usage,
      error: input.error,
      finished_at: new Date(input.now),
      lease_expires_at: null,
      heartbeat_at: new Date(input.now),
      mcp_token_hash: null,
      mcp_token_expires_at: null,
      updated_at: new Date(input.now),
    }).where(and(eq(AutomationRunTable.id, normalizeRunId(input.runId)), eq(AutomationRunTable.lease_owner, input.leaseOwner)))
    const rows = await db.select().from(AutomationRunTable).where(eq(AutomationRunTable.id, normalizeRunId(input.runId))).limit(1)
    if (!rows[0] || rows[0].status !== input.status) throw new Error("automation_run_complete_lease_lost")
    return mapRun(rows[0])
  }

  async recoverExpiredLeases(input: Parameters<AutomationRepository["recoverExpiredLeases"]>[0]): Promise<AutomationRun[]> {
    const rows = await db.select().from(AutomationRunTable).where(and(
      inArray(AutomationRunTable.status, ["claimed", "running"]),
      lt(AutomationRunTable.lease_expires_at, new Date(input.now)),
    )).orderBy(asc(AutomationRunTable.lease_expires_at)).limit(input.limit)
    for (const run of rows) {
      if (!run.lease_owner) continue
      const retry = run.attempt_count < AUTOMATION_MAXIMUM_ATTEMPTS
      await db.update(AutomationRunTable).set({
        status: retry ? "queued" : "failed",
        lease_owner: null,
        lease_expires_at: null,
        mcp_token_hash: null,
        mcp_token_expires_at: null,
        error: retry ? null : { code: "lease_lost", message: "The execution lease expired.", retryable: false },
        finished_at: retry ? null : new Date(input.now),
        updated_at: new Date(input.now),
      }).where(and(eq(AutomationRunTable.id, run.id), eq(AutomationRunTable.lease_owner, run.lease_owner)))
    }
    return rows.map(mapRun)
  }

  async requestCancellation(input: Parameters<AutomationRepository["requestCancellation"]>[0]): Promise<AutomationRun | null> {
    const owned = await db.select({ run: AutomationRunTable }).from(AutomationRunTable)
      .innerJoin(AutomationTable, eq(AutomationTable.id, AutomationRunTable.automation_id))
      .where(and(
        eq(AutomationRunTable.id, normalizeRunId(input.runId)),
        eq(AutomationTable.organization_id, normalizeOrganizationId(input.organizationId)),
        eq(AutomationTable.owner_member_id, normalizeMemberId(input.ownerMemberId)),
      )).limit(1)
    if (!owned[0]) return null
    const immediate = owned[0].run.status === "queued"
    await db.update(AutomationRunTable).set({
      cancel_requested_at: new Date(input.now),
      status: immediate ? "cancelled" : owned[0].run.status,
      finished_at: immediate ? new Date(input.now) : owned[0].run.finished_at,
      mcp_token_hash: immediate ? null : owned[0].run.mcp_token_hash,
      mcp_token_expires_at: immediate ? null : owned[0].run.mcp_token_expires_at,
      updated_at: new Date(input.now),
    }).where(eq(AutomationRunTable.id, normalizeRunId(input.runId)))
    return (await this.runById(input.runId)) ?? null
  }

  async getRunReceipt(input: Parameters<AutomationRepository["getRunReceipt"]>[0]) {
    const owned = await db.select({ automation: AutomationTable, run: AutomationRunTable })
      .from(AutomationRunTable).innerJoin(AutomationTable, eq(AutomationTable.id, AutomationRunTable.automation_id))
      .where(and(
        eq(AutomationRunTable.id, normalizeRunId(input.runId)),
        eq(AutomationTable.organization_id, normalizeOrganizationId(input.organizationId)),
        eq(AutomationTable.owner_member_id, normalizeMemberId(input.ownerMemberId)),
      )).limit(1)
    if (!owned[0]) return null
    const revisions = await db.select().from(AutomationRevisionTable)
      .where(eq(AutomationRevisionTable.id, owned[0].run.revision_id)).limit(1)
    if (!revisions[0]) return null
    const events = await db.select().from(AutomationRunEventTable)
      .where(eq(AutomationRunEventTable.run_id, normalizeRunId(input.runId))).orderBy(asc(AutomationRunEventTable.sequence))
    return {
      automation: mapAutomation(owned[0].automation),
      revision: mapRevision(revisions[0]),
      run: mapRun(owned[0].run),
      events: events.map(mapEvent),
    }
  }

  async listRuns(input: Parameters<AutomationRepository["listRuns"]>[0]) {
    const automation = await this.get(input)
    if (!automation) return { items: [], nextCursor: null }
    const limit = Math.max(1, Math.min(input.limit, 100))
    const conditions = [eq(AutomationRunTable.automation_id, normalizeAutomationId(input.automationId))]
    if (input.cursor) conditions.push(lt(AutomationRunTable.id, normalizeRunId(input.cursor)))
    const rows = await db.select().from(AutomationRunTable).where(and(...conditions))
      .orderBy(desc(AutomationRunTable.id)).limit(limit + 1)
    const selected = rows.slice(0, limit)
    return { items: selected.map(mapRun), nextCursor: rows.length > limit ? selected.at(-1)?.id ?? null : null }
  }

  async markRunning(input: { runId: string; leaseOwner: string; tokenHash: string; tokenExpiresAt: number; now: number }): Promise<AutomationRun> {
    await db.update(AutomationRunTable).set({
      status: "running",
      started_at: new Date(input.now),
      mcp_token_hash: input.tokenHash,
      mcp_token_expires_at: new Date(input.tokenExpiresAt),
      updated_at: new Date(input.now),
    }).where(and(eq(AutomationRunTable.id, normalizeRunId(input.runId)), eq(AutomationRunTable.lease_owner, input.leaseOwner), eq(AutomationRunTable.status, "claimed")))
    const run = await this.runById(input.runId)
    if (!run || run.status !== "running") throw new Error("automation_run_start_lease_lost")
    return run
  }

  async assignEngine(input: {
    runId: string
    leaseOwner: string
    engineKind: string
    now: number
  }): Promise<AutomationRun> {
    await db.update(AutomationRunTable).set({
      engine_kind: input.engineKind,
      updated_at: new Date(input.now),
    }).where(and(
      eq(AutomationRunTable.id, normalizeRunId(input.runId)),
      eq(AutomationRunTable.lease_owner, input.leaseOwner),
      inArray(AutomationRunTable.status, ["claimed", "running"]),
    ))
    const run = await this.runById(input.runId)
    if (!run?.cloudThread || run.cloudThread.engineKind !== input.engineKind) {
      throw new Error("automation_engine_assignment_not_durable")
    }
    return run
  }

  async storeEngineAdmission(input: {
    runId: string
    leaseOwner: string
    receipt: AutomationEngineAdmissionReceipt
    now: number
  }): Promise<AutomationRun> {
    const receipt = automationEngineAdmissionReceiptSchema.parse(input.receipt)
    if (receipt.runId !== input.runId) throw new Error("automation_engine_receipt_run_mismatch")
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(AutomationRunTable).where(and(
        eq(AutomationRunTable.id, normalizeRunId(input.runId)),
        eq(AutomationRunTable.lease_owner, input.leaseOwner),
        inArray(AutomationRunTable.status, ["claimed", "running"]),
      )).limit(1).for("update")
      const run = rows[0]
      if (!run) throw new Error("automation_run_lease_lost")
      if (run.engine_receipt) {
        const existing = automationEngineAdmissionReceiptSchema.parse(run.engine_receipt)
        if (
          existing.adapterId !== receipt.adapterId
          || existing.executionId !== receipt.executionId
          || existing.admissionKey !== receipt.admissionKey
        ) throw new Error("automation_engine_receipt_conflict")
        return
      }
      await tx.update(AutomationRunTable).set({
        engine_kind: receipt.adapterId,
        engine_receipt: receipt,
        engine_admitted_at: new Date(receipt.admittedAt),
        updated_at: new Date(input.now),
      }).where(eq(AutomationRunTable.id, run.id))
    })
    const run = await this.runById(input.runId)
    if (!run?.cloudThread) throw new Error("automation_engine_receipt_not_durable")
    return run
  }

  async engineExecution(runId: string): Promise<{
    receipt: AutomationEngineAdmissionReceipt
    afterSequence: number
  } | null> {
    const rows = await db.select({
      receipt: AutomationRunTable.engine_receipt,
      sequence: AutomationRunTable.engine_sequence,
    }).from(AutomationRunTable).where(eq(AutomationRunTable.id, normalizeRunId(runId))).limit(1)
    if (!rows[0]?.receipt) return null
    return {
      receipt: automationEngineAdmissionReceiptSchema.parse(rows[0].receipt),
      afterSequence: rows[0].sequence,
    }
  }

  async appendEngineEvent(input: {
    runId: string
    leaseOwner: string
    event: AutomationEngineEvent
    now: number
  }): Promise<AutomationRunEvent> {
    const event = automationEngineEventSchema.parse(input.event)
    if (event.runId !== input.runId) throw new Error("automation_engine_event_run_mismatch")
    return db.transaction(async (tx) => {
      const runs = await tx.select().from(AutomationRunTable).where(and(
        eq(AutomationRunTable.id, normalizeRunId(input.runId)),
        eq(AutomationRunTable.lease_owner, input.leaseOwner),
        inArray(AutomationRunTable.status, ["claimed", "running"]),
      )).limit(1).for("update")
      const run = runs[0]
      if (!run) throw new Error("automation_run_lease_lost")
      const receipt = run.engine_receipt
        ? automationEngineAdmissionReceiptSchema.parse(run.engine_receipt)
        : null
      if (!receipt || receipt.executionId !== event.executionId) {
        throw new Error("automation_engine_event_receipt_mismatch")
      }
      const duplicates = await tx.select().from(AutomationRunEventTable).where(and(
        eq(AutomationRunEventTable.run_id, run.id),
        eq(AutomationRunEventTable.engine_idempotency_key, event.idempotencyKey),
      )).limit(1)
      if (duplicates[0]) return mapEvent(duplicates[0])
      if (event.sequence !== run.engine_sequence + 1) {
        throw new Error("automation_engine_event_sequence_gap")
      }
      const globalSequences = await tx.select({ value: sql<number>`coalesce(max(${AutomationRunEventTable.sequence}), 0)` })
        .from(AutomationRunEventTable).where(eq(AutomationRunEventTable.run_id, run.id))
      const id = createDenTypeId("automationRunEvent")
      await tx.insert(AutomationRunEventTable).values({
        id,
        run_id: run.id,
        sequence: Number(globalSequences[0]?.value ?? 0) + 1,
        engine_event_id: event.id,
        engine_idempotency_key: event.idempotencyKey,
        engine_execution_id: event.executionId,
        event_type: event.type,
        payload: event.payload,
        created_at: new Date(event.createdAt),
      })
      await tx.update(AutomationRunTable).set({
        engine_sequence: event.sequence,
        updated_at: new Date(input.now),
      }).where(eq(AutomationRunTable.id, run.id))
      const inserted = await tx.select().from(AutomationRunEventTable)
        .where(eq(AutomationRunEventTable.id, id)).limit(1)
      if (!inserted[0]) throw new Error("automation_engine_event_not_durable")
      return mapEvent(inserted[0])
    })
  }

  async activeRunForMcp(runId: string): Promise<RunRow | null> {
    const rows = await db.select().from(AutomationRunTable).where(and(
      eq(AutomationRunTable.id, normalizeRunId(runId)),
      eq(AutomationRunTable.status, "running"),
      sql`${AutomationRunTable.cancel_requested_at} IS NULL`,
    )).limit(1)
    return rows[0] ?? null
  }

  async reclaimQueued(input: { runId: string; leaseOwner: string; leaseMs: number; now: number }): Promise<{
    automation: Automation
    revision: AutomationRevision
    run: AutomationRun
  } | null> {
    return db.transaction(async (tx) => {
      const rows = await tx.select().from(AutomationRunTable)
        .where(and(eq(AutomationRunTable.id, normalizeRunId(input.runId)), eq(AutomationRunTable.status, "queued")))
        .limit(1).for("update")
      const row = rows[0]
      if (!row || row.attempt_count >= AUTOMATION_MAXIMUM_ATTEMPTS) return null
      await tx.update(AutomationRunTable).set({
        status: "claimed",
        lease_owner: input.leaseOwner,
        lease_expires_at: new Date(input.now + input.leaseMs),
        heartbeat_at: new Date(input.now),
        attempt_count: row.attempt_count + 1,
        updated_at: new Date(input.now),
      }).where(eq(AutomationRunTable.id, row.id))
      const automations = await tx.select().from(AutomationTable)
        .where(eq(AutomationTable.id, row.automation_id)).limit(1)
      const revisions = await tx.select().from(AutomationRevisionTable)
        .where(eq(AutomationRevisionTable.id, row.revision_id)).limit(1)
      if (!automations[0] || !revisions[0]) return null
      const updated = await tx.select().from(AutomationRunTable).where(eq(AutomationRunTable.id, row.id)).limit(1)
      if (!updated[0]) return null
      return { automation: mapAutomation(automations[0]), revision: mapRevision(revisions[0]), run: mapRun(updated[0]) }
    })
  }

  async queueRetry(input: { runId: string; leaseOwner: string; now: number }): Promise<boolean> {
    const rows = await db.select().from(AutomationRunTable).where(and(
      eq(AutomationRunTable.id, normalizeRunId(input.runId)),
      eq(AutomationRunTable.lease_owner, input.leaseOwner),
      eq(AutomationRunTable.status, "running"),
    )).limit(1)
    if (!rows[0] || rows[0].attempt_count >= AUTOMATION_MAXIMUM_ATTEMPTS) return false
    await db.update(AutomationRunTable).set({
      status: "queued",
      lease_owner: null,
      lease_expires_at: null,
      heartbeat_at: null,
      mcp_token_hash: null,
      mcp_token_expires_at: null,
      engine_kind: null,
      engine_receipt: null,
      engine_sequence: 0,
      engine_admitted_at: null,
      updated_at: new Date(input.now),
    }).where(eq(AutomationRunTable.id, normalizeRunId(input.runId)))
    return true
  }

  async cancellationRequested(runId: string): Promise<boolean> {
    const rows = await db.select({ cancelledAt: AutomationRunTable.cancel_requested_at })
      .from(AutomationRunTable).where(eq(AutomationRunTable.id, normalizeRunId(runId))).limit(1)
    return Boolean(rows[0]?.cancelledAt)
  }

  async markNeedsAttention(input: { automationId: string; reason: NonNullable<Automation["needsAttentionReason"]>; now: number }): Promise<void> {
    await db.update(AutomationTable).set({
      state: "needs_attention",
      next_due_at: null,
      needs_attention_reason: input.reason,
      updated_at: new Date(input.now),
    }).where(eq(AutomationTable.id, normalizeAutomationId(input.automationId)))
  }

  private async runById(runId: string): Promise<AutomationRun | null> {
    const rows = await db.select().from(AutomationRunTable).where(eq(AutomationRunTable.id, normalizeRunId(runId))).limit(1)
    return rows[0] ? mapRun(rows[0]) : null
  }
}

export const automationRepository = new DenAutomationRepository()
