import { beforeAll, expect, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "local-dev-db-encryption-key-please-change-1234567890"
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "local-dev-secret-not-for-production-use!!"
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
}

let telegramModule: typeof import("../src/routes/org/telegram.js")

beforeAll(async () => {
  seedRequiredEnv()
  telegramModule = await import("../src/routes/org/telegram.js")
})

function routeContext(input: { role: string; isOwner?: boolean; createdAt?: Date }) {
  return {
    get(key: "organizationContext" | "session") {
      if (key === "session") {
        return { createdAt: input.createdAt ?? new Date() }
      }
      return {
        currentMember: {
          isOwner: input.isOwner === true,
          role: input.role,
        },
      }
    },
  }
}

test("Telegram connection reads allow stale organization admins", () => {
  const staleSession = new Date(Date.now() - 60 * 60 * 1000)

  expect(telegramModule.telegramConnectionReadAccess(routeContext({ role: "admin", createdAt: staleSession }))).toEqual({ ok: true })
})

test("Telegram connection reads forbid non-admin members", () => {
  expect(telegramModule.telegramConnectionReadAccess(routeContext({ role: "member" }))).toEqual({
    ok: false,
    response: {
      error: "forbidden",
      message: "Only workspace owners and admins can manage Telegram.",
    },
  })
})

test("Telegram management mutations still require a fresh privileged session", () => {
  const staleSession = new Date(Date.now() - 60 * 60 * 1000)
  const sensitiveRoutes = [
    "PUT /v1/telegram/connection",
    "POST /v1/telegram/connection/pairing",
    "DELETE /v1/telegram/connection",
  ]

  for (const route of sensitiveRoutes) {
    expect({
      route,
      access: telegramModule.telegramConnectionManagementAccess(routeContext({ role: "admin", createdAt: staleSession })),
    }).toEqual({
      route,
      access: {
        ok: false,
        response: {
          error: "reauth",
          reason: "fresh_auth_required",
          message: "For security, confirm it's you before changing workspace settings.",
        },
      },
    })
  }

  expect(telegramModule.telegramConnectionManagementAccess(routeContext({ role: "admin" }))).toEqual({ ok: true })
})
