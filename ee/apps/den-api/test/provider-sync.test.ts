import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import {
  PROVIDER_SYNC_TOKEN_AUDIENCE,
  PROVIDER_SYNC_TOKEN_TTL_SECONDS,
  PROVIDER_SYNC_TOKEN_USE,
} from "@openwork/types/den/provider-sync"
import { verifyJwsAccessToken } from "better-auth/oauth2"
import { serializeSignedCookie } from "better-call"

const API_ORIGIN = "http://127.0.0.1:8790"

process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test_model_team_inheritance"
process.env.DB_MODE ??= "mysql"
process.env.DEN_DB_ENCRYPTION_KEY ??= "provider-sync-encryption-key-1234567890"
process.env.BETTER_AUTH_SECRET ??= "provider-sync-auth-secret-1234567890"
process.env.BETTER_AUTH_URL ??= API_ORIGIN
process.env.CORS_ORIGINS ??= API_ORIGIN
process.env.DEN_ORG_PROVIDER_SYNC_DEFAULT = "1"

let app: typeof import("../src/app.js").default
let db: typeof import("../src/db.js").db
let schema: typeof import("@openwork-ee/den-db/schema")
let drizzle: typeof import("@openwork-ee/den-db/drizzle")
let env: typeof import("../src/env.js").env

type AuthJwkRow = {
  id: string
  publicKey: string
  privateKey: string
  createdAt: Date
  expiresAt: Date | null
  alg: string | null
  crv: string | null
}

let originalJwks: AuthJwkRow[] = []
let replacedJwks = false

const ownerUserId = createDenTypeId("user")
const memberUserId = createDenTypeId("user")
const organizationId = createDenTypeId("organization")
const ownerMemberId = createDenTypeId("member")
const memberId = createDenTypeId("member")
const ownerSessionId = createDenTypeId("session")
const memberSessionId = createDenTypeId("session")
const ownerSessionToken = `provider-sync-owner-${ownerSessionId}`
const memberSessionToken = `provider-sync-member-${memberSessionId}`
const providerId = createDenTypeId("llmProvider")
const unsafeProviderId = createDenTypeId("llmProvider")
const openworkProviderId = createDenTypeId("llmProvider")
const inaccessibleProviderId = createDenTypeId("llmProvider")
const ownerProviderAccessId = createDenTypeId("llmProviderAccess")
const memberProviderAccessId = createDenTypeId("llmProviderAccess")
const unsafeProviderAccessId = createDenTypeId("llmProviderAccess")
const openworkProviderAccessId = createDenTypeId("llmProviderAccess")
const providerUpdatedAt = new Date("2025-01-01T00:00:00.000Z")
let ownerCookie = ""
let memberCookie = ""

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function tokenFromPayload(payload: unknown) {
  if (!isRecord(payload) || typeof payload.token !== "string") {
    throw new Error("Token response did not include a token")
  }
  return payload.token
}

async function responseJson(response: Response) {
  const payload: unknown = await response.json()
  if (!isRecord(payload)) {
    throw new Error("Expected a JSON object response")
  }
  return payload
}

async function appJwks() {
  const response = await app.fetch(new Request(`${API_ORIGIN}/api/auth/jwks`))
  expect(response.status).toBe(200)
  return response.json()
}

async function verifyToken(token: string, audience: string) {
  const payload: unknown = await verifyJwsAccessToken(token, {
    jwksFetch: appJwks,
    verifyOptions: {
      issuer: `${env.betterAuthUrl}/api/auth`,
      audience,
      algorithms: ["EdDSA"],
    },
  })
  if (!isRecord(payload)) {
    throw new Error("Verified JWT payload was not an object")
  }
  return payload
}

async function setOrganizationMetadata(metadata: Record<string, unknown> | null) {
  await db
    .update(schema.OrganizationTable)
    .set({ metadata })
    .where(drizzle.eq(schema.OrganizationTable.id, organizationId))
}

