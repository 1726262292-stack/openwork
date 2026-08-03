import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  automationEngineAdmissionReceiptSchema,
  automationEngineAdmissionRequestSchema,
  type AutomationEngineAdapter,
  type AutomationEngineAdmissionReceipt,
  type AutomationEngineAdmissionRequest,
  type AutomationEngineCancellationResult,
  type AutomationEngineEvent,
  type AutomationEngineObserveOptions,
  type AutomationEngineReadResult,
} from "@openwork/automations"
import type { AutomationError, AutomationUsage } from "@openwork/types/automations"
import {
  automationEmptyUsage,
  createAutomationEngineRuntime,
  type AutomationEngineObservation,
  type AutomationEngineRuntime,
  type AutomationEngineRuntimeFactory,
} from "./native-runtime.js"

const adapterId = "openwork-den-native-v1"
const recordVersion = 1
const defaultPollIntervalMs = 250

type ExecutionState = "admitted" | "running" | "succeeded" | "failed" | "cancelled"

type ExecutionRecord = {
  version: typeof recordVersion
  receipt: AutomationEngineAdmissionReceipt
  state: ExecutionState
  request: AutomationEngineAdmissionRequest | null
  sessionId: string | null
  observationKeys: string[]
  events: AutomationEngineEvent[]
  result: Exclude<AutomationEngineReadResult, { status: "pending" }> | null
  updatedAt: number
}

type ExecutionStore = {
  read(runtimeKey: string): Promise<ExecutionRecord | null>
  write(runtimeKey: string, record: ExecutionRecord): Promise<void>
  runtimeDirectory(runtimeKey: string): string
  cleanupRuntime(runtimeKey: string): Promise<void>
}

function executionHash(admissionKey: string): string {
  return createHash("sha256").update(`${adapterId}\0${admissionKey}`).digest("hex")
}

function runtimeKeyFrom(receipt: AutomationEngineAdmissionReceipt): string {
  const value = receipt.attachment.runtimeKey
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Automation engine receipt has an invalid runtime attachment.")
  }
  if (receipt.adapterId !== adapterId || executionHash(receipt.admissionKey) !== value) {
    throw new Error("Automation engine receipt does not belong to this adapter.")
  }
  return value
}

function createFileExecutionStore(root: string): ExecutionStore {
  function directory(runtimeKey: string) {
    return path.join(root, runtimeKey)
  }
  function statePath(runtimeKey: string) {
    return path.join(directory(runtimeKey), "state.json")
  }
  return {
    runtimeDirectory: directory,
    async read(runtimeKey) {
      try {
        const parsed: unknown = JSON.parse(await readFile(statePath(runtimeKey), "utf8"))
        if (!isRecord(parsed) || parsed.version !== recordVersion) {
          throw new Error("Automation engine state has an unsupported version.")
        }
        return parsed as ExecutionRecord
      } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") return null
        throw error
      }
    },
    async write(runtimeKey, record) {
      const targetDirectory = directory(runtimeKey)
      await mkdir(targetDirectory, { recursive: true, mode: 0o700 })
      const target = statePath(runtimeKey)
      const temporary = path.join(targetDirectory, `.state-${randomUUID()}.json`)
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600 })
      await rename(temporary, target)
    },
    async cleanupRuntime(runtimeKey) {
      await rm(path.join(directory(runtimeKey), "runtime"), { recursive: true, force: true })
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function terminalState(state: ExecutionState): state is "succeeded" | "failed" | "cancelled" {
  return state === "succeeded" || state === "failed" || state === "cancelled"
}

function normalizeAdapterError(error: unknown): AutomationError {
  if (isRecord(error) && typeof error.automationCode === "string") {
    if (["owner_membership_lost", "model_access_lost", "provider_unavailable"].includes(error.automationCode)) {
      return {
        code: error.automationCode as "owner_membership_lost" | "model_access_lost" | "provider_unavailable",
        message: error instanceof Error ? error.message : "Automation authority is unavailable.",
        retryable: false,
      }
    }
  }
  return {
    code: "execution_runtime_unavailable",
    message: error instanceof Error ? error.message.slice(0, 2_000) : "The Automation engine runtime is unavailable.",
    retryable: true,
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, milliseconds)
    function done() {
      signal?.removeEventListener("abort", done)
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener("abort", done, { once: true })
  })
}

export type DenAutomationEngineOptions = {
  stateDirectory?: string
  runtimeFactory?: AutomationEngineRuntimeFactory
  now?: () => number
  pollIntervalMs?: number
}

export class DenAutomationEngineAdapter implements AutomationEngineAdapter {
  readonly #store: ExecutionStore
  readonly #runtimeFactory: AutomationEngineRuntimeFactory
  readonly #now: () => number
  readonly #pollIntervalMs: number
  readonly #active = new Map<string, AutomationEngineRuntime>()
  readonly #locks = new Map<string, Promise<void>>()

