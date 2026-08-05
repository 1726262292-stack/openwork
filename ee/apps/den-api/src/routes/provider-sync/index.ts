import { createHash } from "node:crypto"
import { and, eq, inArray, isNull } from "@openwork-ee/den-db/drizzle"
import {
  LlmProviderModelTable,
  LlmProviderTable,
  MemberTable,
  OrganizationTable,
} from "@openwork-ee/den-db/schema"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import {
  PROVIDER_SYNC_PROVIDERS_PATH,
  PROVIDER_SYNC_TOKEN_AUDIENCE,
  PROVIDER_SYNC_TOKEN_PATH,
  PROVIDER_SYNC_TOKEN_TTL_SECONDS,
  PROVIDER_SYNC_TOKEN_USE,
  type SyncedProvider,
} from "@openwork/types/den/provider-sync"
import { verifyJwsAccessToken } from "better-auth/oauth2"
import type { Hono, MiddlewareHandler } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"
import { auth } from "../../auth.js"
import { organizationOrgProviderSyncEnabled } from "../../capability-sources/org-provider-sync-rollout.js"
import { db } from "../../db.js"
import { env } from "../../env.js"
import { decodeProviderCredential, readProviderEnvNames } from "../../llm/provider-credentials.js"
import { DEN_JWT_SIGNING_ALGORITHM, getDenAuthIssuer } from "../../mcp/jwt-policy.js"
import {
  orgMemberRoute,
  tokenRoute,
  type OrganizationContextVariables,
} from "../../middleware/index.js"
import { emptyResponse, forbiddenSchema, jsonResponse, unauthorizedSchema } from "../../openapi.js"
import { appLogger } from "../../observability/logger.js"
import { listTeamsForMember } from "../../orgs.js"
import type { AuthContextVariables } from "../../session.js"
import { listAccessibleLlmProviderAccess } from "../org/llm-provider-access.js"

type ProviderSyncPrincipal = {
  userId: NonNullable<typeof MemberTable.$inferSelect.userId>
  organizationId: typeof MemberTable.$inferSelect.organizationId
  membershipId: typeof MemberTable.$inferSelect.id
  organizationMetadata: typeof OrganizationTable.$inferSelect.metadata
}

export type ProviderSyncContextVariables = {
  providerSyncPrincipal: ProviderSyncPrincipal | null
}

type ProviderSyncRouteVariables = AuthContextVariables
  & Partial<OrganizationContextVariables>
  & Partial<ProviderSyncContextVariables>

type ProviderSyncVerification =
  | { ok: true; principal: ProviderSyncPrincipal }
  | { ok: false; status: 401 | 403; error: string; message: string }

const logger = appLogger.child({ component: "provider_sync" })
const PROVIDER_SYNC_JWT_SIGNING_ALGORITHMS = [DEN_JWT_SIGNING_ALGORITHM]
const TOKEN_USE_CLAIM = `${env.mcpClaimNamespace}/token_use`
const ORG_ID_CLAIM = `${env.mcpClaimNamespace}/org_id`
const ORG_MEMBERSHIP_ID_CLAIM = `${env.mcpClaimNamespace}/org_membership_id`
const fallbackProviderBaseUrls: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
}

const tokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string().datetime(),
})

const syncedProviderModelSchema = z.object({
  modelId: z.string(),
  name: z.string().nullable(),
  modelConfig: z.record(z.string(), z.unknown()).nullable(),
})

const syncedProvidersResponseSchema = z.object({
  providers: z.array(z.object({
    id: z.string(),
    localProviderId: z.string(),
    name: z.string(),
    source: z.enum(["models_dev", "custom", "openwork"]),
    providerId: z.string().nullable(),
    updatedAt: z.string().datetime(),
    baseUrl: z.string(),
    npm: z.string(),
    env: z.array(z.string()),
    apiKey: z.string().nullable(),
    apiKeys: z.record(z.string(), z.string()).nullable(),
    models: z.array(syncedProviderModelSchema),
  })),
  etag: z.string(),
})

