import { createHash } from "node:crypto"
import {
  LlmProviderAccessTable,
  LlmProviderTable,
  TeamMemberTable,
} from "@openwork-ee/den-db"
import { eq } from "@openwork-ee/den-db/drizzle"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import type { Context, Hono } from "hono"
import {
  verifyInferenceJwt,
  type InferenceJwtIdentity,
} from "./den-jwt.js"
import { db } from "./db.js"

const byoPathPrefix = "/api/v1/byo"
const chatCompletionsSuffix = "/chat/completions"
const modelsSuffix = "/models"
const fallbackProviderBaseUrls: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
}

type Provider = Pick<
  typeof LlmProviderTable.$inferSelect,
  "id" | "organizationId" | "providerId" | "providerConfig" | "apiKey"
>

type ProviderAccess = Pick<
  typeof LlmProviderAccessTable.$inferSelect,
  "orgMembershipId" | "teamId"
>

type ProxyRequestInit = RequestInit & { duplex: "half" }

export type ByoDependencies = {
  verifyJwt: (token: string) => Promise<InferenceJwtIdentity | null>
  findProvider: (llmProviderId: string) => Promise<Provider | null>
  listTeamIds: (orgMembershipId: string) => Promise<string[]>
  listProviderAccess: (llmProviderId: string) => Promise<ProviderAccess[]>
  fetch: typeof fetch
}

async function findProvider(llmProviderId: string) {
  let normalizedId: ReturnType<typeof normalizeDenTypeId<"llmProvider">>
  try {
    normalizedId = normalizeDenTypeId("llmProvider", llmProviderId)
  } catch {
    return null
  }
  const rows = await db
    .select({
      id: LlmProviderTable.id,
      organizationId: LlmProviderTable.organizationId,
      providerId: LlmProviderTable.providerId,
      providerConfig: LlmProviderTable.providerConfig,
      apiKey: LlmProviderTable.apiKey,
    })
    .from(LlmProviderTable)
    .where(eq(LlmProviderTable.id, normalizedId))
    .limit(1)
  return rows[0] ?? null
}

async function listTeamIds(orgMembershipId: string) {
  const normalizedId = normalizeDenTypeId("member", orgMembershipId)
  const rows = await db
    .select({ teamId: TeamMemberTable.teamId })
    .from(TeamMemberTable)
    .where(eq(TeamMemberTable.orgMembershipId, normalizedId))
  return rows.map((row) => row.teamId)
}

async function listProviderAccess(llmProviderId: string) {
  const normalizedId = normalizeDenTypeId("llmProvider", llmProviderId)
  return db
    .select({
      orgMembershipId: LlmProviderAccessTable.orgMembershipId,
      teamId: LlmProviderAccessTable.teamId,
    })
    .from(LlmProviderAccessTable)
    .where(eq(LlmProviderAccessTable.llmProviderId, normalizedId))
}

const defaultDependencies: ByoDependencies = {
  verifyJwt: verifyInferenceJwt,
  findProvider,
  listTeamIds,
  listProviderAccess,
  fetch,
}

function openAiError(status: number, code: string, message: string) {
  return Response.json(
    {
      error: {
        message,
        type: status === 401
          ? "authentication_error"
          : status >= 500
            ? "api_error"
            : "invalid_request_error",
        code,
      },
    },
    { status },
  )
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null
  return authorization.slice(7).trim() || null
}