async function cleanup() {
  await db.delete(schema.LlmProviderModelTable).where(drizzle.inArray(
    schema.LlmProviderModelTable.llmProviderId,
    [providerId, unsafeProviderId, openworkProviderId, inaccessibleProviderId],
  ))
  await db.delete(schema.LlmProviderAccessTable).where(drizzle.inArray(
    schema.LlmProviderAccessTable.llmProviderId,
    [providerId, unsafeProviderId, openworkProviderId, inaccessibleProviderId],
  ))
  await db.delete(schema.LlmProviderTable).where(drizzle.inArray(
    schema.LlmProviderTable.id,
    [providerId, unsafeProviderId, openworkProviderId, inaccessibleProviderId],
  ))
  await db.delete(schema.AuthSessionTable).where(drizzle.inArray(
    schema.AuthSessionTable.id,
    [ownerSessionId, memberSessionId],
  ))
  await db.delete(schema.MemberTable).where(drizzle.eq(schema.MemberTable.organizationId, organizationId))
  await db.delete(schema.OrganizationTable).where(drizzle.eq(schema.OrganizationTable.id, organizationId))
  await db.delete(schema.AuthUserTable).where(drizzle.inArray(
    schema.AuthUserTable.id,
    [ownerUserId, memberUserId],
  ))
}

beforeAll(async () => {
  mock.restore()
  const realDb = (await import("@openwork-ee/den-db")).createDenDb({
    databaseUrl: process.env.DATABASE_URL,
    mode: "mysql",
  }).db
  mock.module("../src/db.js", () => ({ db: realDb }))

  const [appModule, dbModule, schemaModule, drizzleModule, envModule] = await Promise.all([
    import("../src/app.js"),
    import("../src/db.js"),
    import("@openwork-ee/den-db/schema"),
    import("@openwork-ee/den-db/drizzle"),
    import("../src/env.js"),
  ])
  app = appModule.default
  db = dbModule.db
  schema = schemaModule
  drizzle = drizzleModule
  env = envModule.env

  await cleanup()
  originalJwks = await db.select().from(schema.AuthJwksTable)
  await db.delete(schema.AuthJwksTable)
  replacedJwks = true
  await db.insert(schema.AuthUserTable).values([
    {
      id: ownerUserId,
      name: "Provider Sync Owner",
      email: `provider-sync-owner+${ownerUserId}@test.local`,
      emailVerified: true,
    },
    {
      id: memberUserId,
      name: "Provider Sync Member",
      email: `provider-sync-member+${memberUserId}@test.local`,
      emailVerified: true,
    },
  ])
  await db.insert(schema.OrganizationTable).values({
    id: organizationId,
    name: "Provider Sync Test",
    slug: `provider-sync-${organizationId}`,
    metadata: { capabilities: { orgProviderSync: false } },
  })
  await db.insert(schema.MemberTable).values([
    { id: ownerMemberId, organizationId, userId: ownerUserId, role: "owner" },
    { id: memberId, organizationId, userId: memberUserId, role: "member" },
  ])
  await db.insert(schema.AuthSessionTable).values([
    {
      id: ownerSessionId,
      userId: ownerUserId,
      activeOrganizationId: organizationId,
      token: ownerSessionToken,
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      id: memberSessionId,
      userId: memberUserId,
      activeOrganizationId: organizationId,
      token: memberSessionToken,
      expiresAt: new Date(Date.now() + 60_000),
    },
  ])
  await db.insert(schema.LlmProviderTable).values([
    {
      id: providerId,
      organizationId,
      createdByOrgMembershipId: ownerMemberId,
      source: "custom",
      providerId: "private-openai-compatible",
      name: "Private OpenAI Compatible",
      providerConfig: {
        id: "private-openai-compatible",
        name: "Private OpenAI Compatible",
        npm: "@ai-sdk/openai-compatible",
        api: "https://ignored-provider-sync.test/v1",
        options: { baseURL: "https://1.1.1.1/v1" },
        env: ["PRIVATE_PROVIDER_API_KEY"],
      },
      apiKey: "sync-secret-api-key",
      updatedAt: providerUpdatedAt,
    },
    {
      id: unsafeProviderId,
      organizationId,
      createdByOrgMembershipId: ownerMemberId,
      source: "custom",
      providerId: "on-prem-provider",
      name: "On-Prem Provider",
      providerConfig: {
        id: "on-prem-provider",
        name: "On-Prem Provider",
        npm: "@ai-sdk/anthropic",
        api: "http://10.0.0.8/v1",
        env: ["ON_PREM_ACCESS_KEY", "ON_PREM_SECRET_KEY"],
      },
      apiKey: JSON.stringify({
        ON_PREM_ACCESS_KEY: "on-prem-access-key",
        ON_PREM_SECRET_KEY: "on-prem-secret-key",
      }),
      updatedAt: providerUpdatedAt,
    },
    {
      id: openworkProviderId,
      organizationId,
      createdByOrgMembershipId: ownerMemberId,
      source: "openwork",
      providerId: "openwork",
      name: "OpenWork",
      providerConfig: { api: "https://openwork.test/api/v1" },
      apiKey: "openwork-secret",
    },
    {
      id: inaccessibleProviderId,
      organizationId,
      createdByOrgMembershipId: ownerMemberId,
      source: "custom",
      providerId: "owner-only",
      name: "Owner Only",
      providerConfig: { api: "https://owner-only.test/v1" },
      apiKey: "owner-only-secret",
    },
  ])
  await db.insert(schema.LlmProviderModelTable).values({
    id: createDenTypeId("llmProviderModel"),
    llmProviderId: providerId,
    modelId: "private-model",
    name: "Private Model",
    modelConfig: {
      id: "private-model",
      name: "Private Model",
      "x-api-key": "nested-model-secret",
      password: "model-password",
      client_secret: "model-client-secret",
      api_token: "model-api-token",
      reasoning: true,
      limit: { context: 128_000, output: 8_192, password: "nested-limit-secret" },
      modalities: { input: ["text"], output: ["text"] },
      options: { temperature: 0.2 },
    },
  })
  await db.insert(schema.LlmProviderAccessTable).values([
    { id: ownerProviderAccessId, llmProviderId: providerId, orgMembershipId: ownerMemberId },
    { id: memberProviderAccessId, llmProviderId: providerId, orgMembershipId: memberId },
    { id: unsafeProviderAccessId, llmProviderId: unsafeProviderId, orgMembershipId: memberId },
    { id: openworkProviderAccessId, llmProviderId: openworkProviderId, orgMembershipId: memberId },
    {
      id: createDenTypeId("llmProviderAccess"),
      llmProviderId: inaccessibleProviderId,
      orgMembershipId: ownerMemberId,
    },
  ])

  const betterAuthSecret = process.env.BETTER_AUTH_SECRET
  if (!betterAuthSecret) {
    throw new Error("BETTER_AUTH_SECRET is required")
  }
  ownerCookie = await serializeSignedCookie("better-auth.session_token", ownerSessionToken, betterAuthSecret)
  memberCookie = await serializeSignedCookie("better-auth.session_token", memberSessionToken, betterAuthSecret)
})

