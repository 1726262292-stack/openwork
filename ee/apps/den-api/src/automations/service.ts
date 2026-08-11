import { randomUUID } from "node:crypto"
import type { AutomationClaimResult, AutomationListItem } from "@openwork/automations"
import type {
  AutomationDesktopRunnerResult,
  AutomationDesktopRunnerRegistration,
  AutomationRunEventType,
  AutomationRun,
  AutomationAction,
  CreateAutomationDefinition,
  UpdateAutomation,
} from "@openwork/types/automations"
import { env } from "../env.js"
import { isActiveAutomationOwner, resolveAutomationModelAccess } from "./authority.js"
import { automationRepository } from "./repository.js"
import { validateSavedScriptAutomationAction } from "../codemode-scripts.js"

const schedulerOwner = `den:${process.pid}:${randomUUID()}`

type OwnerScope = { organizationId: string; ownerMemberId: string }
export type DesktopRunnerScope = OwnerScope & { runnerId: string }

const desktopLeaseOwner = (scope: DesktopRunnerScope) => `desktop:${scope.ownerMemberId}:${scope.runnerId}`

export type CloudSavedScriptExecution =
  | { ok: true; value: unknown; canonicalResult: string; receiptId: string }
  | { ok: false; message: string; retryable: boolean; receiptId?: string | null }

export type CloudSavedScriptExecutor = (input: {
  organizationId: string
  ownerMemberId: string
  automationRunId: string
  action: Extract<AutomationAction, { kind: "saved_script" }>
}) => Promise<CloudSavedScriptExecution>

let cloudSavedScriptExecutor: CloudSavedScriptExecutor | null = null

export function configureCloudSavedScriptExecutor(executor: CloudSavedScriptExecutor): void {
  cloudSavedScriptExecutor = executor
}

export class AutomationService {
  async list(scope: OwnerScope, input: { cursor?: string; limit?: number }) {
    const page = await automationRepository.list({ ...scope, cursor: input.cursor, limit: input.limit ?? 50 })
    return {
      ...page,
      items: await Promise.all(page.items.map((item) => this.reconcileModelAttention(item))),
    }
  }

  async get(scope: OwnerScope, automationId: string) {
    const item = await automationRepository.get({ ...scope, automationId })
    return item ? this.reconcileModelAttention(item) : null
  }

  async create(scope: OwnerScope, definition: CreateAutomationDefinition) {
    if ("action" in definition) {
      if ((definition.action.kind === "saved_script" && definition.executionTarget !== "cloud")
        || (definition.action.kind === "agent" && definition.executionTarget !== "desktop")) {
        throw new Error("automation_action_target_mismatch")
      }
      if (definition.action.kind === "agent") await this.requireModel(scope, definition.action.model)
      else {
        if (!await isActiveAutomationOwner(scope)) throw new Error("automation_owner_inactive")
        await validateSavedScriptAutomationAction({ ...scope, action: definition.action })
      }
    } else {
      await this.requireModel(scope, definition.model)
    }
    return automationRepository.create({ ...scope, definition, now: Date.now() })
  }

  async update(scope: OwnerScope, automationId: string, changes: UpdateAutomation) {
    const current = await this.get(scope, automationId)
    if (!current) return null
    const nextAction = changes.action ?? current.revision.action
    const nextTarget = changes.executionTarget ?? current.revision.executionTarget ?? "desktop"
    if ((nextAction?.kind === "saved_script" && nextTarget !== "cloud") || (nextAction?.kind !== "saved_script" && nextTarget !== "desktop")) {
      throw new Error("automation_action_target_mismatch")
    }
    if (nextAction?.kind === "agent") await this.requireModel(scope, nextAction.model)
    else if (nextAction?.kind === "saved_script") {
      await validateSavedScriptAutomationAction({ ...scope, action: nextAction })
    } else await this.requireModel(scope, changes.model ?? current.revision.model)
    return automationRepository.update({ ...scope, automationId, changes, now: Date.now() })
  }