const providerSyncDisabledSchema = z.object({
  error: z.literal("org_provider_sync_disabled"),
  message: z.string(),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readBearerToken(headers: Headers) {
  const authorization = headers.get("authorization")?.trim() ?? ""
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

async function getJwks() {
  const response = await auth.handler(new Request(`${env.betterAuthUrl}/api/auth/jwks`))
  if (!response.ok) {
    throw new Error("Unable to load auth JWKS")
  }
  return response.json()
}

async function verifyProviderSyncRequest(headers: Headers): Promise<ProviderSyncVerification> {
  const token = readBearerToken(headers)
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "provider_sync_token_required",
      message: "Provide a provider-sync Bearer token.",
    }
  }

  let payload: unknown
  try {
    payload = await verifyJwsAccessToken(token, {
      jwksFetch: getJwks,
      verifyOptions: {
        issuer: getDenAuthIssuer(env.betterAuthUrl),
        audience: PROVIDER_SYNC_TOKEN_AUDIENCE,
        algorithms: PROVIDER_SYNC_JWT_SIGNING_ALGORITHMS,
      },
    })
  } catch {
    return {
      ok: false,
      status: 401,
      error: "invalid_provider_sync_token",
      message: "The provider-sync Bearer token is invalid or expired.",
    }
  }

  if (!isRecord(payload) || readString(payload[TOKEN_USE_CLAIM]) !== PROVIDER_SYNC_TOKEN_USE) {
    return {
      ok: false,
      status: 401,
      error: "wrong_token_use",
      message: "The Bearer token is not a provider-sync token.",
    }
  }

  const subject = readString(payload.sub)
  const organizationClaim = readString(payload[ORG_ID_CLAIM])
  const membershipClaim = readString(payload[ORG_MEMBERSHIP_ID_CLAIM])
  if (!subject || !organizationClaim || !membershipClaim) {
    return {
      ok: false,
      status: 401,
      error: "missing_provider_sync_principal",
      message: "The provider-sync token is missing its organization principal.",
    }
  }

  let userId: typeof MemberTable.$inferSelect.userId
  let organizationId: typeof MemberTable.$inferSelect.organizationId
  let membershipId: typeof MemberTable.$inferSelect.id
  try {
    userId = normalizeDenTypeId("user", subject)
    organizationId = normalizeDenTypeId("organization", organizationClaim)
    membershipId = normalizeDenTypeId("member", membershipClaim)
  } catch {
    return {
      ok: false,
      status: 401,
      error: "invalid_provider_sync_principal",
      message: "The provider-sync token contains an invalid organization principal.",
    }
  }

  const [membership] = await db
    .select({
      userId: MemberTable.userId,
      organizationId: MemberTable.organizationId,
      membershipId: MemberTable.id,
      organizationMetadata: OrganizationTable.metadata,
    })
    .from(MemberTable)
    .innerJoin(OrganizationTable, eq(MemberTable.organizationId, OrganizationTable.id))
    .where(and(
      eq(MemberTable.id, membershipId),
      eq(MemberTable.userId, userId),
      eq(MemberTable.organizationId, organizationId),
      isNull(MemberTable.removedAt),
    ))
    .limit(1)

  if (!membership?.userId) {
    return {
      ok: false,
      status: 403,
      error: "provider_sync_membership_revoked",
      message: "The provider-sync token's organization membership is no longer active.",
    }
  }

  return {
    ok: true,
    principal: {
      ...membership,
      userId: membership.userId,
    },
  }
}

function providerSyncFailure(result: Exclude<ProviderSyncVerification, { ok: true }>) {
  return new Response(JSON.stringify({ error: result.error, message: result.message }), {
    status: result.status,
    headers: { "content-type": "application/json" },
  })
}

// The route behind this middleware returns provider credentials. It verifies
// the provider-sync JWT directly and never falls back to a user session or an
// organization API key resolved by the general authentication middleware.
const providerSyncAuth: MiddlewareHandler<{ Variables: ProviderSyncRouteVariables }> = async (c, next) => {
  const verification = await verifyProviderSyncRequest(c.req.raw.headers)
  if (!verification.ok) {
    return providerSyncFailure(verification)
  }

  c.set("providerSyncPrincipal", verification.principal)
  await next()
}

function syncEnabled(metadata: typeof OrganizationTable.$inferSelect.metadata) {
  return organizationOrgProviderSyncEnabled(metadata, {
    defaultEnabled: env.orgProviderSyncDefaultEnabled,
  })
}

async function mintToken(input: {
  userId: ProviderSyncPrincipal["userId"]
  organizationId: ProviderSyncPrincipal["organizationId"]
  membershipId: ProviderSyncPrincipal["membershipId"]
  audience: string
  tokenUse: string
  ttlSeconds: number
}) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAtSeconds = issuedAt + input.ttlSeconds
  const { token } = await auth.api.signJWT({
    body: {
      payload: {
        sub: input.userId,
        aud: input.audience,
        iss: getDenAuthIssuer(env.betterAuthUrl),
        iat: issuedAt,
        exp: expiresAtSeconds,
        [TOKEN_USE_CLAIM]: input.tokenUse,
        [ORG_ID_CLAIM]: input.organizationId,
        [ORG_MEMBERSHIP_ID_CLAIM]: input.membershipId,
      },
    },
  })

  return {
    token,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  }
}

