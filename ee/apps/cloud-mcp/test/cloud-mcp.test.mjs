import { expect, mock, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const publicOrigin = "https://api.openworklabs.com"
const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

Object.assign(process.env, {
  DATABASE_URL: "mysql://root:password@127.0.0.1:3306/openwork_test",
  DATABASE_REPLICA_URL: "mysql://root:password@127.0.0.1:3307/openwork_test",
  DB_MODE: "mysql",
  DEN_DB_ENCRYPTION_KEY: "x".repeat(32),
  BETTER_AUTH_SECRET: "y".repeat(32),
  BETTER_AUTH_URL: "https://app.openworklabs.com",
  DEN_MCP_RESOURCE_URL: `${publicOrigin}/mcp`,
  DEN_API_PUBLIC_URL: publicOrigin,
  DEN_DB_ROUTING_SERVICE: "cloud-mcp",
  CORS_ORIGINS: "",
  OPENWORK_DEV_MODE: "0",
})

const authConstants = await import("@openwork-ee/den-core/mcp/auth-constants")
mock.module("@openwork-ee/den-core/auth", () => ({
  ...authConstants,
  auth: {
    api: {},
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
  },
}))

const [{ default: cloudMcpApp, createCloudMcpApp }, { default: denApiApp }] = await Promise.all([
  import("../src/app.ts"),
  import("../../den-api/src/app.ts"),
])

for (const discoveryPath of [
  "/.well-known/oauth-protected-resource/mcp/agent",
  "/mcp/agent/.well-known/oauth-protected-resource",
]) {
  test(`${discoveryPath} is byte-identical to den-api`, async () => {
    const [cloudResponse, denApiResponse] = await Promise.all([
      cloudMcpApp.request(`${publicOrigin}${discoveryPath}`),
      denApiApp.request(`${publicOrigin}${discoveryPath}`),
    ])

    expect(cloudResponse.status).toBe(200)
    expect(cloudResponse.status).toBe(denApiResponse.status)
    expect(cloudResponse.headers.get("content-type")).toBe(denApiResponse.headers.get("content-type"))
    expect(await cloudResponse.text()).toBe(await denApiResponse.text())
  })
}

test("unauthenticated /mcp/agent matches den-api's OAuth challenge", async () => {
  const [cloudResponse, denApiResponse] = await Promise.all([
    cloudMcpApp.request(`${publicOrigin}/mcp/agent`, { method: "POST" }),
    denApiApp.request(`${publicOrigin}/mcp/agent`, { method: "POST" }),
  ])

  expect(cloudResponse.status).toBe(401)
  expect(cloudResponse.status).toBe(denApiResponse.status)
  const challenge = cloudResponse.headers.get("www-authenticate")
  expect(challenge).toBe(denApiResponse.headers.get("www-authenticate"))
  expect(challenge).toContain(`resource_metadata="${publicOrigin}/.well-known/oauth-protected-resource/mcp/agent"`)
  expect(challenge).toContain('scope="mcp:read mcp:write offline_access"')
  expect(await cloudResponse.json()).toMatchObject({
    error: "missing_mcp_token",
    referenceId: expect.any(String),
  })
  expect(cloudResponse.headers.get("x-request-id")).toBeNull()
})

test("health is dependency-free and every request enters a DB routing context", async () => {
  let primaryChecks = 0
  let replicaChecks = 0
  let routingContexts = 0
  const app = createCloudMcpApp({
    checkPrimary: async () => {
      primaryChecks += 1
    },
    checkReplica: async () => {
      replicaChecks += 1
    },
    runInDbRoutingContext: async (fn) => {
      routingContexts += 1
      await fn()
    },
  })

  const response = await app.request(`${publicOrigin}/health`)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ ok: true, service: "cloud-mcp" })
  expect(primaryChecks).toBe(0)
  expect(replicaChecks).toBe(0)
  expect(routingContexts).toBe(1)
})

test("readiness checks both databases and identifies a failed primary", async () => {
  let replicaChecks = 0
  const app = createCloudMcpApp({
    checkPrimary: async () => {
      throw new Error("primary unavailable")
    },
    checkReplica: async () => {
      replicaChecks += 1
    },
  })

  const response = await app.request(`${publicOrigin}/ready`)
  expect(response.status).toBe(503)
  expect(replicaChecks).toBe(1)
  expect(await response.json()).toEqual({
    ok: false,
    service: "cloud-mcp",
    checks: { primary: "error", replica: "ok" },
  })
})

test("authenticated malformed JSON-RPC is rejected before the transport", () => {
  const appUrl = pathToFileURL(path.join(serviceRoot, "src/app.ts")).href
  const script = `
const { mock } = await import("bun:test")
const publicOrigin = ${JSON.stringify(publicOrigin)}

mock.module("@openwork-ee/den-core/mcp/auth", () => ({
  getMcpResourceContext: (_request, route, requestId) => ({
    route,
    resourceUrl: publicOrigin + "/mcp/agent",
    metadataUrl: publicOrigin + "/.well-known/oauth-protected-resource/mcp/agent",
    oauthResources: [publicOrigin + "/mcp/agent"],
    firstPartyResources: [publicOrigin + "/mcp/agent"],
    requestId,
  }),
  verifyMcpRequest: async () => ({
    userId: "usr_test",
    organizationId: "org_test",
    scopes: new Set(["mcp:read", "mcp:write"]),
    payload: {},
  }),
  hasActiveMcpSession: async () => true,
}))

const { default: app } = await import(${JSON.stringify(appUrl)})
const cases = [
  { body: "{", code: -32700 },
  { body: JSON.stringify({ jsonrpc: "2.0", id: 1, params: {} }), code: -32600 },
]
for (const entry of cases) {
  const response = await app.request(publicOrigin + "/mcp/agent", {
    method: "POST",
    headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: entry.body,
  })
  const body = await response.json()
  if (response.status !== 400 || body.error?.code !== entry.code || typeof body.error?.data?.referenceId !== "string") {
    throw new Error("Unexpected preflight response: " + JSON.stringify({ status: response.status, body }))
  }
}
console.log("cloud-mcp-preflight-ok")
`
  const result = spawnSync(process.execPath, ["--conditions", "development", "--eval", script], {
    cwd: serviceRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      TMPDIR: process.env.TMPDIR ?? "",
      DATABASE_URL: "mysql://root:password@127.0.0.1:3306/openwork_test",
      DATABASE_REPLICA_URL: "mysql://root:password@127.0.0.1:3307/openwork_test",
      DB_MODE: "mysql",
      DEN_DB_ENCRYPTION_KEY: "x".repeat(32),
      BETTER_AUTH_SECRET: "y".repeat(32),
      BETTER_AUTH_URL: "https://app.openworklabs.com",
      DEN_MCP_RESOURCE_URL: `${publicOrigin}/mcp`,
      DEN_API_PUBLIC_URL: publicOrigin,
      DEN_DB_ROUTING_SERVICE: "cloud-mcp",
      CORS_ORIGINS: "",
      OPENWORK_DEV_MODE: "0",
    },
  })

  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("cloud-mcp-preflight-ok")
})