  async activate(scope: OwnerScope, automationId: string) {
    const current = await this.get(scope, automationId)
    if (!current) return null
    if (current.revision.action?.kind === "saved_script") {
      if (!await isActiveAutomationOwner(scope)) throw new Error("automation_owner_inactive")
    } else await this.requireModel(scope, current.revision.model)
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
    if (current.automation.state === "needs_attention" && current.automation.needsAttentionReason) {
      const error = new Error(current.automation.needsAttentionReason.message)
      error.name = current.automation.needsAttentionReason.code
      throw error
    }
    // The persisted model selection is only as good as the owner's current
    // access; a revoked grant must fail the manual run, not dispatch it.
    if (current.revision.action?.kind === "saved_script") {
      if (!await isActiveAutomationOwner(scope)) throw new Error("automation_owner_inactive")
    } else await this.requireModel(scope, current.revision.model)
    const claim = await automationRepository.claim({
      automation: { ...current.automation, state: "active" },
      revision: current.revision,
      trigger: "manual",
      scheduledFor: null,
      nonce: randomUUID(),
      leaseOwner: schedulerOwner,
      leaseMs: env.automations.leaseMs,
      claimDeadlineMs: env.automations.runnerClaimDeadlineMs,
      now: Date.now(),
    })
    if (claim.kind === "claimed" && claim.run.executionTarget === "cloud") await this.executeCloudRun(claim.run.id)
    return (await automationRepository.getRunReceipt({ ...scope, runId: claim.run.id }))?.run ?? claim.run
  }

  listRuns(scope: OwnerScope, automationId: string, input: { cursor?: string; limit?: number }) {
    return automationRepository.listRuns({ ...scope, automationId, cursor: input.cursor, limit: input.limit ?? 50 })
  }

  getRun(scope: OwnerScope, runId: string) {
    return automationRepository.getRunReceipt({ ...scope, runId })
  }

  async cancelRun(scope: OwnerScope, runId: string): Promise<AutomationRun | null> {
    return automationRepository.requestCancellation({ ...scope, runId, now: Date.now() })
  }

  async tick(input: { now?: number; batchSize?: number } = {}): Promise<string[]> {
    const now = input.now ?? Date.now()
    const started: string[] = []
    await automationRepository.recoverExpiredLeases({ now, limit: input.batchSize ?? env.automations.batchSize })
    await automationRepository.expireUnclaimedDesktop({ now, limit: input.batchSize ?? env.automations.batchSize })

    const queuedCloud = await automationRepository.listQueuedCloud({ limit: input.batchSize ?? env.automations.batchSize })
    for (const runId of queuedCloud) {
      await this.executeCloudRun(runId)
      started.push(runId)
    }

    const due = await automationRepository.listDue({ now, limit: input.batchSize ?? env.automations.batchSize })
    for (const item of due) {
      const scheduledFor = item.automation.nextDueAt
      if (scheduledFor === null) continue
      // Revalidate the owner's model access at dispatch time. The occurrence is
      // still claimed either way so the schedule advances durably; a failed
      // check becomes a skipped receipt instead of work for the runner.
      const access = item.revision.action?.kind === "saved_script"
        ? (await isActiveAutomationOwner(item.automation)
            ? { ok: true as const }
            : { ok: false as const, code: "owner_membership_lost" as const, message: "The Automation owner is no longer active." })
        : await resolveAutomationModelAccess({
            organizationId: item.automation.organizationId,
            ownerMemberId: item.automation.ownerMemberId,
            ...item.revision.model,
          })
      let claim: AutomationClaimResult
      try {
        claim = await automationRepository.claim({
          automation: item.automation,
          revision: item.revision,
          trigger: "scheduled",
          scheduledFor,
          leaseOwner: schedulerOwner,
          leaseMs: env.automations.leaseMs,
          claimDeadlineMs: env.automations.runnerClaimDeadlineMs,
          now,
        })
      } catch (error) {
        if (error instanceof Error && error.message === "automation_not_active") continue
        throw error
      }
      if (claim.kind !== "claimed") continue
      if (!access.ok) {
        await automationRepository.skipRun({ runId: claim.run.id, code: access.code, message: access.message, now })
        await automationRepository.markNeedsAttention({
          automationId: item.automation.id,
          expectedRevisionId: item.revision.id,
          reason: { code: access.code, message: access.message, occurredAt: now },
          now,
        })
        continue
      }
      started.push(claim.run.id)
      if (claim.run.executionTarget === "cloud") await this.executeCloudRun(claim.run.id)
    }
    return started
  }