  constructor(options: DenAutomationEngineOptions = {}) {
    const stateDirectory = options.stateDirectory
      ?? process.env.AUTOMATIONS_STATE_DIR?.trim()
      ?? path.join(tmpdir(), "openwork-den-automation-engine")
    this.#store = createFileExecutionStore(stateDirectory)
    this.#runtimeFactory = options.runtimeFactory ?? createAutomationEngineRuntime
    this.#now = options.now ?? Date.now
    this.#pollIntervalMs = Math.max(10, options.pollIntervalMs ?? defaultPollIntervalMs)
  }

  async capabilities() {
    return {
      adapterId,
      protocolVersion: 1 as const,
      admission: "idempotent" as const,
      reattachment: "receipt" as const,
      eventDelivery: "ordered_at_least_once" as const,
      resultPersistence: "durable" as const,
      cancellation: "supported" as const,
      isolation: {
        location: "cloud" as const,
        filesystem: "none" as const,
        shell: false as const,
        browser: false as const,
        computer: false as const,
        connect: "run-scoped" as const,
        network: "provider-and-connect-only" as const,
      },
    }
  }

  async #locked<T>(runtimeKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(runtimeKey) ?? Promise.resolve()
    let release = () => {}
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    this.#locks.set(runtimeKey, queued)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.#locks.get(runtimeKey) === queued) this.#locks.delete(runtimeKey)
    }
  }

  #event(record: ExecutionRecord, observation: AutomationEngineObservation): void {
    if (record.observationKeys.includes(observation.key)) return
    record.observationKeys.push(observation.key)
    const sequence = record.events.length + 1
    record.events.push({
      id: `${record.receipt.executionId}:${sequence}`,
      idempotencyKey: `${record.receipt.executionId}:${observation.key}`,
      executionId: record.receipt.executionId,
      runId: record.receipt.runId,
      sequence,
      type: observation.type,
      payload: observation.payload,
      createdAt: observation.createdAt,
    })
    record.updatedAt = Math.max(record.updatedAt, observation.createdAt)
  }

  async #dispose(runtimeKey: string): Promise<void> {
    const runtime = this.#active.get(runtimeKey)
    this.#active.delete(runtimeKey)
    await runtime?.dispose().catch(() => undefined)
    await this.#store.cleanupRuntime(runtimeKey)
  }

  async #terminal(
    runtimeKey: string,
    record: ExecutionRecord,
    status: "succeeded" | "failed" | "cancelled",
    input: { summary: string | null; usage: AutomationUsage; error: AutomationError | null },
  ): Promise<void> {
    if (terminalState(record.state)) return
    const finishedAt = this.#now()
    this.#event(record, {
      key: `terminal:${status}`,
      type: "terminal",
      payload: { status, ...(input.error ? { error: input.error } : {}) },
      createdAt: finishedAt,
    })
    record.state = status
    record.result = {
      executionId: record.receipt.executionId,
      runId: record.receipt.runId,
      status,
      threadId: record.request?.run.cloudThread?.id ?? null,
      resultSummary: input.summary,
      usage: input.usage,
      error: input.error,
      finalSequence: record.events.length,
      finishedAt,
    }
    record.request = null
    record.updatedAt = finishedAt
    await this.#store.write(runtimeKey, record)
    await this.#dispose(runtimeKey)
  }

  async #ensureRuntime(runtimeKey: string, record: ExecutionRecord): Promise<AutomationEngineRuntime> {
    const existing = this.#active.get(runtimeKey)
    if (existing?.isAlive()) return existing
    await existing?.dispose().catch(() => undefined)
    this.#active.delete(runtimeKey)
    if (!record.request) throw new Error("Automation runtime credentials are no longer available.")
    const runtime = await this.#runtimeFactory({
      executionId: record.receipt.executionId,
      request: record.request,
      runtimeDirectory: this.#store.runtimeDirectory(runtimeKey),
      sessionId: record.sessionId,
    })
    this.#active.set(runtimeKey, runtime)
    if (record.sessionId !== runtime.sessionId || record.state === "admitted") {
      record.sessionId = runtime.sessionId
      record.state = "running"
      record.updatedAt = this.#now()
      await this.#store.write(runtimeKey, record)
    }
    return runtime
  }

  async #refresh(runtimeKey: string): Promise<ExecutionRecord | null> {
    return this.#locked(runtimeKey, async () => {
      const record = await this.#store.read(runtimeKey)
      if (!record || terminalState(record.state)) return record
      if (record.receipt.admittedAt + record.request!.revision.maximumRuntimeMs <= this.#now()) {
        await this.#active.get(runtimeKey)?.abort().catch(() => undefined)
        await this.#terminal(runtimeKey, record, "failed", {
          summary: null,
          usage: automationEmptyUsage,
          error: { code: "execution_timed_out", message: "The Automation exceeded its maximum runtime.", retryable: false },
        })
        return record
      }
      try {
        const runtime = await this.#ensureRuntime(runtimeKey, record)
        const snapshot = await runtime.inspect()
        for (const observation of snapshot.observations) this.#event(record, observation)
        if (snapshot.state === "succeeded") {
          await this.#terminal(runtimeKey, record, "succeeded", {
            summary: snapshot.resultSummary,
            usage: snapshot.usage,
            error: null,
          })
        } else if (snapshot.state === "failed") {
          await this.#terminal(runtimeKey, record, "failed", {
            summary: snapshot.resultSummary,
            usage: snapshot.usage,
            error: snapshot.error ?? { code: "execution_failed", message: "Automation execution failed.", retryable: false },
          })
        } else {
          record.state = "running"
          record.updatedAt = this.#now()
          await this.#store.write(runtimeKey, record)
        }
      } catch (error) {
        await this.#terminal(runtimeKey, record, "failed", {
          summary: null,
          usage: automationEmptyUsage,
          error: normalizeAdapterError(error),
        })
      }
      return record
    })
  }

  async admit(rawRequest: AutomationEngineAdmissionRequest): Promise<AutomationEngineAdmissionReceipt> {
    const request = automationEngineAdmissionRequestSchema.parse(rawRequest)
    const runtimeKey = executionHash(request.admissionKey)
    return this.#locked(runtimeKey, async () => {
      const existing = await this.#store.read(runtimeKey)
      if (existing) {
        if (existing.receipt.runId !== request.run.id) throw new Error("Automation admission key was reused for another run.")
        return existing.receipt
      }
      const receipt = automationEngineAdmissionReceiptSchema.parse({
        receiptVersion: 1,
        adapterId,
        executionId: `automation-${runtimeKey.slice(0, 48)}`,
        admissionKey: request.admissionKey,
        runId: request.run.id,
        admittedAt: this.#now(),
        attachment: { runtimeKey },
      })
      const record: ExecutionRecord = {
        version: recordVersion,
        receipt,
        state: "admitted",
        request,
        sessionId: null,
        observationKeys: [],
        events: [],
        result: null,
        updatedAt: receipt.admittedAt,
      }
      this.#event(record, {
        key: "user:instructions",
        type: "user",
        payload: { instructions: request.revision.instructions },
        createdAt: receipt.admittedAt,
      })
      await this.#store.write(runtimeKey, record)
      try {
        await this.#ensureRuntime(runtimeKey, record)
      } catch (error) {
        await this.#terminal(runtimeKey, record, "failed", {
          summary: null,
          usage: automationEmptyUsage,
          error: normalizeAdapterError(error),
        })
      }
      return receipt
    })
  }

  async *observe(
    rawReceipt: AutomationEngineAdmissionReceipt,
    options: AutomationEngineObserveOptions = {},
  ): AsyncIterable<AutomationEngineEvent> {
    const receipt = automationEngineAdmissionReceiptSchema.parse(rawReceipt)
    const runtimeKey = runtimeKeyFrom(receipt)
    let cursor = options.afterSequence ?? 0
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Automation event cursor is invalid.")
    while (!options.signal?.aborted) {
      const record = await this.#refresh(runtimeKey)
      if (!record) return
      for (const event of record.events) {
        if (event.sequence <= cursor) continue
        cursor = event.sequence
        yield event
      }
      if (terminalState(record.state)) return
      await abortableDelay(this.#pollIntervalMs, options.signal)
    }
  }

  async read(rawReceipt: AutomationEngineAdmissionReceipt): Promise<AutomationEngineReadResult | null> {
    const receipt = automationEngineAdmissionReceiptSchema.parse(rawReceipt)
    const record = await this.#refresh(runtimeKeyFrom(receipt))
    if (!record) return null
    if (record.result) return record.result
    return {
      status: "pending",
      state: record.state === "admitted" ? "admitted" : "running",
      executionId: record.receipt.executionId,
      runId: record.receipt.runId,
      latestSequence: record.events.length,
      updatedAt: record.updatedAt,
    }
  }

  async cancel(rawReceipt: AutomationEngineAdmissionReceipt): Promise<AutomationEngineCancellationResult> {
    const receipt = automationEngineAdmissionReceiptSchema.parse(rawReceipt)
    const runtimeKey = runtimeKeyFrom(receipt)
    return this.#locked(runtimeKey, async () => {
      const record = await this.#store.read(runtimeKey)
      const requestedAt = this.#now()
      if (!record) return { executionId: receipt.executionId, runId: receipt.runId, outcome: "not_found", requestedAt }
      if (terminalState(record.state)) {
        return { executionId: receipt.executionId, runId: receipt.runId, outcome: "already_terminal", requestedAt }
      }
      try {
        const runtime = await this.#ensureRuntime(runtimeKey, record)
        await runtime.abort().catch(() => "unsupported" as const)
      } finally {
        await this.#terminal(runtimeKey, record, "cancelled", {
          summary: null,
          usage: automationEmptyUsage,
          error: { code: "cancelled", message: "The Automation run was cancelled.", retryable: false },
        })
      }
      return { executionId: receipt.executionId, runId: receipt.runId, outcome: "requested", requestedAt }
    })
  }
}

export function createDenAutomationEngine(options: DenAutomationEngineOptions = {}) {
  return new DenAutomationEngineAdapter(options)
}

export const automationEngineAdapter = createDenAutomationEngine()
