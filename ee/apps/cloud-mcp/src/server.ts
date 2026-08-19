import "./load-env.js"
import { serve } from "@hono/node-server"
import { initializeObservability, shutdownObservability } from "@openwork-ee/den-core/observability/runtime"

await initializeObservability()

const [{ default: app }, { env }, { appLogger }] = await Promise.all([
  import("./app.js"),
  import("./env.js"),
  import("@openwork-ee/den-core/observability/logger"),
])

const bindHost = process.env.DEN_BIND_HOST?.trim()
const server = serve({ fetch: app.fetch, port: env.port, ...(bindHost ? { hostname: bindHost } : {}) }, (info) => {
  appLogger.info("server listening", { component: "server", port: info.port })
})

let shuttingDown = false
const SERVER_CLOSE_TIMEOUT_MS = 3_000
const OBSERVABILITY_SHUTDOWN_TIMEOUT_MS = 2_500

type CloseAllConnectionsServer = {
  closeAllConnections: () => void
}

function canCloseAllConnections(value: object): value is CloseAllConnectionsServer {
  return "closeAllConnections" in value && typeof value.closeAllConnections === "function"
}

function withTimeout<T>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    timer.unref()
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function closeServer() {
  const closePromise = new Promise<void>((resolve) => {
    server.close(() => resolve())
  })

  try {
    await withTimeout("server close", closePromise, SERVER_CLOSE_TIMEOUT_MS)
  } catch (error) {
    appLogger.warn("server close did not finish before timeout", { component: "server", error })
    if (canCloseAllConnections(server)) server.closeAllConnections()
    await withTimeout("server force close", closePromise, 1_000).catch((forceError) => {
      appLogger.error("server force close did not finish", { component: "server", error: forceError })
    })
  }
}

async function shutdown(signal: "SIGTERM" | "SIGINT") {
  if (shuttingDown) {
    appLogger.warn("second shutdown signal received", { component: "server", signal })
    process.exit(1)
  }
  shuttingDown = true

  appLogger.info("shutdown requested", { component: "server", signal })
  await closeServer()
  await withTimeout("observability shutdown", shutdownObservability(), OBSERVABILITY_SHUTDOWN_TIMEOUT_MS).catch((error) => {
    appLogger.error("observability shutdown failed", { component: "server", error })
  })
}

function registerShutdownSignal(signal: "SIGTERM" | "SIGINT") {
  process.on(signal, () => {
    void shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        appLogger.error("shutdown failed", { component: "server", error })
        process.exit(1)
      })
  })
}

registerShutdownSignal("SIGTERM")
registerShutdownSignal("SIGINT")