  async stop(): Promise<void> {}

  registerDesktopRunner(scope: OwnerScope, registration: AutomationDesktopRunnerRegistration) {
    return automationRepository.registerDesktopRunner({ ...scope, ...registration, now: Date.now() })
  }

  /** Runner tokens are revoked in effect the moment the owner leaves the org. */
  isActiveRunnerOwner(scope: OwnerScope) {
    return isActiveAutomationOwner(scope)
  }

  touchDesktopRunner(scope: DesktopRunnerScope) {
    return automationRepository.touchDesktopRunner({ ...scope, now: Date.now() })
  }

  async discoverDesktopRunnerWork(scope: DesktopRunnerScope) {
    await this.touchDesktopRunner(scope)
    return automationRepository.discoverDesktopWork({ ...scope, now: Date.now(), limit: 4 })
  }

  async claimDesktopRunner(scope: DesktopRunnerScope, runId: string) {
    const claimed = await automationRepository.claimDesktop({
      organizationId: scope.organizationId,
      ownerMemberId: scope.ownerMemberId,
      leaseOwner: desktopLeaseOwner(scope),
      runId,
      leaseMs: env.automations.leaseMs,
      now: Date.now(),
    })
    if (!claimed?.run.leaseExpiresAt) return null
    // Last gate before the assignment leaves Den: access revoked after the run
    // was queued must not reach the runner with the stale model selection.
    const access = await resolveAutomationModelAccess({
      organizationId: scope.organizationId,
      ownerMemberId: scope.ownerMemberId,
      ...claimed.revision.model,
    })
    if (!access.ok) {
      const now = Date.now()
      await automationRepository.skipRun({
        runId: claimed.run.id,
        code: access.code,
        message: access.message,
        now,
      })
      await automationRepository.markNeedsAttention({
        automationId: claimed.automation.id,
        expectedRevisionId: claimed.revision.id,
        reason: { code: access.code, message: access.message, occurredAt: now },
        now,
      })
      return null
    }
    return {
      executionTarget: "desktop" as const,
      runId: claimed.run.id,
      automationId: claimed.automation.id,
      automationName: claimed.automation.name,
      instructions: claimed.revision.instructions,
      model: claimed.revision.model,
      timeoutMs: claimed.revision.maximumRuntimeMs,
      leaseExpiresAt: claimed.run.leaseExpiresAt,
      attempt: claimed.run.attemptCount,
    }
  }

  heartbeatDesktopRunner(scope: DesktopRunnerScope, runId: string, attempt: number) {
    return automationRepository.heartbeatDesktop({
      runId,
      leaseOwner: desktopLeaseOwner(scope),
      attempt,
      leaseMs: env.automations.leaseMs,
      now: Date.now(),
    })
  }

  appendDesktopRunnerEvent(scope: DesktopRunnerScope, runId: string, event: {
    sequence: number
    attempt: number
    type: AutomationRunEventType
    payload: Record<string, unknown>
  }) {
    return automationRepository.appendDesktopEvent({
      runId,
      leaseOwner: desktopLeaseOwner(scope),
      sequence: event.sequence,
      attempt: event.attempt,
      type: event.type,
      payload: event.payload,
      now: Date.now(),
    })
  }

