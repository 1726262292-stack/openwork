import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { beforeAll, describe, expect, test } from "bun:test"
import { Hono, type MiddlewareHandler } from "hono"
import type { OrganizationContext } from "../src/orgs.js"
import type { OrgRouteVariables } from "../src/routes/org/shared.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
  process.env.PROVISIONER_MODE = "stub"
}

let routes: typeof import("../src/routes/cloud/index.js")

beforeAll(async () => {
  seedRequiredEnv()
  routes = await import("../src/routes/cloud/index.js")
})

function organizationContext(metadata: string | null): OrganizationContext {
  const now = new Date("2026-07-25T00:00:00Z")
  return {
    organization: {
      id: createDenTypeId("organization"),
      name: "Cloud Instance Test",
      slug: `cloud-instance-${crypto.randomUUID()}`,
      logo: null,
      allowedEmailDomains: null,
      metadata,
      createdAt: now,
      updatedAt: now,
    },
    currentMember: {
      id: createDenTypeId("member"),
      userId: createDenTypeId("user"),
      role: "member",
      createdAt: now,
      joinedAt: now,
      isOwner: false,
    },
    members: [],
    invitations: [],
    roles: [],
    teams: [],
  }
}

function contextMiddleware(context: OrganizationContext): MiddlewareHandler<{ Variables: OrgRouteVariables }> {
  return async (c, next) => {
    c.set("organizationContext", context)
    await next()
  }
}

describe("Cloud instance route gate", () => {
  test("returns 404 when the Cloud capability is off", async () => {
    const app = new Hono<{ Variables: OrgRouteVariables }>()
    routes.registerCloudRoutes(app, {
      memberRoute: contextMiddleware(organizationContext(null)),
      orgMode: "multi_org",
      provisionerMode: "daytona",
      daytonaApiKey: "daytona-test-key",
    })

    const response = await app.request("http://den.local/v1/cloud/instance")

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "cloud_not_found" })
  })

  test("returns 404 in single-org mode even with a literal Cloud opt-in", async () => {
    const app = new Hono<{ Variables: OrgRouteVariables }>()
    routes.registerCloudRoutes(app, {
      memberRoute: contextMiddleware(organizationContext(JSON.stringify({ capabilities: { cloud: true } }))),
      orgMode: "single_org",
      provisionerMode: "daytona",
      daytonaApiKey: "daytona-test-key",
    })

    const response = await app.request("http://den.local/v1/cloud/instance")

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "cloud_not_found" })
  })

  test("returns 404 when Daytona provisioning is not configured", async () => {
    const app = new Hono<{ Variables: OrgRouteVariables }>()
    routes.registerCloudRoutes(app, {
      memberRoute: contextMiddleware(organizationContext(JSON.stringify({ capabilities: { cloud: true } }))),
      orgMode: "multi_org",
      provisionerMode: "stub",
    })

    const response = await app.request("http://den.local/v1/cloud/instance")

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "cloud_not_found" })
  })
})