function buildRequestId() {
  return createHash("sha256")
    .update(`${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 32)
}

function requestSuffix(path: string) {
  const segments = path.split("/")
  return segments.length > 5 ? `/${segments.slice(5).join("/")}` : ""
}

function localRouteRejection(suffix: string, method: string) {
  if (suffix === chatCompletionsSuffix) {
    if (method === "POST") return null
    return openAiError(
      405,
      "method_not_allowed",
      `Method ${method} is not allowed for ${chatCompletionsSuffix}. Use POST.`,
    )
  }
  if (suffix === modelsSuffix) {
    if (method === "GET") return null
    return openAiError(
      405,
      "method_not_allowed",
      `Method ${method} is not allowed for ${modelsSuffix}. Use GET.`,
    )
  }
  if (!suffix) {
    return openAiError(
      404,
      "not_found",
      `Specify a supported BYO inference route after ${byoPathPrefix}/:llmProviderId: GET /models or POST /chat/completions.`,
    )
  }
  return openAiError(
    404,
    "not_found",
    `Unsupported BYO inference route: ${method} ${suffix}.`,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readConfigString(value: unknown) {
  if (typeof value !== "string") return null
  return value.trim() || null
}

function resolveUpstreamBase(provider: Provider) {
  const options = provider.providerConfig.options
  const configuredBaseUrl = isRecord(options)
    ? readConfigString(options.baseURL)
    : null
  return configuredBaseUrl
    ?? readConfigString(provider.providerConfig.api)
    ?? fallbackProviderBaseUrls[provider.providerId]
    ?? null
}

function decodeProviderCredential(stored: string | null) {
  const trimmed = stored?.trim() ?? ""
  if (!trimmed) return { apiKey: null, apiKeys: null }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (isRecord(parsed)) {
      const entries = Object.entries(parsed)
      if (entries.length > 0 && entries.every(([, value]) => typeof value === "string")) {
        return {
          apiKey: null,
          apiKeys: entries.map(([, value]) => typeof value === "string" ? value.trim() : ""),
        }
      }
    }
  } catch {
    // Legacy credentials are stored as raw strings.
  }

  return { apiKey: trimmed, apiKeys: null }
}

function primaryProviderCredential(stored: string | null) {
  const credential = decodeProviderCredential(stored)
  return credential.apiKey ?? credential.apiKeys?.[0] ?? null
}

function hasProviderAccess(
  accessRows: ProviderAccess[],
  orgMembershipId: string,
  teamIds: string[],
) {
  const teams = new Set(teamIds)
  return accessRows.some((access) =>
    access.orgMembershipId === orgMembershipId
    || (access.teamId !== null && teams.has(access.teamId))
    || (access.orgMembershipId === null && access.teamId === null),
  )
}

function sanitizeHeaders(request: Request, apiKey: string, openworkRequestId: string) {
  const headers = new Headers()
  const accept = request.headers.get("accept")
  const contentType = request.headers.get("content-type")
  if (accept) headers.set("accept", accept)
  if (contentType) headers.set("content-type", contentType)
  headers.set("authorization", `Bearer ${apiKey}`)
  headers.set("x-openwork-request-id", openworkRequestId)
  return headers
}

function redactCredential(value: string, credential: string) {
  return credential ? value.split(credential).join("[REDACTED]") : value
}

async function logUpstreamError(
  upstream: Response,
  input: {
    upstreamUrl: URL
    openworkRequestId: string
    organizationId: string
    orgMembershipId: string
    llmProviderId: string
    credential: string
  },
) {
  let bodySnippet: string | null = null
  try {
    const text = await upstream.clone().text()
    bodySnippet = redactCredential(text.slice(0, 2000), input.credential)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    bodySnippet = `Failed to read upstream error body: ${redactCredential(message, input.credential)}`
  }
  console.error("[inference-proxy] BYO upstream request failed", {
    openworkRequestId: input.openworkRequestId,
    organizationId: input.organizationId,
    orgMembershipId: input.orgMembershipId,
    llmProviderId: input.llmProviderId,
    upstreamUrl: redactCredential(input.upstreamUrl.toString(), input.credential),
    status: upstream.status,
    statusText: upstream.statusText,
    bodySnippet,
  })
}

export function registerByoRoutes(
  app: Hono,
  dependencies: ByoDependencies = defaultDependencies,
) {
  async function handleByoRequest(c: Context) {
    const token = readBearerToken(c.req.raw)
    if (!token) {
      return c.json({
        error: {
          message: "Missing OpenWork inference bearer token.",
          type: "authentication_error",
          code: "missing_api_key",
        },
      }, 401)
    }

    const identity = await dependencies.verifyJwt(token)
    if (!identity) {
      return c.json({
        error: {
          message: "Invalid OpenWork inference bearer token.",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      }, 401)
    }

    const suffix = requestSuffix(c.req.path)
    const routeRejection = localRouteRejection(suffix, c.req.method)
    if (routeRejection) return routeRejection

    const llmProviderId = c.req.param("llmProviderId")
    if (!llmProviderId) {
      return openAiError(404, "provider_not_found", "LLM provider not found.")
    }
    const provider = await dependencies.findProvider(llmProviderId)
    if (!provider) {
      return openAiError(404, "provider_not_found", "LLM provider not found.")
    }
    if (provider.organizationId !== identity.organizationId) {
      return openAiError(403, "provider_access_denied", "LLM provider is not available to this organization.")
    }

    const [teamIds, accessRows] = await Promise.all([
      dependencies.listTeamIds(identity.orgMembershipId),
      dependencies.listProviderAccess(llmProviderId),
    ])
    if (!hasProviderAccess(accessRows, identity.orgMembershipId, teamIds)) {
      return openAiError(403, "provider_access_denied", "You do not have access to this LLM provider.")
    }

    const upstreamBase = resolveUpstreamBase(provider)
    if (!upstreamBase) {
      return openAiError(502, "provider_upstream_unconfigured", "The LLM provider has no supported upstream API URL.")
    }
    const credential = primaryProviderCredential(provider.apiKey)
    if (!credential) {
      return openAiError(502, "provider_credential_missing", "The LLM provider has no usable API credential.")
    }

    const search = new URL(c.req.url).search
    let upstreamUrl: URL
    try {
      upstreamUrl = new URL(`${upstreamBase.replace(/\/+$/, "")}${suffix}${search}`)
    } catch {
      return openAiError(502, "provider_upstream_invalid", "The LLM provider upstream API URL is invalid.")
    }

    const openworkRequestId = buildRequestId()
    let upstream: Response
    try {
      const upstreamInit: ProxyRequestInit = {
        method: c.req.method,
        headers: sanitizeHeaders(c.req.raw, credential, openworkRequestId),
        body: c.req.method === "POST" ? c.req.raw.body : null,
        duplex: "half",
      }
      upstream = await dependencies.fetch(upstreamUrl, upstreamInit)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[inference-proxy] Failed to reach BYO upstream", {
        openworkRequestId,
        organizationId: identity.organizationId,
        orgMembershipId: identity.orgMembershipId,
        llmProviderId,
        upstreamUrl: redactCredential(upstreamUrl.toString(), credential),
        error: redactCredential(message, credential),
      })
      return openAiError(502, "upstream_unreachable", "Failed to reach the LLM provider upstream.")
    }

    if (!upstream.ok) {
      await logUpstreamError(upstream, {
        upstreamUrl,
        openworkRequestId,
        organizationId: identity.organizationId,
        orgMembershipId: identity.orgMembershipId,
        llmProviderId,
        credential,
      })
    }

    const headers = new Headers(upstream.headers)
    headers.set("x-openwork-request-id", openworkRequestId)
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    })
  }

  app.all(`${byoPathPrefix}/:llmProviderId`, handleByoRequest)
  app.all(`${byoPathPrefix}/:llmProviderId/*`, handleByoRequest)
}
