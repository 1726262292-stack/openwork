import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { Hono, type MiddlewareHandler } from "hono"
import type { OrgRouteVariables } from "../src/routes/org/shared.js"

const API_ORIGIN = "http://127.0.0.1:8790"

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test_pluginapps"
process.env.DB_MODE ??= "mysql"
process.env.DEN_DB_ENCRYPTION_KEY ??= "route-gate-test-encryption-key-1234567890"
process.env.BETTER_AUTH_SECRET ??= "route-gate-test-secret-123456789012"
process.env.BETTER_AUTH_URL ??= API_ORIGIN
process.env.CORS_ORIGINS ??= API_ORIGIN

let app: Hono<{ Variables: OrgRouteVariables }>
let organizationMetadata: Record<string, unknown> | null = null

function organizationContext() {
  return {
    organization: {
      id: "org_01k28e8q8pf8r9sff9mhyqxved",
      name: "Route Gate Test",
      slug: "route-gate-test",
      logo: null,
      allowedEmailDomains: null,
      metadata: organizationMetadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    currentMember: {
      id: "mem_01k28e8q8pf8r9sff9mhyqxved",
      userId: "usr_01k28e8q8pf8r9sff9mhyqxved",
      role: "admin",
      createdAt: new Date(),
      joinedAt: new Date(),
      isOwner: true,
    },
    invitations: [],
    members: [],
    roles: [],
    teams: [],
  }
}

beforeAll(async () => {
  mock.restore()
  const middleware = await import("../src/middleware/index.js")
  const passThroughMiddleware: MiddlewareHandler = async (_c, next) => {
    await next()
  }
  mock.module("../src/middleware/index.js", () => ({
    ...middleware,
    orgMemberRoute: () => passThroughMiddleware,
    resolveMemberTeamsMiddleware: passThroughMiddleware,
  }))
  const { registerRemoteMcpAppRoutes } = await import("../src/routes/org/remote-mcp-apps.js")
  app = new Hono<{ Variables: OrgRouteVariables }>()
  app.use("*", async (c, next) => {
    c.set("organizationContext", organizationContext() as never)
    c.set("memberTeams", [])
    await next()
  })
  registerRemoteMcpAppRoutes(app)
})

afterAll(() => {
  mock.restore()
})

async function post(path: string, body: Record<string, unknown>) {
  return app.fetch(new Request(`${API_ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }))
}

test("every installed-App route fails closed while the organization gate is off", async () => {
  // The deployment gate is not set in this process, so even an org opt-in
  // stays off; also probe the explicit org-off state.
  for (const metadata of [null, { capabilities: { pluginMcpApps: true } }, { capabilities: { pluginMcpApps: false } }]) {
    organizationMetadata = metadata

    const preview = await post("/v1/remote-mcp-apps/preview", { sourceUrl: "https://apps.example/app.html" })
    expect(preview.status).toBe(404)
    expect(await preview.json()).toMatchObject({ error: "plugin_mcp_apps_disabled" })

    const importResponse = await post("/v1/remote-mcp-apps", {
      sourceUrl: "https://apps.example/app.html",
      pluginId: "plg_01k28e8q8pf8r9sff9mhyqxved",
    })
    expect(importResponse.status).toBe(404)
    expect(await importResponse.json()).toMatchObject({ error: "plugin_mcp_apps_disabled" })

    const detail = await app.fetch(new Request(`${API_ORIGIN}/v1/remote-mcp-apps/cob_01k28e8q8pf8r9sff9mhyqxved`))
    expect(detail.status).toBe(404)
    expect(await detail.json()).toMatchObject({ error: "plugin_mcp_apps_disabled" })

    const refresh = await post("/v1/remote-mcp-apps/cob_01k28e8q8pf8r9sff9mhyqxved/refresh", {})
    expect(refresh.status).toBe(404)

    const lifecycle = await post("/v1/remote-mcp-apps/cob_01k28e8q8pf8r9sff9mhyqxved/lifecycle", { action: "retire" })
    expect(lifecycle.status).toBe(404)

    const download = await app.fetch(new Request(
      `${API_ORIGIN}/v1/remote-mcp-apps/cob_01k28e8q8pf8r9sff9mhyqxved/revisions/cov_01k28e8q8pf8r9sff9mhyqxved/download`,
    ))
    expect(download.status).toBe(404)
  }
})

test("installation requires an explicit owning plugin id", async () => {
  organizationMetadata = { capabilities: { pluginMcpApps: true } }
  const missingPlugin = await post("/v1/remote-mcp-apps", { sourceUrl: "https://apps.example/app.html" })
  // Schema validation rejects the body before any gate or download work.
  expect(missingPlugin.status).toBe(400)
})
