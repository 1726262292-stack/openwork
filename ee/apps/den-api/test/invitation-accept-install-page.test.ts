import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { beforeAll, beforeEach, expect, mock, test } from "bun:test"
import { Hono } from "hono"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.DEN_INSTALL_LINKS_GATING_ENABLED = "true"
}

const userId = createDenTypeId("user")
const sessionId = createDenTypeId("session")
const organizationId = createDenTypeId("organization")
const invitationId = createDenTypeId("invitation")
const insertedRows: unknown[] = []

mock.module("../src/db.js", () => ({
  db: {
    insert: (_table: unknown) => ({
      values: (values: unknown) => {
        insertedRows.push(values)
        return Promise.resolve()
      },
    }),
    select: (_selection: unknown) => ({
      from: (_table: unknown) => ({
        where: (_condition: unknown) => ({
          limit: (_count: number) => Promise.resolve([{ slug: "acme-robotics", metadata: { capabilities: { installLinks: true } } }]),
        }),
      }),
    }),
  },
}))

mock.module("../src/auth.js", () => ({
  auth: {
    api: {
      setActiveOrganization: () => Promise.resolve(),
    },
  },
}))

class TestOrganizationEmailDomainRestrictionError extends Error {
  readonly emailDomain = null
  readonly allowedEmailDomains: string[] = []
}

mock.module("../src/orgs.js", () => ({
  OrganizationEmailDomainRestrictionError: TestOrganizationEmailDomainRestrictionError,
  acceptInvitationForUser: () => Promise.resolve({
    invitation: { id: invitationId },
    member: { organizationId },
  }),
  createOrganizationForUser: () => Promise.resolve(organizationId),
  getInvitationPreview: () => Promise.resolve(null),
  getSingletonSsoStatus: () => Promise.resolve({ configured: false, organizationSlug: "", signInPath: "/" }),
  normalizeAllowedEmailDomains: () => ({ domains: null, invalidDomains: [] }),
  setSessionActiveOrganization: () => Promise.resolve(),
  updateOrganizationSettings: () => Promise.resolve(null),
}))

let coreModule: typeof import("../src/routes/org/core.js")
let installLinksModule: typeof import("../src/install-links.js")

beforeAll(async () => {
  seedRequiredEnv()
  coreModule = await import("../src/routes/org/core.js")
  installLinksModule = await import("../src/install-links.js")
})

beforeEach(() => {
  insertedRows.length = 0
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function createApp() {
  const app = new Hono()
  app.use("*", async (c, next) => {
    c.set("apiKey", null)
    c.set("user", {
      id: userId,
      email: "agent@acme.test",
      emailVerified: true,
      name: "Agent",
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    c.set("session", {
      id: sessionId,
      activeOrganizationId: null,
      createdAt: new Date(),
    })
    await next()
  })
  coreModule.registerOrgCoreRoutes(app)
  return app
}

test("accepting an invitation returns an organization install page URL", async () => {
  const response = await createApp().request("http://den.local/v1/orgs/invitations/accept", {
    body: JSON.stringify({ id: invitationId }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })

  expect(response.status).toBe(200)
  const payload = await response.json()
  expect(payload).toMatchObject({
    accepted: true,
    organizationId,
    organizationSlug: "acme-robotics",
    invitationId,
  })

  const installPageUrl = isRecord(payload) && typeof payload.installPageUrl === "string" ? payload.installPageUrl : ""
  const url = new URL(installPageUrl)
  const token = url.searchParams.get("token") ?? ""
  const installLinkRow = insertedRows.find((row) => isRecord(row) && typeof row.tokenHash === "string")

  expect(url.pathname).toBe("/install")
  expect(token).toBeTruthy()
  expect(installLinkRow).not.toHaveProperty("token")
  expect(installLinkRow).not.toHaveProperty("installPageUrl")
  expect(isRecord(installLinkRow) ? installLinkRow.tokenHash : null).toBe(installLinksModule.hashInstallLinkToken(token))
})
