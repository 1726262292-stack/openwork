import { postDenScheduledTaskTick } from "@openwork/scheduled-tasks-den"

const DEFAULT_INTERVAL_MS = 60_000
const MIN_INTERVAL_MS = 1_000
const MAX_INTERVAL_MS = 15 * 60_000

type WakeEnv = Record<string, string | undefined>
type WakeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type DenScheduledTaskWakeConfig = {
  enabled: boolean
  baseUrl: string
  secret: string
  intervalMs: number
}

export type DenScheduledTaskWakeLogger = {
  info(message: string, attributes?: Record<string, unknown>): void
  warn(message: string, attributes?: Record<string, unknown>): void
}

export type DenScheduledTaskWakeHandle = { stop(): void }

function isEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "")
}

function resolveInterval(value: string | undefined): number {
  const parsed = Number(value?.trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MS
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.trunc(parsed)))
}

export function resolveDenScheduledTaskWakeConfig(
  env: WakeEnv = process.env,
): DenScheduledTaskWakeConfig {
  const port = env.PORT?.trim() || "8788"
  const baseUrl = env.DEN_SCHEDULED_TASKS_TICK_BASE_URL?.trim()
    || `http://127.0.0.1:${port}`
  const secret = env.DEN_SCHEDULED_TASKS_INTERNAL_SECRET?.trim() ?? ""
  return {
    enabled: isEnabled(env.DEN_SCHEDULED_TASKS_WAKE_ENABLED) && Boolean(secret),
    baseUrl,
    secret,
    intervalMs: resolveInterval(env.DEN_SCHEDULED_TASKS_WAKE_INTERVAL_MS),
  }
}

export async function runDenScheduledTaskWakeOnce(input: {
  config: DenScheduledTaskWakeConfig
  fetchImpl?: WakeFetch
  now?: () => number
  requestId?: () => string
}): Promise<boolean> {
  if (!input.config.enabled) return false
  await postDenScheduledTaskTick({
    baseUrl: input.config.baseUrl,
    secret: input.config.secret,
    source: "den-loop",
    fetchImpl: input.fetchImpl,
    now: input.now,
    requestId: input.requestId,
  })
  return true
}

export function startDenScheduledTaskWakeLoop(
  logger: DenScheduledTaskWakeLogger,
  options?: {
    env?: WakeEnv
    fetchImpl?: WakeFetch
    now?: () => number
    requestId?: () => string
  },
): DenScheduledTaskWakeHandle | null {
  const config = resolveDenScheduledTaskWakeConfig(options?.env)
  if (!config.enabled) return null
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  logger.info("Den Scheduled Tasks wake loop enabled", {
    intervalMs: config.intervalMs,
    baseUrl: config.baseUrl,
  })
  const cycle = async () => {
    try {
      await runDenScheduledTaskWakeOnce({
        config,
        fetchImpl: options?.fetchImpl,
        now: options?.now,
        requestId: options?.requestId,
      })
    } catch (error) {
      logger.warn("Den Scheduled Tasks tick failed", {
        error: error instanceof Error ? error.message : "unknown_error",
      })
    } finally {
      if (!stopped) timer = setTimeout(() => void cycle(), config.intervalMs)
    }
  }
  void cycle()
  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
