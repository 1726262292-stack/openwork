import { MemberTable } from "@openwork-ee/den-db"
import { and, eq, isNull } from "@openwork-ee/den-db/drizzle"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { INFERENCE_TOKEN_USE } from "@openwork/types/den/provider-sync"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { db } from "./db.js"
import { env } from "./env.js"

// @openwork/types does not yet export the audience alongside the provider-sync constants.
const inferenceTokenAudience = "openwork-inference"

export type InferenceJwtIdentity = {
  organizationId: string
  orgMembershipId: string
  userId: string
}

type DenJwtDependencies = {
  findActiveMembership: (identity: InferenceJwtIdentity) => Promise<boolean>
}

async function findActiveMembership(identity: InferenceJwtIdentity) {
  const organizationId = normalizeDenTypeId("organization", identity.organizationId)
  const orgMembershipId = normalizeDenTypeId("member", identity.orgMembershipId)
  const rows = await db
    .select({ id: MemberTable.id })
    .from(MemberTable)
    .where(and(
      eq(MemberTable.id, orgMembershipId),
      eq(MemberTable.organizationId, organizationId),
      isNull(MemberTable.removedAt),
    ))
    .limit(1)
  return rows.length > 0
}

const defaultDependencies: DenJwtDependencies = { findActiveMembership }

function createDenRemoteJwks(jwksUrl: string | null) {
  if (!jwksUrl) return null
  try {
    return createRemoteJWKSet(new URL(jwksUrl))
  } catch {
    return null
  }
}

const remoteJwks = createDenRemoteJwks(env.denJwksUrl)

export async function verifyInferenceJwt(
  token: string,
  dependencies: DenJwtDependencies = defaultDependencies,
): Promise<InferenceJwtIdentity | null> {
  const issuer = env.denJwtIssuer
  const claimNamespace = env.denClaimNamespace
  if (!issuer || !claimNamespace || !remoteJwks) return null

  try {
    const { payload } = await jwtVerify(token, remoteJwks, {
      issuer,
      audience: inferenceTokenAudience,
      algorithms: ["EdDSA"],
    })
    const tokenUse = payload[`${claimNamespace}/token_use`]
    const organizationId = payload[`${claimNamespace}/org_id`]
    const orgMembershipId = payload[`${claimNamespace}/org_membership_id`]
    const userId = payload.sub
    if (
      tokenUse !== INFERENCE_TOKEN_USE
      || typeof organizationId !== "string"
      || !organizationId
      || typeof orgMembershipId !== "string"
      || !orgMembershipId
      || typeof userId !== "string"
      || !userId
    ) {
      return null
    }

    const identity = { organizationId, orgMembershipId, userId }
    return await dependencies.findActiveMembership(identity) ? identity : null
  } catch {
    return null
  }
}
