import assert from "node:assert/strict"
import { createServer, type IncomingMessage } from "node:http"
import { after, test } from "node:test"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { Hono } from "hono"
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose"

process.env.OPENWORK_DEV_MODE = "1"
process.env.DATABASE_URL = "mysql://root:password@127.0.0.1:3306/openwork_den"
process.env.DEN_DB_ENCRYPTION_KEY = "local-dev-db-encryption-key-please-change-1234567890"

type CapturedUpstreamRequest = {
  url: string
  authorization: string | undefined
  xApiKey: string | undefined
  contentType: string | undefined
  accept: string | undefined
  requestId: string | undefined
  body: string
}

const keyId = "inference-test-key"
const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
  crv: "Ed25519",
  extractable: true,
})
const publicJwk = await exportJWK(publicKey)
publicJwk.alg = "EdDSA"
publicJwk.kid = keyId
publicJwk.use = "sig"

const upstreamRequests: CapturedUpstreamRequest[] = []

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => {
      body += chunk
    })
    request.on("end", () => resolve(body))
    request.on("error", reject)
  })
}

function readHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value
}

const testServer = createServer(async (request, response) => {
  if (request.url === "/api/auth/jwks") {
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ keys: [publicJwk] }))
    return
  }

  if (request.url?.startsWith("/upstream/")) {
    upstreamRequests.push({
      url: request.url,
      authorization: request.headers.authorization,
      xApiKey: readHeader(request.headers["x-api-key"]),
      contentType: request.headers["content-type"],
      accept: request.headers.accept,
      requestId: readHeader(request.headers["x-openwork-request-id"]),
      body: await readRequestBody(request),
    })
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ ok: true }))
    return
  }

  response.statusCode = 404
  response.end()
})

await new Promise<void>((resolve, reject) => {
  testServer.once("error", reject)
  testServer.listen(0, "127.0.0.1", () => resolve())
})
const address = testServer.address()
if (!address || typeof address === "string") {
  throw new Error("Expected the JWT test server to listen on a TCP port")
}
const serverOrigin = `http://127.0.0.1:${address.port}`
const issuer = `${serverOrigin}/api/auth`
const claimNamespace = serverOrigin

process.env.DEN_JWT_ISSUER = issuer
delete process.env.DEN_JWKS_URL
delete process.env.DEN_CLAIM_NAMESPACE

const { registerByoRoutes } = await import("../src/byo.js")
const { verifyInferenceJwt } = await import("../src/den-jwt.js")

after(async () => {
  await new Promise<void>((resolve, reject) => {
    testServer.close((error) => error ? reject(error) : resolve())
  })
})

const organizationId = createDenTypeId("organization")
const otherOrganizationId = createDenTypeId("organization")
const orgMembershipId = createDenTypeId("member")
const userId = createDenTypeId("user")
const llmProviderId = createDenTypeId("llmProvider")
const teamId = createDenTypeId("team")

async function signInferenceToken(input: {
  organizationId?: string
  orgMembershipId?: string
  userId?: string
} = {}) {
  return new SignJWT({
    [`${claimNamespace}/token_use`]: "inference",
    [`${claimNamespace}/org_id`]: input.organizationId ?? organizationId,
    [`${claimNamespace}/org_membership_id`]: input.orgMembershipId ?? orgMembershipId,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: keyId })
    .setIssuer(issuer)
    .setAudience("openwork-inference")
    .setSubject(input.userId ?? userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey)
}

type TestAppOptions = {
  providerOrganizationId?: typeof organizationId
  upstreamBase?: string
  accessRows?: Array<{
    orgMembershipId: typeof orgMembershipId | null
    teamId: typeof teamId | null
  }>
  teamIds?: Array<typeof teamId>
  resolveHostname?: (hostname: string) => Promise<ReadonlyArray<{ address: string }>>
  fetch?: typeof fetch
}

