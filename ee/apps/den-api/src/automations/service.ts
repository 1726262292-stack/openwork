import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import {
  AUTOMATION_MAXIMUM_ATTEMPTS,
  AUTOMATION_RETRY_DELAY_MS,
  automationEngineCapabilityDeclarationSchema,
  automationEngineReadResultSchema,
  createAutomationEngineEventSequenceValidator,
  type AutomationEngineAdmissionReceipt,
} from "@openwork/automations"
import type {
  Automation,
  AutomationError,
  AutomationRevision,
  AutomationRun,
  CreateAutomation,
  UpdateAutomation,
} from "@openwork/types/automations"
import { env } from "../env.js"
import { appLogger } from "../observability/logger.js"
import { resolveAutomationModelAccess } from "./authority.js"
import { automationEngineAdapter } from "./execution-adapter.js"
import { automationRepository } from "./repository.js"
import { mintAutomationRunToken } from "./security.js"

const logger = appLogger.child({ component: "automations" })
const schedulerOwner = `den:${process.pid}:${randomUUID()}`

type OwnerScope = { organizationId: string; ownerMemberId: string }
type Claimed = { automation: Automation; revision: AutomationRevision; run: AutomationRun }

function authorityError(code: "owner_membership_lost" | "model_access_lost" | "provider_unavailable", message: string): AutomationError {
  return { code, message, retryable: false }
}

async function requireCloudEngine() {
  const declaration = automationEngineCapabilityDeclarationSchema.parse(
    await automationEngineAdapter.capabilities(),
  )
  const required = declaration.isolation
  if (
    required.location !== "cloud"
    || required.filesystem !== "none"
    || required.shell !== false
    || required.browser !== false
    || required.computer !== false
    || required.connect !== "run-scoped"
    || required.network !== "provider-and-connect-only"
  ) throw new Error("automation_engine_isolation_unsupported")
  return declaration
}

export class AutomationService {
  private readonly activeControllers = new Map<string, AbortController>()

  async list(scope: OwnerScope, input: { cursor?: string; limit?: number }) {
    return automationRepository.list({ ...scope, cursor: input.cursor, limit: input.limit ?? 50 })
  }

  async get(scope: OwnerScope, automationId: string) {
    return automationRepository.get({ ...scope, automationId })
  }

  async create(scope: OwnerScope, definition: CreateAutomation) {
    await this.requireModel(scope, definition.model)
    return automationRepository.create({ ...scope, definition, now: Date.now() })
  }

  async update(scope: OwnerScope, automationId: string, changes: UpdateAutomation) {
    const current = await this.get(scope, automationId)
    if (!current) return null
    await this.requireModel(scope, changes.model ?? current.revision.model)
    return automationRepository.update({ ...scope, automationId, changes, now: Date.now() })
  }

  async activate(scope: OwnerScope, automationId: string) {
    const current = await this.get(scope, automationId)
    if (!current) return null
    await this.requireModel(scope, current.revision.model)
    return automationRepository.setState({ ...scope, automationId, state: "active", now: Date.now() })
  }

  deactivate(scope: OwnerScope, automationId: string) {
    return automationRepository.setState({ ...scope, automationId, state: "inactive", now: Date.now() })
  }

  archive(scope: OwnerScope, automationId: string) {
    return automationRepository.setState({ ...scope, automationId, state: "archived", now: Date.now() })
  }

  async runNow(scope: OwnerScope, automationId: string): Promise<AutomationRun | null> {
    const current = await this.get(scope, automationId)
    if (!current || current.automation.state === "archived") return null
    const claim = await automationRepository.claim({
      automation: { ...current.automation, state: "active" },
      revision: current.revision,
      trigger: "manual",
      scheduledFor: null,
      nonce: randomUUID(),
      leaseOwner: schedulerOwner,
      leaseMs: env.automations.leaseMs,
      now: Date.now(),
    })
    if (claim.kind === "claimed") {
      void this.process({ automation: current.automation, revision: claim.revision, run: claim.run })
    }
    return claim.run
  }

  listRuns(scope: OwnerScope, automationId: string, input: { cursor?: string; limit?: number }) {
    return automationRepository.listRuns({ ...scope, automationId, cursor: input.cursor, limit: input.limit ?? 50 })
  }

  getRun(scope: OwnerScope, runId: string) {
    return automationRepository.getRunReceipt({ ...scope, runId })
  }