  async completeDesktopRunner(scope: DesktopRunnerScope, runId: string, result: AutomationDesktopRunnerResult) {
    const now = Date.now()
    const completed = await automationRepository.complete({
      runId,
      leaseOwner: desktopLeaseOwner(scope),
      status: result.status,
      resultSummary: result.resultSummary,
      usage: result.usage,
      error: result.error,
      attempt: result.attempt,
      now,
    })
    if (result.error?.code === "model_access_lost" || result.error?.code === "provider_unavailable") {
      await automationRepository.markNeedsAttention({
        automationId: completed.automationId,
        expectedRevisionId: completed.revisionId,
        reason: {
          code: result.error.code,
          message: result.error.message,
          occurredAt: now,
        },
        now,
      })
    }
    return completed
  }

  runnerNotifications(scope: DesktopRunnerScope, after: number) {
    return automationRepository.listRunnerNotifications({ ...scope, after, limit: 100 })
  }

  private async requireModel(scope: OwnerScope, model: { providerId: string; modelId: string }) {
    const result = await resolveAutomationModelAccess({ ...scope, ...model })
    if (!result.ok) {
      const error = new Error(result.message)
      error.name = result.code
      throw error
    }
  }

  private async reconcileModelAttention(item: AutomationListItem): Promise<AutomationListItem> {
    if (item.automation.state !== "active" || item.revision.action?.kind === "saved_script") return item
    const access = await resolveAutomationModelAccess({
      organizationId: item.automation.organizationId,
      ownerMemberId: item.automation.ownerMemberId,
      ...item.revision.model,
    })
    if (access.ok) return item
    const now = Date.now()
    await automationRepository.markNeedsAttention({
      automationId: item.automation.id,
      expectedRevisionId: item.revision.id,
      reason: { code: access.code, message: access.message, occurredAt: now },
      now,
    })
    return await automationRepository.get({
      organizationId: item.automation.organizationId,
      ownerMemberId: item.automation.ownerMemberId,
      automationId: item.automation.id,
    }) ?? item
  }

  private async executeCloudRun(runId: string): Promise<void> {
    const leaseOwner = `${schedulerOwner}:cloud:${runId}`
    const claimed = await automationRepository.claimCloud({
      runId,
      leaseOwner,
      leaseMs: env.automations.leaseMs,
      now: Date.now(),
    })
    if (!claimed || claimed.revision.action?.kind !== "saved_script") return
    const executor = cloudSavedScriptExecutor
    if (!executor) {
      await automationRepository.completeCloud({
        automationId: claimed.automation.id,
        runId,
        leaseOwner,
        status: "failed",
        resultSummary: "OpenWork Cloud script execution is unavailable.",
        error: { code: "execution_runtime_unavailable", message: "OpenWork Cloud script execution is unavailable.", retryable: true },
        now: Date.now(),
      })
      return
    }
    const result = await executor({
      organizationId: claimed.automation.organizationId,
      ownerMemberId: claimed.automation.ownerMemberId,
      automationRunId: runId,
      action: claimed.revision.action,
    }).catch((error): CloudSavedScriptExecution => ({
      ok: false,
      message: error instanceof Error ? error.message : "Saved script execution failed.",
      retryable: true,
    }))
    await automationRepository.completeCloud({
      automationId: claimed.automation.id,
      runId,
      leaseOwner,
      status: result.ok ? "succeeded" : "failed",
      resultSummary: result.ok ? result.canonicalResult : result.message,
      ...(result.ok ? { validatedResult: result.value, codemodeReceiptId: result.receiptId } : {}),
      ...(!result.ok && result.receiptId ? { codemodeReceiptId: result.receiptId } : {}),
      error: result.ok ? null : { code: "execution_failed", message: result.message, retryable: result.retryable },
      now: Date.now(),
    })
  }

}

export const automationService = new AutomationService()