function createTestApp(options: TestAppOptions = {}) {
  const app = new Hono()
  const checkedIdentities: Array<{
    organizationId: string
    orgMembershipId: string
    userId: string
  }> = []
  registerByoRoutes(app, {
    verifyJwt(token) {
      return verifyInferenceJwt(token, {
        async findActiveMembership(identity) {
          checkedIdentities.push(identity)
          return true
        },
      })
    },
    async findProvider(requestedProviderId) {
      if (requestedProviderId !== llmProviderId) return null
      return {
        id: llmProviderId,
        organizationId: options.providerOrganizationId ?? organizationId,
        providerId: "openai",
        providerConfig: {
          options: { baseURL: options.upstreamBase ?? `${serverOrigin}/upstream` },
        },
        apiKey: JSON.stringify({
          OPENAI_API_KEY: "organization-provider-key",
          SECONDARY_API_KEY: "secondary-provider-key",
        }),
      }
    },
    async listTeamIds() {
      return options.teamIds ?? []
    },
    async listProviderAccess() {
      return options.accessRows ?? [{ orgMembershipId: null, teamId: null }]
    },
    resolveHostname: options.resolveHostname ?? (async () => [{ address: "93.184.216.34" }]),
    fetch: options.fetch ?? fetch,
  })
  return { app, checkedIdentities }
}

async function requestByo(
  app: Hono,
  token: string,
  input: { method?: string; suffix?: string; body?: string } = {},
) {
  const headers = new Headers({
    authorization: `Bearer ${token}`,
    "x-api-key": "caller-key-that-must-not-be-forwarded",
    accept: "application/json",
  })
  if (input.body) headers.set("content-type", "application/json")
  return app.fetch(new Request(
    `http://openwork.test/api/v1/byo/${llmProviderId}${input.suffix ?? "/chat/completions"}`,
    {
      method: input.method ?? "POST",
      headers,
      body: input.body,
    },
  ))
}

async function readError(response: Response) {
  const payload: unknown = await response.json()
  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    throw new Error("Expected an OpenAI-style error response")
  }
  const error = payload.error
  if (typeof error !== "object" || error === null || !("code" in error)) {
    throw new Error("Expected an OpenAI-style error code")
  }
  return error
}

test("verifies Den JWT claims and forwards an org-wide BYO provider credential", async () => {
  upstreamRequests.length = 0
  const token = await signInferenceToken()
  const { app, checkedIdentities } = createTestApp()
  const body = JSON.stringify({ model: "organization/model", messages: [] })
  const response = await requestByo(app, token, { body })

  assert.equal(response.status, 200)
  assert.deepEqual(checkedIdentities, [{ organizationId, orgMembershipId, userId }])
  assert.equal(upstreamRequests.length, 1)
  const upstream = upstreamRequests[0]
  assert.ok(upstream)
  assert.equal(upstream.url, "/upstream/chat/completions")
  assert.equal(upstream.authorization, "Bearer organization-provider-key")
  assert.notEqual(upstream.authorization, `Bearer ${token}`)
  assert.equal(upstream.xApiKey, undefined)
  assert.equal(upstream.contentType, "application/json")
  assert.equal(upstream.accept, "application/json")
  assert.equal(upstream.body, body)
  assert.equal(response.headers.get("x-openwork-request-id"), upstream.requestId)
})

test("returns 403 when the provider belongs to another organization", async () => {
  upstreamRequests.length = 0
  const token = await signInferenceToken()
  const { app } = createTestApp({ providerOrganizationId: otherOrganizationId })
  const response = await requestByo(app, token, { body: "{}" })

  assert.equal(response.status, 403)
  assert.equal((await readError(response)).code, "provider_access_denied")
  assert.equal(upstreamRequests.length, 0)
})

test("returns 403 when the member has no provider access row", async () => {
  upstreamRequests.length = 0
  const token = await signInferenceToken()
  const { app } = createTestApp({ accessRows: [] })
  const response = await requestByo(app, token, { body: "{}" })

  assert.equal(response.status, 403)
  assert.equal((await readError(response)).code, "provider_access_denied")
  assert.equal(upstreamRequests.length, 0)
})

