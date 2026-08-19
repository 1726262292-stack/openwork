import { beforeAll, expect, test } from "bun:test"
import { DEN_MCP_ACCESS_TOKEN_EXPIRES_IN_SECONDS } from "@openwork-ee/den-core/mcp/token-lifetime"
import {
  DEN_JWKS_GRACE_PERIOD_SECONDS,
  DEN_JWKS_ROTATION_INTERVAL_SECONDS,
  DEN_JWT_KEY_CURVE,
  DEN_JWT_SIGNING_ALGORITHM,
  getDenAuthIssuer,
  getDenJwtOptions,
} from "@openwork-ee/den-core/mcp/jwt-policy"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
}

let mcpAuth: typeof import("@openwork-ee/den-core/mcp/auth")
let mcpRoutes: typeof import("@openwork-ee/den-core/mcp/index")

beforeAll(async () => {
  seedRequiredEnv()
  ;[mcpAuth, mcpRoutes] = await Promise.all([
    import("@openwork-ee/den-core/mcp/auth"),
    import("@openwork-ee/den-core/mcp/index"),
  ])
})

test("MCP resource metadata requests an offline refresh grant", () => {
  expect(mcpRoutes.protectedResourceMetadata(new Request("http://127.0.0.1:8790/mcp"))).toMatchObject({
    authorization_servers: [getDenAuthIssuer("http://127.0.0.1:8790")],
    scopes_supported: ["mcp:read", "mcp:write", "offline_access"],
  })
})

test("MCP JWT verification pins issuer, audience, and signing algorithm", () => {
  expect(mcpAuth.getMcpJwtVerifyOptions()).toEqual({
    issuer: getDenAuthIssuer("http://127.0.0.1:8790"),
    audience: "http://127.0.0.1:8790/mcp/agent",
    algorithms: [DEN_JWT_SIGNING_ALGORITHM],
  })
})

test("Den JWT keys pin EdDSA and retain rotated keys during the MCP token lifetime", () => {
  expect(getDenJwtOptions({ issuer: "https://api.openworklabs.com/api/auth" })).toEqual({
    jwt: {
      issuer: "https://api.openworklabs.com/api/auth",
    },
    jwks: {
      keyPairConfig: {
        alg: DEN_JWT_SIGNING_ALGORITHM,
        crv: DEN_JWT_KEY_CURVE,
      },
      rotationInterval: DEN_JWKS_ROTATION_INTERVAL_SECONDS,
      gracePeriod: DEN_JWKS_GRACE_PERIOD_SECONDS,
    },
  })
  expect(DEN_JWKS_ROTATION_INTERVAL_SECONDS).toBe(24 * 60 * 60)
  expect(DEN_JWKS_GRACE_PERIOD_SECONDS).toBeGreaterThan(DEN_MCP_ACCESS_TOKEN_EXPIRES_IN_SECONDS)
})
