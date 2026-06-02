import { and, eq, inArray, or } from "@openwork-ee/den-db/drizzle"
import { LlmProviderAccessTable, LlmProviderTable } from "@openwork-ee/den-db/schema"
import { db } from "../db.js"
import { buildDaytonaProviderSeed } from "./daytona-provider-seed.js"

type ProviderSeedMembership = {
  organizationId: typeof LlmProviderTable.$inferSelect.organizationId
  memberId: NonNullable<typeof LlmProviderAccessTable.$inferSelect.orgMembershipId>
  teamIds: Array<NonNullable<typeof LlmProviderAccessTable.$inferSelect.teamId>>
}

export type DaytonaProviderSeedMembership = ProviderSeedMembership

export async function loadMemberDaytonaProviderSeed(input: ProviderSeedMembership) {
  const teamIds = [...new Set(input.teamIds)]
  const accessWhere = teamIds.length > 0
    ? and(
        eq(LlmProviderTable.organizationId, input.organizationId),
        or(
          eq(LlmProviderAccessTable.orgMembershipId, input.memberId),
          inArray(LlmProviderAccessTable.teamId, teamIds),
        ),
      )
    : and(
        eq(LlmProviderTable.organizationId, input.organizationId),
        eq(LlmProviderAccessTable.orgMembershipId, input.memberId),
      )

  const rows = await db
    .select({
      providerId: LlmProviderTable.providerId,
      providerConfig: LlmProviderTable.providerConfig,
      apiKey: LlmProviderTable.apiKey,
    })
    .from(LlmProviderAccessTable)
    .innerJoin(LlmProviderTable, eq(LlmProviderAccessTable.llmProviderId, LlmProviderTable.id))
    .where(accessWhere)

  return buildDaytonaProviderSeed(rows)
}
