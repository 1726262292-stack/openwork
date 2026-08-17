import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { and, eq, gt, isNull, or, sql } from "@openwork-ee/den-db/drizzle"
import {
  AdminAllowlistTable,
  AuthSessionTable,
  AuthUserTable,
  InitialAdminBootstrapClaimTable,
  InitialAdminBootstrapGrantTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { cache } from "./cache.js"
import { db } from "./db.js"
import { env } from "./env.js"
import { ensureSingletonOrganizationForUser, setSessionActiveOrganization } from "./orgs.js"

export const INITIAL_ADMIN_BOOTSTRAP_GRANT_PREFIX = "ow_bootstrap_"
export const INITIAL_ADMIN_BOOTSTRAP_CLAIM_KEY = "initial_admin"
const INITIAL_ADMIN_BOOTSTRAP_GRANT_TTL_MS = 10 * 60 * 1000
const BOOTSTRAPPED_ADMIN_NOTE = "Initial administrator bootstrap"
const GENERIC_BOOTSTRAP_REJECTION = "Setup could not be verified. Check the administrator email and one-time setup code."

type BootstrapStatus = "available" | "complete" | "unavailable"

export type InitialAdminBootstrapAvailability = {
  status: BootstrapStatus
  reason: "ready" | "complete" | "not_configured" | "code_malformed" | "users_exist" | "claim_consumed"
}

type BootstrapGrantReservation = {
  grantHash: string
  email: string
}

export function normalizeInitialAdminBootstrapEmail(email: string) {
  return email.trim().toLowerCase()
}

function configuredBootstrapEmails() {
  const ownerEmails = env.singleOrg.ownerEmails.map(normalizeInitialAdminBootstrapEmail).filter(Boolean)
  const fallbackAdminEmails = env.bootstrapAdminEmails.map(normalizeInitialAdminBootstrapEmail).filter(Boolean)
  return Array.from(new Set(ownerEmails.length > 0 ? ownerEmails : fallbackAdminEmails))
}

export function isInitialAdminBootstrapEmailConfigured(email: string) {
  const normalized = normalizeInitialAdminBootstrapEmail(email)
  return normalized.length > 0 && configuredBootstrapEmails().includes(normalized)
}

export function compareInitialAdminBootstrapCode(input: {
  submittedCode: string
  expectedSha256Hex: string
}) {
  if (!/^[0-9a-f]{64}$/.test(input.expectedSha256Hex)) {
    return false
  }
  const expected = new Uint8Array(Buffer.from(input.expectedSha256Hex, "hex"))
  const actual = new Uint8Array(Buffer.from(createHash("sha256").update(input.submittedCode, "utf8").digest("hex"), "hex"))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function hashGrantToken(token: string) {
  return sha256Hex(token)
}

function newGrantToken() {
  return `${INITIAL_ADMIN_BOOTSTRAP_GRANT_PREFIX}${randomBytes(32).toString("base64url")}`
}

function hasUsableBootstrapConfiguration() {
  if (configuredBootstrapEmails().length === 0) {
    return { ok: false as const, reason: "not_configured" as const }
  }
  if (env.initialAdminBootstrapCodeSha256.status === "malformed") {
    return { ok: false as const, reason: "code_malformed" as const }
  }
  if (env.initialAdminBootstrapCodeSha256.status !== "configured" || !env.initialAdminBootstrapCodeSha256.value) {
    return { ok: false as const, reason: "not_configured" as const }
  }
  return { ok: true as const, digest: env.initialAdminBootstrapCodeSha256.value }
}

async function anyAuthUserExists() {
  const rows = await db.select({ id: AuthUserTable.id }).from(AuthUserTable).limit(1)
  return Boolean(rows[0])
}

async function readClaim() {
  const rows = await db
    .select()
    .from(InitialAdminBootstrapClaimTable)
    .where(eq(InitialAdminBootstrapClaimTable.singletonKey, INITIAL_ADMIN_BOOTSTRAP_CLAIM_KEY))
    .limit(1)
  return rows[0] ?? null
}

async function ensureClaimRow() {
  await db
    .insert(InitialAdminBootstrapClaimTable)
    .values({ singletonKey: INITIAL_ADMIN_BOOTSTRAP_CLAIM_KEY })
    .onDuplicateKeyUpdate({ set: { updated_at: sql`CURRENT_TIMESTAMP(3)` } })
}

export async function getInitialAdminBootstrapAvailability(): Promise<InitialAdminBootstrapAvailability> {
  const config = hasUsableBootstrapConfiguration()
  if (!config.ok) {
    return { status: "unavailable", reason: config.reason }
  }

  const claim = await readClaim()
  if (claim?.consumedAt) {
    return { status: "complete", reason: "claim_consumed" }
  }

  if (await anyAuthUserExists()) {
    return { status: "complete", reason: "users_exist" }
  }

  return { status: "available", reason: "ready" }
}

export async function verifyInitialAdminBootstrap(input: {
  email: string
  code: string
}) {
  const normalizedEmail = normalizeInitialAdminBootstrapEmail(input.email)
  const config = hasUsableBootstrapConfiguration()
  if (!config.ok || !isInitialAdminBootstrapEmailConfigured(normalizedEmail)) {
    return { ok: false as const, status: 403, message: GENERIC_BOOTSTRAP_REJECTION }
  }

  const availability = await getInitialAdminBootstrapAvailability()
  if (availability.status !== "available") {
    return { ok: false as const, status: 409, message: "Initial administrator setup is not available." }
  }

  if (!compareInitialAdminBootstrapCode({ submittedCode: input.code, expectedSha256Hex: config.digest })) {
    return { ok: false as const, status: 403, message: GENERIC_BOOTSTRAP_REJECTION }
  }

  await ensureClaimRow()
  const grant = newGrantToken()
  const expiresAt = new Date(Date.now() + INITIAL_ADMIN_BOOTSTRAP_GRANT_TTL_MS)
  await db.insert(InitialAdminBootstrapGrantTable).values({
    tokenHash: hashGrantToken(grant),
    email: normalizedEmail,
    expiresAt,
  })

  return { ok: true as const, grant, expiresAt }
}

function readStringProperty(value: unknown, propertyName: string) {
  if (!value || typeof value !== "object") {
    return null
  }
  const property = Object.getOwnPropertyDescriptor(value, propertyName)?.value
  return typeof property === "string" && property.trim() ? property.trim() : null
}

export function readInitialAdminBootstrapGrantFromBody(body: unknown) {
  return readStringProperty(body, "bootstrapGrant")
}

export function isInitialAdminBootstrapGrantFormat(value: string) {
  return value.startsWith(INITIAL_ADMIN_BOOTSTRAP_GRANT_PREFIX) && value.length > INITIAL_ADMIN_BOOTSTRAP_GRANT_PREFIX.length
}

async function reserveGrantForSignup(input: {
  grant: string
  email: string
}): Promise<BootstrapGrantReservation | null> {
  const now = new Date()
  const grantHash = hashGrantToken(input.grant)
  const email = normalizeInitialAdminBootstrapEmail(input.email)
  const reservedExpiresAt = new Date(now.getTime() + INITIAL_ADMIN_BOOTSTRAP_GRANT_TTL_MS)

  return db.transaction(async (tx) => {
    const grantRows = await tx
      .select()
      .from(InitialAdminBootstrapGrantTable)
      .where(eq(InitialAdminBootstrapGrantTable.tokenHash, grantHash))
      .limit(1)
      .for("update")
    const grant = grantRows[0] ?? null
    if (!grant || grant.email !== email || grant.consumedAt || grant.expiresAt <= now) {
      return null
    }

    const claimRows = await tx
      .select()
      .from(InitialAdminBootstrapClaimTable)
      .where(eq(InitialAdminBootstrapClaimTable.singletonKey, INITIAL_ADMIN_BOOTSTRAP_CLAIM_KEY))
      .limit(1)
      .for("update")
    const claim = claimRows[0] ?? null
    if (!claim || claim.consumedAt) {
      return null
    }

    const userRows = await tx.select({ id: AuthUserTable.id }).from(AuthUserTable).limit(1).for("update")
    if (userRows[0]) {
      return null
    }

    const activeReservation = claim.reservedGrantHash
      && claim.reservedGrantHash !== grantHash
      && claim.reservedExpiresAt
      && claim.reservedExpiresAt > now
    if (activeReservation) {
      return null
    }

    await tx
      .update(InitialAdminBootstrapClaimTable)
      .set({ reservedGrantHash: grantHash, reservedAt: now, reservedExpiresAt })
      .where(eq(InitialAdminBootstrapClaimTable.singletonKey, INITIAL_ADMIN_BOOTSTRAP_CLAIM_KEY))

    return { grantHash, email }
  })
}

export async function authorizeInitialAdminBootstrapSignup(input: {
  body: unknown
  email: string | null
}) {
  const grant = readInitialAdminBootstrapGrantFromBody(input.body)
  if (!grant) {
    return null
  }
  if (!input.email || !isInitialAdminBootstrapGrantFormat(grant) || !isInitialAdminBootstrapEmailConfigured(input.email)) {
    return null
  }
  const reservation = await reserveGrantForSignup({ grant, email: input.email })
  if (!reservation) {
    return null
  }
  return reservation
}

export function initialAdminBootstrapSignupRejectedResponse() {
  return Response.json({ error: "bootstrap_verification_failed", message: GENERIC_BOOTSTRAP_REJECTION }, { status: 403 })
}

export async function releaseInitialAdminBootstrapReservation(reservation: BootstrapGrantReservation) {
  await db
    .update(InitialAdminBootstrapClaimTable)
    .set({ reservedGrantHash: null, reservedAt: null, reservedExpiresAt: null })
    .where(and(
      eq(InitialAdminBootstrapClaimTable.singletonKey, INITIAL_ADMIN_BOOTSTRAP_CLAIM_KEY),
      eq(InitialAdminBootstrapClaimTable.reservedGrantHash, reservation.grantHash),
    ))
}

async function readSessionByToken(token: string) {
  const rows = await db
    .select({ id: AuthSessionTable.id, userId: AuthSessionTable.userId, activeOrganizationId: AuthSessionTable.activeOrganizationId })
    .from(AuthSessionTable)
    .where(eq(AuthSessionTable.token, token))
    .limit(1)
  return rows[0] ?? null
}

function readAuthResponseToken(payload: unknown) {
  const token = readStringProperty(payload, "token") ?? readStringProperty(payload, "sessionToken")
  if (token) {
    return token
  }
  const session = !payload || typeof payload !== "object" ? null : Object.getOwnPropertyDescriptor(payload, "session")?.value
  return readStringProperty(session, "token")
}

async function ensureBootstrappedPlatformAdmin(email: string) {
  await db
    .insert(AdminAllowlistTable)
    .values({
      id: createDenTypeId("adminAllowlist"),
      email,
      note: BOOTSTRAPPED_ADMIN_NOTE,
    })
    .onDuplicateKeyUpdate({
      set: { note: BOOTSTRAPPED_ADMIN_NOTE, updated_at: sql`CURRENT_TIMESTAMP(3)` },
    })
}

async function consumeBootstrapReservation(input: {
  reservation: BootstrapGrantReservation
  userId: string
}) {
  const now = new Date()
  const normalizedUserId = normalizeDenTypeId("user", input.userId)
  return db.transaction(async (tx) => {
    const claimRows = await tx
      .select()
      .from(InitialAdminBootstrapClaimTable)
      .where(eq(InitialAdminBootstrapClaimTable.singletonKey, INITIAL_ADMIN_BOOTSTRAP_CLAIM_KEY))
      .limit(1)
      .for("update")
    const claim = claimRows[0] ?? null
    if (!claim || claim.consumedAt || claim.reservedGrantHash !== input.reservation.grantHash) {
      return false
    }

    const grantRows = await tx
      .select()
      .from(InitialAdminBootstrapGrantTable)
      .where(eq(InitialAdminBootstrapGrantTable.tokenHash, input.reservation.grantHash))
      .limit(1)
      .for("update")
    const grant = grantRows[0] ?? null
    if (!grant || grant.email !== input.reservation.email || grant.consumedAt || grant.expiresAt <= now) {
      return false
    }

    await tx
      .update(InitialAdminBootstrapGrantTable)
      .set({ consumedAt: now })
      .where(eq(InitialAdminBootstrapGrantTable.tokenHash, input.reservation.grantHash))
    await tx
      .update(InitialAdminBootstrapClaimTable)
      .set({
        consumedAt: now,
        consumedByUserId: normalizedUserId,
        reservedGrantHash: null,
        reservedAt: null,
        reservedExpiresAt: null,
      })
      .where(and(
        eq(InitialAdminBootstrapClaimTable.singletonKey, INITIAL_ADMIN_BOOTSTRAP_CLAIM_KEY),
        isNull(InitialAdminBootstrapClaimTable.consumedAt),
      ))
    await tx
      .update(InitialAdminBootstrapGrantTable)
      .set({ consumedAt: now })
      .where(and(
        eq(InitialAdminBootstrapGrantTable.email, input.reservation.email),
        isNull(InitialAdminBootstrapGrantTable.consumedAt),
        or(eq(InitialAdminBootstrapGrantTable.tokenHash, input.reservation.grantHash), gt(InitialAdminBootstrapGrantTable.expiresAt, now)),
      ))
    return true
  })
}

export async function completeInitialAdminBootstrapSignup(input: {
  reservation: BootstrapGrantReservation
  response: Response
}) {
  if (!input.response.ok) {
    await releaseInitialAdminBootstrapReservation(input.reservation)
    return input.response
  }

  const payload: unknown = await input.response.clone().json().catch(() => null)
  const token = readAuthResponseToken(payload)
  if (!token) {
    await releaseInitialAdminBootstrapReservation(input.reservation)
    return input.response
  }
  const session = await readSessionByToken(token)
  if (!session) {
    await releaseInitialAdminBootstrapReservation(input.reservation)
    return input.response
  }

  const organizationId = await ensureSingletonOrganizationForUser(session.userId, { forceOwner: true })
  if (organizationId && session.activeOrganizationId !== organizationId) {
    await setSessionActiveOrganization(normalizeDenTypeId("session", session.id), organizationId)
  } else {
    await cache.auth.deleteSession(token)
  }

  await ensureBootstrappedPlatformAdmin(input.reservation.email)
  const consumed = await consumeBootstrapReservation({ reservation: input.reservation, userId: session.userId })
  if (!consumed) {
    return Response.json({ error: "bootstrap_unavailable", message: "Initial administrator setup is not available." }, { status: 409 })
  }

  return input.response
}
