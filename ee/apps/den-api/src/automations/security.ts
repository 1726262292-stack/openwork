import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { and, eq, gt, isNull } from "@openwork-ee/den-db/drizzle"
import { AutomationRunTable, AutomationTable, MemberTable } from "@openwork-ee/den-db/schema"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "../db.js"

export function hashAutomationRunToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function mintAutomationRunToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url")
  return { token, hash: hashAutomationRunToken(token) }
}

function matchesHash(left: string, right: string): boolean {
  const leftBytes = Uint8Array.from(Buffer.from(left, "hex"))
  const rightBytes = Uint8Array.from(Buffer.from(right, "hex"))
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export type AutomationRunPrincipal = {
  runId: string
  automationId: string
  organizationId: string
  ownerMemberId: string
  ownerUserId: string
  leaseOwner: string
}

export async function verifyAutomationRunToken(input: {
  runId: string
  authorization: string | undefined
  now?: number
}): Promise<AutomationRunPrincipal | null> {
  const raw = input.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!raw) return null
  const now = new Date(input.now ?? Date.now())
  const rows = await db.select({
    run: AutomationRunTable,
    automation: AutomationTable,
    ownerUserId: MemberTable.userId,
  }).from(AutomationRunTable)
    .innerJoin(AutomationTable, eq(AutomationTable.id, AutomationRunTable.automation_id))
    .innerJoin(MemberTable, eq(MemberTable.id, AutomationTable.owner_member_id))
    .where(and(
      eq(AutomationRunTable.id, normalizeDenTypeId("automationRun", input.runId)),
      eq(AutomationRunTable.status, "running"),
      gt(AutomationRunTable.lease_expires_at, now),
      gt(AutomationRunTable.mcp_token_expires_at, now),
      isNull(AutomationRunTable.cancel_requested_at),
      isNull(MemberTable.removedAt),
    )).limit(1)
  const row = rows[0]
  if (!row?.run.mcp_token_hash || !row.run.lease_owner || !row.ownerUserId) return null
  if (!matchesHash(hashAutomationRunToken(raw), row.run.mcp_token_hash)) return null
  return {
    runId: row.run.id,
    automationId: row.automation.id,
    organizationId: row.automation.organization_id,
    ownerMemberId: row.automation.owner_member_id,
    ownerUserId: row.ownerUserId,
    leaseOwner: row.run.lease_owner,
  }
}
