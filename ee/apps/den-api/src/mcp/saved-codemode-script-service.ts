import type { createDenDb } from "@openwork-ee/den-db"
import type { DenTypeId } from "@openwork-ee/utils/typeid"
import { recordCodemodeRun, recordCodemodeScriptResult } from "../codemode-runs.js"
import {
  parseCodemodeScriptPayload,
  validateCodemodeScriptInput,
  validateCodemodeScriptOutput,
  type CodemodeScriptInputIssue,
} from "./codemode-script-object.js"
import { firstUnattendedUnsafeCapability, restrictCodemodeToolTree, type BuiltCodemodeTools } from "./codemode-tools.js"
import { runCodemodeScript } from "./codemode-run.js"

type CodemodeDb = ReturnType<typeof createDenDb>["db"]

export type SavedCodemodeScriptExecutionResult =
  | {
      ok: true
      value: unknown
      canonicalResult: string
      receiptId: DenTypeId<"codemodeRun"> | null
      logs: string[]
      toolCalls: Array<{ name: string }>
      durationMs: number
    }
  | { ok: false; error: "unsupported"; message: string }
  | { ok: false; error: "invalid_arguments" | "invalid_result"; message: string; issues: CodemodeScriptInputIssue[]; receiptId?: DenTypeId<"codemodeRun"> | null }
  | {
      ok: false
      error: "capability_unavailable"
      message: string
      providerCallAttempted: false
      missing: Array<{ capabilityName: string; scriptPath: string }>
    }
  | { ok: false; error: "script_failed"; message: string; kind: string; toolCalls: Array<{ name: string }> }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`
  }
  const encoded = JSON.stringify(value)
  return encoded === undefined ? "null" : encoded
}

export async function executeSavedCodemodeScript(input: {
  database: CodemodeDb
  organizationId: DenTypeId<"organization">
  orgMembershipId: DenTypeId<"member">
  pluginId: DenTypeId<"plugin">
  configObjectId: DenTypeId<"configObject">
  configObjectVersionId: DenTypeId<"configObjectVersion">
  automationRunId?: DenTypeId<"automationRun">
  normalizedPayloadJson: unknown
  code: string
  scriptInput?: unknown
  validateOutput?: boolean
  buildTools: () => Promise<BuiltCodemodeTools>
}): Promise<SavedCodemodeScriptExecutionResult> {
  const parsed = parseCodemodeScriptPayload(input.normalizedPayloadJson)
  if (!parsed.ok) return { ok: false, error: "unsupported", message: parsed.message }

  if (parsed.payload.inputSchema) {
    const validation = validateCodemodeScriptInput(parsed.payload.inputSchema, input.scriptInput)
    if (!validation.ok) {
      return validation.error === "invalid_schema"
        ? { ok: false, error: "unsupported", message: validation.message }
        : {
            ok: false,
            error: "invalid_arguments",
            message: "The arguments do not match the saved script's inputSchema.",
            issues: validation.issues,
          }
    }
  }

  const built = await input.buildTools().catch(() => ({ tools: {}, manifest: [] }))
  const unsafe = input.automationRunId
    ? firstUnattendedUnsafeCapability(built, parsed.payload.requiredCapabilities)
    : null
  if (unsafe) {
    return {
      ok: false,
      error: "capability_unavailable",
      message: `Required capability ${unsafe.scriptPath} (${unsafe.capabilityName}) must be read-only and explicitly approved by an organization admin before it can run unattended in OpenWork Cloud.`,
      providerCallAttempted: false,
      missing: [unsafe],
    }
  }
  const restricted = restrictCodemodeToolTree({ built, requiredCapabilities: parsed.payload.requiredCapabilities })
  const firstMissing = restricted.missing[0]
  if (firstMissing) {
    return {
      ok: false,
      error: "capability_unavailable",
      message: `Required capability ${firstMissing.scriptPath} (${firstMissing.capabilityName}) is unavailable or disabled for this organization.`,
      providerCallAttempted: false,
      missing: restricted.missing,
    }
  }

  const startedAt = new Date()
  const result = await runCodemodeScript({
    code: input.code,
    scriptInput: input.scriptInput,
    tools: restricted.tools,
    timeoutMs: Math.min(parsed.payload.limits?.timeoutMs ?? 120_000, 170_000),
    maxToolCalls: parsed.payload.limits?.maxToolCalls,
    maxOutputBytes: parsed.payload.limits?.maxOutputBytes,
  })
  const finishedAt = new Date()
  if (!result.ok) {
    await recordCodemodeScriptResult(input.database, {
      organizationId: input.organizationId,
      orgMembershipId: input.orgMembershipId,
      automationRunId: input.automationRunId,
      pluginId: input.pluginId,
      configObjectId: input.configObjectId,
      configObjectVersionId: input.configObjectVersionId,
      source: `plugin:${input.pluginId}:${input.configObjectId}`,
      code: input.code,
      startedAt,
      finishedAt,
    }, result)
    return { ok: false, error: "script_failed", message: result.error.message, kind: result.error.kind, toolCalls: result.toolCalls }
  }

  if (input.validateOutput === true && parsed.payload.outputSchema) {
    const validation = validateCodemodeScriptOutput(parsed.payload.outputSchema, result.value)
    if (!validation.ok) {
      if (validation.error === "invalid_schema") return { ok: false, error: "unsupported", message: validation.message }
      const receiptId = await recordCodemodeRun(input.database, {
        organizationId: input.organizationId,
        orgMembershipId: input.orgMembershipId,
        automationRunId: input.automationRunId,
        pluginId: input.pluginId,
        configObjectId: input.configObjectId,
        configObjectVersionId: input.configObjectVersionId,
        source: `plugin:${input.pluginId}:${input.configObjectId}`,
        code: input.code,
        status: "failed",
        errorKind: "InvalidResult",
        errorMessage: "The saved script result did not match its outputSchema.",
        toolCalls: result.toolCalls,
        durationMs: result.durationMs,
        startedAt,
        finishedAt,
      })
      return {
        ok: false,
        error: "invalid_result",
        message: "The saved script result does not match its outputSchema.",
        issues: validation.issues,
        receiptId,
      }
    }
  }

  const receiptId = await recordCodemodeScriptResult(input.database, {
    organizationId: input.organizationId,
    orgMembershipId: input.orgMembershipId,
    automationRunId: input.automationRunId,
    pluginId: input.pluginId,
    configObjectId: input.configObjectId,
    configObjectVersionId: input.configObjectVersionId,
    ...(input.validateOutput === true ? { validatedResult: result.value } : {}),
    source: `plugin:${input.pluginId}:${input.configObjectId}`,
    code: input.code,
    startedAt,
    finishedAt,
  }, result)
  return {
    ok: true,
    value: result.value,
    canonicalResult: canonical(result.value),
    receiptId,
    logs: result.logs.map((log) => log.trim()).filter(Boolean),
    toolCalls: result.toolCalls,
    durationMs: result.durationMs,
  }
}
