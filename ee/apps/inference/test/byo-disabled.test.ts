import assert from "node:assert/strict"
import { test } from "node:test"
import { Hono } from "hono"

process.env.OPENWORK_DEV_MODE = "1"
process.env.DATABASE_URL = "mysql://root:password@127.0.0.1:3306/openwork_den"
process.env.DEN_DB_ENCRYPTION_KEY = "local-dev-db-encryption-key-please-change-1234567890"
delete process.env.DEN_JWT_ISSUER
delete process.env.DEN_JWKS_URL
delete process.env.DEN_CLAIM_NAMESPACE

const { registerByoRoutes } = await import("../src/byo.js")
const { verifyInferenceJwt } = await import("../src/den-jwt.js")

test("rejects BYO inference JWTs when Den JWT environment is unset", async () => {
  const app = new Hono()
  registerByoRoutes(app, {
    verifyJwt: verifyInferenceJwt,
    async findProvider() {
      throw new Error("Provider lookup must not run when JWT auth is disabled")
    },
    async listTeamIds() {
      throw new Error("Team lookup must not run when JWT auth is disabled")
    },
    async listProviderAccess() {
      throw new Error("Access lookup must not run when JWT auth is disabled")
    },
    async fetch() {
      throw new Error("Upstream fetch must not run when JWT auth is disabled")
    },
  })

  const response = await app.fetch(new Request(
    "http://openwork.test/api/v1/byo/lpr_test/chat/completions",
    { method: "POST", headers: { authorization: "Bearer signed-token" } },
  ))

  assert.equal(response.status, 401)
  const payload: unknown = await response.json()
  assert.deepEqual(payload, {
    error: {
      message: "Invalid OpenWork inference bearer token.",
      type: "authentication_error",
      code: "invalid_api_key",
    },
  })
})