test("honors team-scoped provider access for GET /models", async () => {
  upstreamRequests.length = 0
  const token = await signInferenceToken()
  const { app } = createTestApp({
    teamIds: [teamId],
    accessRows: [{ orgMembershipId: null, teamId }],
  })
  const response = await requestByo(app, token, {
    method: "GET",
    suffix: "/models",
  })

  assert.equal(response.status, 200)
  assert.equal(upstreamRequests.length, 1)
  assert.equal(upstreamRequests[0]?.url, "/upstream/models")
})

for (const input of [
  { label: "loopback", upstreamBase: "https://127.0.0.1/v1" },
  { label: "cloud metadata", upstreamBase: "https://169.254.169.254/latest" },
  { label: "private 10.x", upstreamBase: "https://10.42.0.9/v1" },
  { label: "private 192.168.x", upstreamBase: "https://192.168.10.20/v1" },
  { label: "plain HTTP public host", upstreamBase: "http://93.184.216.34/v1" },
]) {
  test(`rejects a ${input.label} BYO upstream before fetch`, async () => {
    let fetchCalls = 0
    const token = await signInferenceToken()
    const { app } = createTestApp({
      upstreamBase: input.upstreamBase,
      async fetch() {
        fetchCalls += 1
        return Response.json({ ok: true })
      },
    })
    const response = await requestByo(app, token, { body: "{}" })

    assert.equal(response.status, 502)
    assert.equal((await readError(response)).code, "provider_upstream_unsafe")
    assert.equal(fetchCalls, 0)
  })
}

test("rejects a hostname that resolves to a blocked address", async () => {
  let fetchCalls = 0
  const token = await signInferenceToken()
  const { app } = createTestApp({
    upstreamBase: "https://provider.example/v1",
    async resolveHostname(hostname) {
      assert.equal(hostname, "provider.example")
      return [
        { address: "93.184.216.34" },
        { address: "10.0.0.8" },
      ]
    },
    async fetch() {
      fetchCalls += 1
      return Response.json({ ok: true })
    },
  })
  const response = await requestByo(app, token, { body: "{}" })

  assert.equal(response.status, 502)
  assert.equal((await readError(response)).code, "provider_upstream_unsafe")
  assert.equal(fetchCalls, 0)
})

test("allows a public HTTPS hostname that resolves only to public addresses", async () => {
  const fetchedUrls: string[] = []
  const token = await signInferenceToken()
  const { app } = createTestApp({
    upstreamBase: "https://provider.example/v1",
    async resolveHostname() {
      return [
        { address: "93.184.216.34" },
        { address: "2606:4700:4700::1111" },
      ]
    },
    async fetch(input) {
      fetchedUrls.push(String(input))
      return Response.json({ ok: true })
    },
  })
  const response = await requestByo(app, token, { body: "{}" })

  assert.equal(response.status, 200)
  assert.deepEqual(fetchedUrls, ["https://provider.example/v1/chat/completions"])
})

for (const input of [
  { method: "GET", suffix: "/chat/completions", status: 405, code: "method_not_allowed" },
  { method: "POST", suffix: "/models", status: 405, code: "method_not_allowed" },
  { method: "POST", suffix: "/responses", status: 404, code: "not_found" },
  { method: "GET", suffix: "", status: 404, code: "not_found" },
]) {
  test(`rejects unsupported BYO route ${input.method} ${input.suffix || "<provider root>"}`, async () => {
    upstreamRequests.length = 0
    const token = await signInferenceToken()
    const { app } = createTestApp()
    const response = await requestByo(app, token, input)

    assert.equal(response.status, input.status)
    assert.equal((await readError(response)).code, input.code)
    assert.equal(upstreamRequests.length, 0)
  })
}
