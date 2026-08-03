import { startDenScheduledTaskWakeLoop } from "./wake-loop.js"

const logger = {
  info(message: string, attributes?: Record<string, unknown>) {
    console.info(message, attributes ?? {})
  },
  warn(message: string, attributes?: Record<string, unknown>) {
    console.warn(message, attributes ?? {})
  },
}

const handle = startDenScheduledTaskWakeLoop(logger)
if (!handle) {
  logger.warn("Den Scheduled Tasks wake loop is disabled or missing its internal secret")
  process.exit(1)
}

const shutdown = () => {
  handle.stop()
  process.exit(0)
}

process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