function resolveUpstreamBase(providerConfig: Record<string, unknown>, providerId: string | null) {
  const options = providerConfig.options
  return (isRecord(options) ? readString(options.baseURL) : null)
    ?? readString(providerConfig.api)
    ?? (providerId ? fallbackProviderBaseUrls[providerId] : null)
    ?? null
}

const modelModalitySchema = z.enum(["text", "audio", "image", "video", "pdf"])
const modelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
  context_over_200k: z.object({
    input: z.number(),
    output: z.number(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
  }).optional(),
})
const modelConfigFieldSchemas = {
  id: z.string(),
  name: z.string(),
  family: z.string(),
  release_date: z.string(),
  attachment: z.boolean(),
  reasoning: z.boolean(),
  temperature: z.boolean(),
  tool_call: z.boolean(),
  interleaved: z.union([
    z.literal(true),
    z.object({ field: z.enum(["reasoning", "reasoning_content", "reasoning_details"]) }),
  ]),
  cost: modelCostSchema,
  limit: z.object({
    context: z.number(),
    input: z.number().optional(),
    output: z.number(),
  }),
  modalities: z.object({
    input: z.array(modelModalitySchema).optional(),
    output: z.array(modelModalitySchema).optional(),
  }),
  experimental: z.boolean(),
  status: z.enum(["alpha", "beta", "deprecated", "active"]),
}

function sanitizeModelConfig(modelConfig: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {}
  for (const [key, schema] of Object.entries(modelConfigFieldSchemas)) {
    const value = modelConfig[key]
    if (value === undefined) continue
    const parsed = schema.safeParse(value)
    if (parsed.success) sanitized[key] = parsed.data
  }
  return sanitized
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function requestMatchesEtag(header: string | undefined, etag: string) {
  if (!header) {
    return false
  }
  return header.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "").replace(/^"|"$/g, "")
    return normalized === "*" || normalized === etag
  })
}

async function listSyncedProviders(principal: ProviderSyncPrincipal): Promise<SyncedProvider[]> {
  const memberTeams = await listTeamsForMember({
    organizationId: principal.organizationId,
    memberId: principal.membershipId,
  })
  const access = await listAccessibleLlmProviderAccess({
    organizationId: principal.organizationId,
    currentMemberId: principal.membershipId,
    teamIds: memberTeams.map((team) => team.id),
  })
  const providerIds = [...new Set(access.map((entry) => entry.llmProviderId))]
  if (providerIds.length === 0) {
    return []
  }

  const providerRows = await db
    .select({
      id: LlmProviderTable.id,
      name: LlmProviderTable.name,
      source: LlmProviderTable.source,
      providerId: LlmProviderTable.providerId,
      providerConfig: LlmProviderTable.providerConfig,
      apiKey: LlmProviderTable.apiKey,
      updatedAt: LlmProviderTable.updatedAt,
    })
    .from(LlmProviderTable)
    .where(and(
      eq(LlmProviderTable.organizationId, principal.organizationId),
      inArray(LlmProviderTable.id, providerIds),
    ))

  const providers = providerRows.filter((provider) => provider.source !== "openwork")

  if (providers.length === 0) {
    return []
  }

  const models = await db
    .select({
      llmProviderId: LlmProviderModelTable.llmProviderId,
      modelId: LlmProviderModelTable.modelId,
      name: LlmProviderModelTable.name,
      modelConfig: LlmProviderModelTable.modelConfig,
    })
    .from(LlmProviderModelTable)
    .where(inArray(LlmProviderModelTable.llmProviderId, providers.map((provider) => provider.id)))

  const modelsByProviderId = new Map<typeof LlmProviderTable.$inferSelect.id, typeof models>()
  for (const model of models) {
    const providerModels = modelsByProviderId.get(model.llmProviderId) ?? []
    providerModels.push(model)
    modelsByProviderId.set(model.llmProviderId, providerModels)
  }

  const syncedProviders: SyncedProvider[] = []
  for (const provider of providers.sort((left, right) => left.id.localeCompare(right.id))) {
    const upstreamBase = resolveUpstreamBase(provider.providerConfig, provider.providerId)
    if (!upstreamBase) {
      logger.warn("provider sync skipped provider without an upstream", {
        llmProviderId: provider.id,
        providerId: provider.providerId,
      })
      continue
    }
    const providerModels = (modelsByProviderId.get(provider.id) ?? [])
      .sort((left, right) => left.modelId.localeCompare(right.modelId))
      .map((model) => ({
        modelId: model.modelId,
        name: model.name,
        modelConfig: sanitizeModelConfig(model.modelConfig),
      }))

    const credential = decodeProviderCredential(provider.apiKey)
    syncedProviders.push({
      id: provider.id,
      localProviderId: provider.id,
      name: provider.name,
      source: provider.source,
      providerId: provider.providerId,
      updatedAt: provider.updatedAt.toISOString(),
      baseUrl: upstreamBase,
      npm: readString(provider.providerConfig.npm) ?? "@ai-sdk/openai-compatible",
      env: readProviderEnvNames(provider.providerConfig),
      apiKey: credential.apiKey,
      apiKeys: credential.apiKeys,
      models: providerModels,
    })
  }

  return syncedProviders
}

