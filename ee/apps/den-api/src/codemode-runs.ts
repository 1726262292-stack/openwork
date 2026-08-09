import { createHash } from "node:crypto"
import type { createDenDb } from "@openwork-ee/den-db"
import { and, desc, eq } from "@openwork-ee/den-db/drizzle"
import { CodemodeRunTable } from "@openwork-ee/den-db/schema"
import { createDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"
import type { CodemodeRunResult } from "./mcp/codemode-run.js"

type CodemodeDb = ReturnType<typeof createDenDb>["db"]

export type RecordCodemodeRunInput = {
  organizationId: DenTypeId<"organization">
  orgMembershipId?: DenTypeId<"member"> | null
  source: string
  code: string
  status: "succeeded" | "failed"
  errorKind?: string | null
  errorMessage?: string | null
  toolCalls: Array<{ name: string }>
  durationMs: number
  startedAt: Date
  finishedAt: Date
}

export function codemodeCodeDigest(code: string): string {
  return `sha256:${createHash("sha256").update(code).digest("hex")}`
}

export async function recordCodemodeRun(database: CodemodeDb, input: RecordCodemodeRunInput): Promise<void> {
  try {
    await database.insert(CodemodeRunTable).values({
      id: createDenTypeId("codemodeRun"),
      organization_id: input.organizationId,
      org_membership_id: input.orgMembershipId ?? null,
      source: input.source,
      code_digest: codemodeCodeDigest(input.code),
      status: input.status,
      error_kind: input.errorKind ?? null,
      error_message: input.errorMessage ?? null,
      tool_calls: input.toolCalls,
      tool_call_count: input.toolCalls.length,
      duration_ms: input.durationMs,
      started_at: input.startedAt,
      finished_at: input.finishedAt,
    })
  } catch (error) {
    console.error("codemode_run_receipt_failed", {
      organization_id: input.organizationId,
      org_membership_id: input.orgMembershipId ?? null,
      source: input.source,
      error,
    })
  }
}

export function recordCodemodeScriptResult(
  database: CodemodeDb,
  input: Omit<RecordCodemodeRunInput, "status" | "errorKind" | "errorMessage" | "toolCalls" | "durationMs">,
  result: CodemodeRunResult,
): Promise<void> {
  return recordCodemodeRun(database, {
    ...input,
    status: result.ok ? "succeeded" : "failed",
    errorKind: result.ok ? null : result.error.kind,
    errorMessage: result.ok ? null : result.error.message,
    toolCalls: result.toolCalls,
    durationMs: result.durationMs,
  })
}

export async function listCodemodeRuns(database: CodemodeDb, input: {
  organizationId: DenTypeId<"organization">
  orgMembershipId?: DenTypeId<"member">
  limit?: number
}) {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50))
  return database
    .select()
    .from(CodemodeRunTable)
    .where(input.orgMembershipId
      ? and(
        eq(CodemodeRunTable.organization_id, input.organizationId),
        eq(CodemodeRunTable.org_membership_id, input.orgMembershipId),
      )
      : eq(CodemodeRunTable.organization_id, input.organizationId))
    .orderBy(desc(CodemodeRunTable.created_at))
    .limit(limit)
}
