import "./load-env.js"
import { runWithDbRoutingContext } from "@openwork-ee/den-db"
import { sql } from "@openwork-ee/den-db/drizzle"
import { db, readDb } from "@openwork-ee/den-core/db"
import { env } from "@openwork-ee/den-core/env"
import { registerAgentMcpRoutes } from "@openwork-ee/den-core/mcp/agent"
import { registerExternalConnectionProxyRoutes } from "@openwork-ee/den-core/mcp/external-connection-proxy"
import { getSnapshotCatalog } from "@openwork-ee/den-core/mcp/index"
import { publicRoute } from "@openwork-ee/den-core/middleware/index"
import { createRequestAccessLogMiddleware, createTelemetryErrorSanitizerMiddleware, registerAppErrorHandler, registerObservabilityMiddleware } from "@openwork-ee/den-core/observability/hono"
import { appLogger } from "@openwork-ee/den-core/observability/logger"
import { isOperationalErrorPath, normalizeOperationalErrorResponse, operationalErrorResponse } from "@openwork-ee/den-core/operational-errors"
import { sanitizePublicResponseHeaders } from "@openwork-ee/den-core/public-response-headers"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { cors } from "hono/cors"
import { Hono } from "hono"
import type { RequestIdVariables } from "hono/request-id"
import { requestId } from "hono/request-id"

type AppVariables = RequestIdVariables & Record<string, unknown>
type ReadinessCheck = () => Promise<unknown>
type RunInDbRoutingContext = (fn: () => Promise<void>) => Promise<void>

export type CloudMcpAppOptions = {
  checkPrimary?: ReadinessCheck
  checkReplica?: ReadinessCheck
  runInDbRoutingContext?: RunInDbRoutingContext
}

const strictTransportSecurityHeader = "max-age=31536000; includeSubDomains"

function readinessStatus(result: PromiseSettledResult<unknown>): "ok" | "error" {
  return result.status === "fulfilled" ? "ok" : "error"
}

export function createCloudMcpApp(options: CloudMcpAppOptions = {}) {
  const app = new Hono<{ Variables: AppVariables }>()
  const checkPrimary = options.checkPrimary ?? (async () => {
    await db.execute(sql.raw("select 1 for update"))
  })
  const checkReplica = options.checkReplica ?? (async () => {
    await readDb.execute(sql.raw("select 1"))
  })
  const runInDbRoutingContext = options.runInDbRoutingContext ?? runWithDbRoutingContext

  registerObservabilityMiddleware(app)
  app.use("*", (_c, next) => runInDbRoutingContext(next))
  app.use("*", requestId({
    headerName: "",
    generator: () => createDenTypeId("request"),
  }))
  app.use("*", async (c, next) => {
    await next()
    sanitizePublicResponseHeaders(c.res.headers)
  })
  app.use("*", async (c, next) => {
    await next()
    c.header("X-Content-Type-Options", "nosniff")
    c.header("Strict-Transport-Security", strictTransportSecurityHeader)
  })
  app.use("*", createTelemetryErrorSanitizerMiddleware())
  app.use("*", async (c, next) => {
    await next()
    c.res = await normalizeOperationalErrorResponse(c.req.path, c.res, c.get("requestId"))
  })
  app.use("*", createRequestAccessLogMiddleware())
  registerAppErrorHandler(app, (error, c, requestIdValue) => {
    if (!isOperationalErrorPath(c.req.path)) {
      return undefined
    }
    return operationalErrorResponse(error, c, requestIdValue)
  })

  if (env.corsOrigins.length > 0) {
    app.use(
      "*",
      cors({
        origin: env.corsOrigins,
        credentials: true,
        allowHeaders: ["Content-Type", "Authorization", "X-Api-Key", "X-Request-Id", "X-OpenWork-Legacy-Org-Id", "X-OpenWork-Org-Id"],
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        exposeHeaders: ["Content-Length"],
        maxAge: 600,
      }),
    )
  }

  app.get("/health", publicRoute, (c) => {
    return c.json({ ok: true, service: "cloud-mcp", version: env.serviceVersion })
  })

  app.get("/ready", publicRoute, async (c) => {
    const [primaryResult, replicaResult] = await Promise.allSettled([
      checkPrimary(),
      checkReplica(),
    ])
    const checks = {
      primary: readinessStatus(primaryResult),
      replica: readinessStatus(replicaResult),
    }

    if (primaryResult.status === "rejected") {
      appLogger.error("readiness database check failed", { component: "readiness", database: "primary", error: primaryResult.reason })
    }
    if (replicaResult.status === "rejected") {
      appLogger.error("readiness database check failed", { component: "readiness", database: "replica", error: replicaResult.reason })
    }
    if (checks.primary === "error" || checks.replica === "error") {
      return c.json({ ok: false, service: "cloud-mcp", checks }, 503)
    }
    return c.json({ ok: true, service: "cloud-mcp", checks })
  })

  registerAgentMcpRoutes(app, { catalogSource: getSnapshotCatalog })
  registerExternalConnectionProxyRoutes(app)

  app.notFound((c) => c.json({ error: "not_found" }, 404))

  return app
}

const app = createCloudMcpApp()

export default app