export function registerProviderSyncRoutes<T extends { Variables: ProviderSyncRouteVariables }>(app: Hono<T>) {
  app.post(
    PROVIDER_SYNC_TOKEN_PATH,
    describeRoute({
      tags: ["Authentication"],
      summary: "Mint provider-sync token",
      description: "Mints a long-lived organization provider-sync token for a signed-in desktop session.",
      responses: {
        200: jsonResponse("Provider-sync token minted successfully.", tokenResponseSchema),
        401: jsonResponse("The caller must be signed in.", unauthorizedSchema),
        403: jsonResponse("Provider sync is disabled or the caller used an API key.", z.union([forbiddenSchema, providerSyncDisabledSchema])),
      },
    }),
    orgMemberRoute(),
    async (c) => {
      if (c.get("apiKey")) {
        return c.json({
          error: "forbidden",
          message: "Use a signed-in user session to mint provider-sync tokens.",
        }, 403)
      }

      const organizationContext = c.get("organizationContext")
      if (!syncEnabled(organizationContext.organization.metadata)) {
        return c.json({
          error: "org_provider_sync_disabled",
          message: "Organization provider sync is not enabled for this organization.",
        }, 403)
      }

      return c.json(await mintToken({
        userId: organizationContext.currentMember.userId,
        organizationId: organizationContext.organization.id,
        membershipId: organizationContext.currentMember.id,
        audience: PROVIDER_SYNC_TOKEN_AUDIENCE,
        tokenUse: PROVIDER_SYNC_TOKEN_USE,
        ttlSeconds: PROVIDER_SYNC_TOKEN_TTL_SECONDS,
      }))
    },
  )

  app.get(
    PROVIDER_SYNC_PROVIDERS_PATH,
    describeRoute({
      tags: ["LLM Providers"],
      summary: "List synchronized organization providers",
      description: "Returns the secret-bearing provider snapshot to an authenticated openwork-server sync client.",
      responses: {
        200: jsonResponse("Provider snapshot returned successfully.", syncedProvidersResponseSchema),
        304: emptyResponse("The provider snapshot has not changed."),
        401: jsonResponse("A valid provider-sync token is required.", unauthorizedSchema),
        403: jsonResponse("Provider sync is disabled or membership was revoked.", z.union([forbiddenSchema, providerSyncDisabledSchema])),
      },
    }),
    tokenRoute,
    providerSyncAuth,
    async (c) => {
      const principal = c.get("providerSyncPrincipal")
      if (!principal) {
        return c.json({ error: "provider_sync_token_required" }, 401)
      }
      if (!syncEnabled(principal.organizationMetadata)) {
        return c.json({
          error: "org_provider_sync_disabled",
          message: "Organization provider sync is not enabled for this organization.",
        }, 403)
      }

      c.header("Cache-Control", "no-store")
      const providers = await listSyncedProviders(principal)
      const etag = createHash("sha256").update(stableSerialize(providers)).digest("hex")
      c.header("ETag", `"${etag}"`)
      if (requestMatchesEtag(c.req.header("if-none-match"), etag)) {
        return c.body(null, 304)
      }
      return c.json({ providers, etag })
    },
  )
}
