import { eq, isNull } from "@openwork-ee/den-db/drizzle"
import {
  DesktopPolicyMemberTable,
  DesktopPolicyTable,
  OrganizationTable,
  SsoConnectionTable,
} from "@openwork-ee/den-db/schema"
import { normalizeDefaultDesktopPolicyValue } from "@openwork/types/den/desktop-policies"
import { db } from "../src/db.js"
import { parseOrganizationPlan } from "../src/entitlements.js"
import { normalizeOrganizationMetadata } from "../src/organization-limits.js"

// Grandfathers organizations that already use enterprise features (SSO,
// customized desktop policies, enforced SSO, or desktop version pinning) onto
// the enterprise plan so that enabling DEN_PLAN_GATING_ENABLED never breaks
// them. Safe to re-run; orgs already on the enterprise tier are skipped.
const dryRun = process.argv.includes("--dry-run")

function isCustomizedDefaultPolicy(policy: unknown) {
  return Object.values(normalizeDefaultDesktopPolicyValue(policy)).some((value) => value === false)
}

const ssoOrgIds = new Set(
  (await db.select({ organizationId: SsoConnectionTable.organizationId }).from(SsoConnectionTable))
    .map((row) => row.organizationId),
)

const policies = await db
  .select({
    organizationId: DesktopPolicyTable.organizationId,
    isDefault: DesktopPolicyTable.isDefault,
    policy: DesktopPolicyTable.policy,
  })
  .from(DesktopPolicyTable)
  .where(isNull(DesktopPolicyTable.deletedAt))

const policyOrgIds = new Set(
  policies
    .filter((row) => row.isDefault !== true || isCustomizedDefaultPolicy(row.policy))
    .map((row) => row.organizationId),
)

const assignmentOrgIds = new Set(
  (await db.select({ organizationId: DesktopPolicyMemberTable.organizationId }).from(DesktopPolicyMemberTable))
    .map((row) => row.organizationId),
)

const organizations = await db
  .select({ id: OrganizationTable.id, metadata: OrganizationTable.metadata })
  .from(OrganizationTable)

const grandfatheredAt = new Date().toISOString()
let updates = 0

for (const organization of organizations) {
  const { metadata } = normalizeOrganizationMetadata(organization.metadata)
  const usesEnterpriseFeatures =
    ssoOrgIds.has(organization.id) ||
    policyOrgIds.has(organization.id) ||
    assignmentOrgIds.has(organization.id) ||
    metadata.requireSso === true ||
    (Array.isArray(metadata.allowedDesktopVersions) && metadata.allowedDesktopVersions.length > 0)

  if (!usesEnterpriseFeatures) {
    continue
  }

  if (parseOrganizationPlan(metadata).tier === "enterprise") {
    continue
  }

  updates += 1
  if (dryRun) {
    console.log(`Dry run: would grandfather organization ${organization.id} onto the enterprise plan.`)
    continue
  }

  await db
    .update(OrganizationTable)
    .set({
      metadata: {
        ...metadata,
        plan: { tier: "enterprise", source: "grandfathered", grandfatheredAt },
      },
    })
    .where(eq(OrganizationTable.id, organization.id))
  console.log(`Grandfathered organization ${organization.id} onto the enterprise plan.`)
}

console.log(
  dryRun
    ? `Dry run complete: ${updates} organizations would be grandfathered.`
    : `Backfill complete: ${updates} organizations grandfathered.`,
)
process.exit(0)
