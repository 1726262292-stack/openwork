import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { and, eq, isNull } from "@openwork-ee/den-db/drizzle"
import {
  ScheduledTaskTickInvocationTable,
  WorkerTable,
  WorkerTokenTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import type { ScheduledTaskTickSource } from "@openwork/scheduled-tasks"
import { DEN_SCHEDULED_TASK_TICK_PATH } from "@openwork/scheduled-tasks-den"
import { db } from "../db.js"
import type { DenScheduledTaskWorkerId } from "./repository.js"

export const DEN_SCHEDULED_TASK_SIGNATURE_MAX_AGE_SECONDS = 300

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function createDenScheduledTaskTickSignature(input: {
  secret: string
  rawBody: string
  timestampSeconds: number
  requestId: string
}) {
  const canonical = [
    String(input.timestampSeconds),
    input.requestId,
    "POST",
    DEN_SCHEDULED_TASK_TICK_PATH,
    sha256Hex(input.rawBody),
  ].join("\n")
  return `v1=${createHmac("sha256", input.secret).update(canonical).digest("hex")}`
}

export function verifyDenScheduledTaskTickSignature(input: {
  secret: string
  rawBody: string
  timestampHeader: string | undefined
  requestId: string | undefined
  signatureHeader: string | undefined
  now: number
}) {
  if (!input.secret || !input.requestId || !input.signatureHeader) return false
  const timestampSeconds = Number(input.timestampHeader)
  if (
    !Number.isInteger(timestampSeconds)
    || Math.abs(Math.floor(input.now / 1_000) - timestampSeconds)
      > DEN_SCHEDULED_TASK_SIGNATURE_MAX_AGE_SECONDS
  ) {
    return false
  }
  const expected = createDenScheduledTaskTickSignature({
    secret: input.secret,
    rawBody: input.rawBody,
    timestampSeconds,
    requestId: input.requestId,
  })
  const expectedBytes = new TextEncoder().encode(expected)
  const providedBytes = new TextEncoder().encode(input.signatureHeader)
  return expectedBytes.length === providedBytes.length
    && timingSafeEqual(expectedBytes, providedBytes)
}

export async function authenticateDenScheduledTaskWorker(input: {
  workerId: DenScheduledTaskWorkerId
  token: string
}) {
  const [row] = await db
    .select({ id: WorkerTokenTable.id })
    .from(WorkerTokenTable)
    .where(and(
      eq(WorkerTokenTable.worker_id, input.workerId),
      eq(WorkerTokenTable.scope, "execution"),
      eq(WorkerTokenTable.token, input.token),
      isNull(WorkerTokenTable.revoked_at),
    ))
    .limit(1)
  return Boolean(row)
}

export async function getOrCreateDenScheduledTaskExecutionToken(
  workerId: DenScheduledTaskWorkerId,
) {
  return db.transaction(async (tx) => {
    const [worker] = await tx
      .select({ id: WorkerTable.id })
      .from(WorkerTable)
      .where(eq(WorkerTable.id, workerId))
      .for("update")
      .limit(1)
    if (!worker) throw new Error("scheduled_task_worker_not_found")

    const [existing] = await tx
      .select({ token: WorkerTokenTable.token })
      .from(WorkerTokenTable)
      .where(and(
        eq(WorkerTokenTable.worker_id, workerId),
        eq(WorkerTokenTable.scope, "execution"),
        isNull(WorkerTokenTable.revoked_at),
      ))
      .limit(1)
    if (existing) return existing.token
    const token = randomBytes(32).toString("hex")
    await tx.insert(WorkerTokenTable).values({
      id: createDenTypeId("workerToken"),
      worker_id: workerId,
      scope: "execution",
      token,
    })
    return token
  })
}

export interface DenScheduledTaskTickReplayStore {
  reserve(input: {
    requestId: string
    source: Extract<ScheduledTaskTickSource, "vercel-cron" | "den-loop">
    rawBody: string
  }): Promise<boolean>
  markProcessed(requestId: string, processedAt: number): Promise<void>
}

export const databaseDenScheduledTaskTickReplayStore: DenScheduledTaskTickReplayStore = {
  async reserve(input) {
    const [existing] = await db
      .select({ id: ScheduledTaskTickInvocationTable.id })
      .from(ScheduledTaskTickInvocationTable)
      .where(eq(ScheduledTaskTickInvocationTable.request_id, input.requestId))
      .limit(1)
    if (existing) return false
    try {
      await db.insert(ScheduledTaskTickInvocationTable).values({
        id: createDenTypeId("scheduledTaskTick"),
        request_id: input.requestId,
        source: input.source,
        request_digest: sha256Hex(input.rawBody),
      })
      return true
    } catch {
      return false
    }
  },
  async markProcessed(requestId, processedAt) {
    await db
      .update(ScheduledTaskTickInvocationTable)
      .set({ processed_at: new Date(processedAt) })
      .where(eq(ScheduledTaskTickInvocationTable.request_id, requestId))
  },
}