  async cancelRun(scope: OwnerScope, runId: string): Promise<AutomationRun | null> {
    const run = await automationRepository.requestCancellation({ ...scope, runId, now: Date.now() })
    this.activeControllers.get(runId)?.abort(new Error("Automation run cancelled"))
    if (run?.status === "running") {
      const execution = await automationRepository.engineExecution(runId)
      if (execution) await automationEngineAdapter.cancel(execution.receipt)
    }
    return run
  }

  async tick(input: { now?: number; batchSize?: number } = {}): Promise<string[]> {
    const now = input.now ?? Date.now()
    const started: string[] = []
    const expired = await automationRepository.recoverExpiredLeases({ now, limit: input.batchSize ?? env.automations.batchSize })
    for (const run of expired) {
      const reclaimed = await automationRepository.reclaimQueued({
        runId: run.id,
        leaseOwner: schedulerOwner,
        leaseMs: env.automations.leaseMs,
        now,
      })
      if (reclaimed) {
        started.push(reclaimed.run.id)
        void this.process(reclaimed)
      }
    }

    const due = await automationRepository.listDue({ now, limit: input.batchSize ?? env.automations.batchSize })
    for (const item of due) {
      const scheduledFor = item.automation.nextDueAt
      if (scheduledFor === null) continue
      const claim = await automationRepository.claim({
        automation: item.automation,
        revision: item.revision,
        trigger: "scheduled",
        scheduledFor,
        leaseOwner: schedulerOwner,
        leaseMs: env.automations.leaseMs,
        now,
      })
      if (claim.kind === "claimed") {
        started.push(claim.run.id)
        void this.process({ automation: item.automation, revision: claim.revision, run: claim.run })
      }
    }
    return started
  }

  async stop(): Promise<void> {
    for (const controller of this.activeControllers.values()) controller.abort(new Error("Den is shutting down"))
    const deadline = Date.now() + Math.min(env.automations.leaseMs, 10_000)
    while (this.activeControllers.size > 0 && Date.now() < deadline) await delay(50)
  }

  private async requireModel(scope: OwnerScope, model: { providerId: string; modelId: string }) {
    const result = await resolveAutomationModelAccess({ ...scope, ...model })
    if (!result.ok) {
      const error = new Error(result.message)
      error.name = result.code
      throw error
    }
  }