afterAll(async () => {
  if (db && schema && drizzle) {
    await cleanup()
    if (replacedJwks) {
      await db.delete(schema.AuthJwksTable)
      if (originalJwks.length > 0) {
        await db.insert(schema.AuthJwksTable).values(originalJwks)
      }
    }
  }
  mock.restore()
})

test("organization provider sync mints scoped JWTs and returns secret-bearing revocable provider snapshots", async () => {
  const disabledMintResponse = await app.fetch(new Request(`${API_ORIGIN}/v1/provider-sync/token`, {
    method: "POST",
    headers: { cookie: memberCookie, origin: API_ORIGIN },
  }))
  expect(disabledMintResponse.status).toBe(403)
  await expect(disabledMintResponse.json()).resolves.toMatchObject({ error: "org_provider_sync_disabled" })

  await setOrganizationMetadata(null)
  const initialMintResponse = await app.fetch(new Request(`${API_ORIGIN}/v1/provider-sync/token`, {
    method: "POST",
    headers: { cookie: memberCookie, origin: API_ORIGIN },
  }))
  expect(initialMintResponse.status).toBe(200)
  const initialProviderSyncToken = tokenFromPayload(await initialMintResponse.json())

  await setOrganizationMetadata({ capabilities: { orgProviderSync: false } })
  const disabledProvidersResponse = await app.fetch(new Request(`${API_ORIGIN}/v1/provider-sync/providers`, {
    headers: { authorization: `Bearer ${initialProviderSyncToken}` },
  }))
  expect(disabledProvidersResponse.status).toBe(403)
  await expect(disabledProvidersResponse.json()).resolves.toMatchObject({ error: "org_provider_sync_disabled" })

  await setOrganizationMetadata(null)
  const desktopConfigResponse = await app.fetch(new Request(`${API_ORIGIN}/v1/me/desktop-config`, {
    headers: { cookie: memberCookie, origin: API_ORIGIN },
  }))
  expect(desktopConfigResponse.status).toBe(200)
  await expect(desktopConfigResponse.json()).resolves.toMatchObject({ orgProviderSyncEnabled: true })

  const mintResponse = await app.fetch(new Request(`${API_ORIGIN}/v1/provider-sync/token`, {
    method: "POST",
    headers: { cookie: memberCookie, origin: API_ORIGIN },
  }))
  expect(mintResponse.status).toBe(200)
  const mintPayload = await responseJson(mintResponse)
  const providerSyncToken = tokenFromPayload(mintPayload)
  const providerSyncPayload = await verifyToken(providerSyncToken, PROVIDER_SYNC_TOKEN_AUDIENCE)

  const tokenUseClaim = `${env.mcpClaimNamespace}/token_use`
  const orgIdClaim = `${env.mcpClaimNamespace}/org_id`
  const membershipIdClaim = `${env.mcpClaimNamespace}/org_membership_id`
  expect(providerSyncPayload).toMatchObject({
    sub: memberUserId,
    aud: PROVIDER_SYNC_TOKEN_AUDIENCE,
    iss: `${env.betterAuthUrl}/api/auth`,
    [tokenUseClaim]: PROVIDER_SYNC_TOKEN_USE,
    [orgIdClaim]: organizationId,
    [membershipIdClaim]: memberId,
  })
  expect(providerSyncPayload.exp).toBe(Number(providerSyncPayload.iat) + PROVIDER_SYNC_TOKEN_TTL_SECONDS)

  const sessionProvidersResponse = await app.fetch(new Request(`${API_ORIGIN}/v1/provider-sync/providers`, {
    headers: { cookie: memberCookie, origin: API_ORIGIN },
  }))
  expect(sessionProvidersResponse.status).toBe(401)

  const createApiKeyResponse = await app.fetch(new Request(`${API_ORIGIN}/v1/api-keys`, {
    method: "POST",
    headers: { cookie: ownerCookie, origin: API_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ name: "Provider sync denial" }),
  }))
  expect(createApiKeyResponse.status).toBe(201)
  const createdApiKey = await responseJson(createApiKeyResponse)
  if (typeof createdApiKey.key !== "string") throw new Error("Organization API key was not returned")
  const apiKeyProvidersResponse = await app.fetch(new Request(`${API_ORIGIN}/v1/provider-sync/providers`, {
    headers: { authorization: `Bearer ${createdApiKey.key}` },
  }))
  expect(apiKeyProvidersResponse.status).toBe(401)
  const createdApiKeyRecord = isRecord(createdApiKey.apiKey) ? createdApiKey.apiKey : null
  if (!createdApiKeyRecord || typeof createdApiKeyRecord.id !== "string") {
    throw new Error("Organization API key id was not returned")
  }
  const deleteApiKeyResponse = await app.fetch(new Request(
    `${API_ORIGIN}/v1/api-keys/${createdApiKeyRecord.id}`,
    { method: "DELETE", headers: { cookie: ownerCookie, origin: API_ORIGIN } },
  ))
  expect(deleteApiKeyResponse.status).toBe(204)

  const providersResponse = await app.fetch(new Request(`${API_ORIGIN}/v1/provider-sync/providers`, {
    headers: { authorization: `Bearer ${providerSyncToken}` },
  }))
  expect(providersResponse.status).toBe(200)
  const providersPayload = await responseJson(providersResponse)
  expect(providersPayload.providers).toEqual(expect.arrayContaining([
    {
      id: providerId,
      localProviderId: providerId,
      name: "Private OpenAI Compatible",
      source: "custom",
      providerId: "private-openai-compatible",
      updatedAt: providerUpdatedAt.toISOString(),
      baseUrl: "https://1.1.1.1/v1",
      npm: "@ai-sdk/openai-compatible",
      env: ["PRIVATE_PROVIDER_API_KEY"],
      apiKey: "sync-secret-api-key",
      apiKeys: null,
      models: [{
        modelId: "private-model",
        name: "Private Model",
        modelConfig: {
          id: "private-model",
          name: "Private Model",
          reasoning: true,
          limit: { context: 128_000, output: 8_192 },
          modalities: { input: ["text"], output: ["text"] },
        },
      }],
    },
    {
      id: unsafeProviderId,
      localProviderId: unsafeProviderId,
      name: "On-Prem Provider",
      source: "custom",
      providerId: "on-prem-provider",
      updatedAt: providerUpdatedAt.toISOString(),
      baseUrl: "http://10.0.0.8/v1",
      npm: "@ai-sdk/anthropic",
      env: ["ON_PREM_ACCESS_KEY", "ON_PREM_SECRET_KEY"],
      apiKey: null,
      apiKeys: {
        ON_PREM_ACCESS_KEY: "on-prem-access-key",
        ON_PREM_SECRET_KEY: "on-prem-secret-key",
      },
      models: [],
    },
  ]))
  const syncedProviders = Array.isArray(providersPayload.providers)
    ? providersPayload.providers.filter(isRecord)
    : []
  expect(syncedProviders).toHaveLength(2)
  const syncedProvider = syncedProviders.find((provider) => provider.id === providerId)
  if (!syncedProvider) {
    throw new Error("Provider snapshot did not include a provider")
  }
  const localProviderId = syncedProvider.localProviderId
  expect(localProviderId).toBe(providerId)
  expect(localProviderId).toMatch(/^lpr_/)
  expect(localProviderId).not.toMatch(/^lpr_lpr_/)
  const serializedProviders = JSON.stringify(providersPayload)
  expect(serializedProviders).toContain("sync-secret-api-key")
  expect(serializedProviders).toContain("on-prem-secret-key")
  expect(serializedProviders).not.toContain("nested-model-secret")
  expect(serializedProviders).not.toContain("model-password")
  expect(serializedProviders).not.toContain("model-client-secret")
  expect(serializedProviders).not.toContain("model-api-token")
  expect(serializedProviders).not.toContain("nested-limit-secret")
  expect(serializedProviders).not.toContain("openwork-secret")
  expect(serializedProviders).not.toContain("owner-only-secret")

  const etag = providersResponse.headers.get("etag")
  expect(etag).toBe(`"${providersPayload.etag}"`)
  expect(providersResponse.headers.get("cache-control")).toBe("no-store")
  const notModifiedResponse = await app.fetch(new Request(`${API_ORIGIN}/v1/provider-sync/providers`, {
    headers: {
      authorization: `Bearer ${providerSyncToken}`,
      "if-none-match": etag ?? "",
    },
  }))
  expect(notModifiedResponse.status).toBe(304)
  expect(notModifiedResponse.headers.get("cache-control")).toBe("no-store")

  const deleteAccessResponse = await app.fetch(new Request(
    `${API_ORIGIN}/v1/llm-providers/${providerId}/access/${memberProviderAccessId}`,
    {
      method: "DELETE",
      headers: { cookie: ownerCookie, origin: API_ORIGIN },
    },
  ))
  expect(deleteAccessResponse.status).toBe(204)

  const [updatedProvider] = await db
    .select({ updatedAt: schema.LlmProviderTable.updatedAt })
    .from(schema.LlmProviderTable)
    .where(drizzle.eq(schema.LlmProviderTable.id, providerId))
    .limit(1)
  expect(updatedProvider?.updatedAt.getTime()).toBeGreaterThan(providerUpdatedAt.getTime())

  const revokedAccessResponse = await app.fetch(new Request(`${API_ORIGIN}/v1/provider-sync/providers`, {
    headers: { authorization: `Bearer ${providerSyncToken}` },
  }))
  expect(revokedAccessResponse.status).toBe(200)
  const revokedAccessPayload = await responseJson(revokedAccessResponse)
  const revokedProviderIds = Array.isArray(revokedAccessPayload.providers)
    ? revokedAccessPayload.providers.filter(isRecord).map((provider) => provider.id)
    : []
  expect(revokedProviderIds).toEqual([unsafeProviderId])
  expect(revokedAccessResponse.headers.get("etag")).not.toBe(etag)
})
