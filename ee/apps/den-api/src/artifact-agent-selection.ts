import { and, eq } from "@openwork-ee/den-db/drizzle"
import { ArtifactAgentSelectionTable } from "@openwork-ee/den-db/schema"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "./db.js"
import { getCodemodeScriptDetail } from "./codemode-scripts.js"
import type { PluginArchActorContext } from "./routes/org/plugin-system/access.js"

export type ArtifactAgentSelection = {
  organizationId: string
  orgMembershipId: string
  artifactId: string
  selectedAt: string
}

function selectionWhere(context: PluginArchActorContext) {
  return and(
    eq(ArtifactAgentSelectionTable.organization_id, context.organizationContext.organization.id),
    eq(ArtifactAgentSelectionTable.org_membership_id, context.organizationContext.currentMember.id),
  )
}

function serialize(row: typeof ArtifactAgentSelectionTable.$inferSelect): ArtifactAgentSelection {
  return {
    organizationId: row.organization_id,
    orgMembershipId: row.org_membership_id,
    artifactId: row.artifact_id,
    selectedAt: row.selected_at.toISOString(),
  }
}

export async function getArtifactAgentSelection(context: PluginArchActorContext) {
  const rows = await db.select().from(ArtifactAgentSelectionTable).where(selectionWhere(context)).limit(1)
  const row = rows[0]
  if (!row) return null
  try {
    await getCodemodeScriptDetail({ context, configObjectId: row.artifact_id })
    return serialize(row)
  } catch {
    await db.delete(ArtifactAgentSelectionTable).where(selectionWhere(context))
    return null
  }
}

export async function selectArtifactForAgent(input: {
  context: PluginArchActorContext
  artifactId: string
}) {
  const artifactId = normalizeDenTypeId("configObject", input.artifactId)
  await getCodemodeScriptDetail({ context: input.context, configObjectId: artifactId })
  const selectedAt = new Date()
  await db.insert(ArtifactAgentSelectionTable).values({
    organization_id: input.context.organizationContext.organization.id,
    org_membership_id: input.context.organizationContext.currentMember.id,
    artifact_id: artifactId,
    selected_at: selectedAt,
  }).onDuplicateKeyUpdate({ set: { artifact_id: artifactId, selected_at: selectedAt } })
  return {
    organizationId: input.context.organizationContext.organization.id,
    orgMembershipId: input.context.organizationContext.currentMember.id,
    artifactId,
    selectedAt: selectedAt.toISOString(),
  } satisfies ArtifactAgentSelection
}

export async function clearArtifactAgentSelection(context: PluginArchActorContext) {
  await db.delete(ArtifactAgentSelectionTable).where(selectionWhere(context))
}