  private async process(claimed: Claimed): Promise<void> {
    const controller = new AbortController()
    let receipt: AutomationEngineAdmissionReceipt | null = null
    this.activeControllers.set(claimed.run.id, controller)
    const timeout = setTimeout(() => controller.abort(new Error("Automation run timed out")), env.automations.runTimeoutMs)
    const heartbeat = setInterval(() => {
      void (async () => {
        const now = Date.now()
        const alive = await automationRepository.heartbeat({
          runId: claimed.run.id,
          leaseOwner: schedulerOwner,
          leaseMs: env.automations.leaseMs,
          now,
        })
        const cancelled = await automationRepository.cancellationRequested(claimed.run.id)
        if (!alive || cancelled) controller.abort(new Error(cancelled ? "Automation run cancelled" : "Automation lease lost"))
      })().catch(() => controller.abort(new Error("Automation heartbeat failed")))
    }, Math.max(1_000, Math.floor(env.automations.leaseMs / 3)))

    try {
      const engine = await requireCloudEngine()
      const access = await resolveAutomationModelAccess({
        organizationId: claimed.automation.organizationId,
        ownerMemberId: claimed.automation.ownerMemberId,
        providerId: claimed.revision.model.providerId,
        modelId: claimed.revision.model.modelId,
      })
      if (!access.ok) {
        await automationRepository.markNeedsAttention({
          automationId: claimed.automation.id,
          reason: { code: access.code, message: access.message, occurredAt: Date.now() },
          now: Date.now(),
        })
        await automationRepository.complete({
          runId: claimed.run.id,
          leaseOwner: schedulerOwner,
          status: "failed",
          resultSummary: null,
          usage: { inputTokens: null, outputTokens: null, costMicros: null },
          error: authorityError(access.code, access.message),
          now: Date.now(),
        })
        return
      }

      const token = mintAutomationRunToken()
      const tokenExpiresAt = Date.now() + env.automations.runTimeoutMs
      const assigned = await automationRepository.assignEngine({
        runId: claimed.run.id,
        leaseOwner: schedulerOwner,
        engineKind: engine.adapterId,
        now: Date.now(),
      })
      let running = await automationRepository.markRunning({
        runId: claimed.run.id,
        leaseOwner: schedulerOwner,
        tokenHash: token.hash,
        tokenExpiresAt,
        now: Date.now(),
      })
      const durable = await automationRepository.engineExecution(running.id)
      if (durable) {
        receipt = durable.receipt
      } else {
        receipt = await automationEngineAdapter.admit({
          admissionKey: `${running.id}:attempt:${running.attemptCount}`,
          automation: claimed.automation,
          revision: claimed.revision,
          run: assigned,
          capabilityAccess: {
            endpoint: `${(env.apiPublicUrl ?? env.betterAuthUrl).replace(/\/+$/, "")}/mcp/automation-runs/${running.id}`,
            bearerToken: token.token,
            expiresAt: tokenExpiresAt,
          },
          requestedAt: Date.now(),
        })
        running = await automationRepository.storeEngineAdmission({
          runId: running.id,
          leaseOwner: schedulerOwner,
          receipt,
          now: Date.now(),
        })
      }

      if (!running.cloudThread) throw new Error("automation_cloud_thread_missing")
      let result = automationEngineReadResultSchema.parse(await automationEngineAdapter.read(receipt))
      while (result.status === "pending") {
        const execution = await automationRepository.engineExecution(running.id)
        if (!execution) throw new Error("automation_engine_receipt_missing")
        const validator = createAutomationEngineEventSequenceValidator(receipt, execution.afterSequence)
        for await (const event of automationEngineAdapter.observe(receipt, {
          afterSequence: execution.afterSequence,
          signal: controller.signal,
        })) {
          validator.accept(event)
          await automationRepository.appendEngineEvent({
            runId: running.id,
            leaseOwner: schedulerOwner,
            event,
            now: Date.now(),
          })
        }
        result = automationEngineReadResultSchema.parse(await automationEngineAdapter.read(receipt))
        if (result.status === "pending") {
          await delay(250, undefined, { signal: controller.signal })
        }
      }

      const persisted = await automationRepository.engineExecution(running.id)
      if (!persisted || persisted.afterSequence !== result.finalSequence) {
        throw new Error("automation_engine_result_cursor_mismatch")
      }
      if (result.threadId !== null && result.threadId !== running.cloudThread.id) {
        throw new Error("automation_engine_thread_identity_mismatch")
      }

      if (result.status === "failed" && result.error?.retryable && running.attemptCount < AUTOMATION_MAXIMUM_ATTEMPTS) {
        await automationRepository.appendEvent({
          runId: running.id,
          leaseOwner: schedulerOwner,
          type: "warning",
          payload: { message: "Execution failed; one fixed-delay retry will be attempted." },
          now: Date.now(),
        })
        const queued = await automationRepository.queueRetry({ runId: running.id, leaseOwner: schedulerOwner, now: Date.now() })
        if (queued) {
          await delay(AUTOMATION_RETRY_DELAY_MS, undefined, { signal: controller.signal }).catch(() => undefined)
          if (!controller.signal.aborted) {
            const retried = await automationRepository.reclaimQueued({
              runId: running.id,
              leaseOwner: schedulerOwner,
              leaseMs: env.automations.leaseMs,
              now: Date.now(),
            })
            if (retried) {
              clearInterval(heartbeat)
              clearTimeout(timeout)
              this.activeControllers.delete(running.id)
              void this.process(retried)
              return
            }
          }
        }
      }

      await automationRepository.complete({
        runId: running.id,
        leaseOwner: schedulerOwner,
        status: result.status,
        resultSummary: result.resultSummary,
        usage: result.usage,
        error: result.error,
        now: Date.now(),
      })
    } catch (error) {
      const reason = controller.signal.reason
      const shuttingDown = reason instanceof Error && reason.message === "Den is shutting down"
      if (shuttingDown) return
      if (receipt && controller.signal.aborted) {
        await automationEngineAdapter.cancel(receipt).catch(() => undefined)
      }
      logger.error("Automation execution failed", {
        run_id: claimed.run.id,
        error: error instanceof Error ? error.message : String(error),
      })
      await automationRepository.complete({
        runId: claimed.run.id,
        leaseOwner: schedulerOwner,
        status: controller.signal.aborted && reason instanceof Error && reason.message.includes("cancelled") ? "cancelled" : "failed",
        resultSummary: null,
        usage: { inputTokens: null, outputTokens: null, costMicros: null },
        error: {
          code: controller.signal.aborted
            ? (reason instanceof Error && reason.message.includes("timed out") ? "execution_timed_out" : "cancelled")
            : "execution_failed",
          message: error instanceof Error ? error.message : "Automation execution failed.",
          retryable: false,
        },
        now: Date.now(),
      }).catch(() => undefined)
    } finally {
      clearInterval(heartbeat)
      clearTimeout(timeout)
      this.activeControllers.delete(claimed.run.id)
    }
  }
}

export const automationService = new AutomationService()
