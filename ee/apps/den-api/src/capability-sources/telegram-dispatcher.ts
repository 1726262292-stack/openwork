import {
  claimNextTelegramUpdate,
  retryTelegramUpdate,
  setTelegramUpdateStatus,
  type TelegramUpdateRow,
} from "./telegram-store.js"

const DISPATCH_INTERVAL_MS = 2_000
const MAX_UPDATES_PER_DRAIN = 20
const DISPATCH_CONCURRENCY = 4

type TelegramUpdateProcessor = (update: TelegramUpdateRow) => Promise<void>

let processor: TelegramUpdateProcessor | null = null
let drainPromise: Promise<void> | null = null
let interval: ReturnType<typeof setInterval> | null = null

export class RetryableTelegramUpdateError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error))
    this.name = "RetryableTelegramUpdateError"
  }
}

export function setTelegramUpdateProcessor(next: TelegramUpdateProcessor) {
  processor = next
}

async function drainTelegramLane(limit: number, activeProcessor: TelegramUpdateProcessor) {
  for (let index = 0; index < limit; index += 1) {
    const update = await claimNextTelegramUpdate()
    if (!update) return
    try {
      await activeProcessor(update)
    } catch (error) {
      if (!update.processingToken) continue
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof RetryableTelegramUpdateError) {
        await retryTelegramUpdate({
          connectionId: update.connectionId,
          error: message,
          id: update.id,
          processingToken: update.processingToken,
        })
      } else {
        await setTelegramUpdateStatus({
          connectionId: update.connectionId,
          error: message,
          id: update.id,
          processingToken: update.processingToken,
          status: "failed",
        })
      }
    }
  }
}

async function drainTelegramUpdates() {
  const activeProcessor = processor
  if (!activeProcessor) return
  const laneLimit = Math.ceil(MAX_UPDATES_PER_DRAIN / DISPATCH_CONCURRENCY)
  await Promise.all(
    Array.from({ length: DISPATCH_CONCURRENCY }, () => drainTelegramLane(laneLimit, activeProcessor)),
  )
}

export function triggerTelegramUpdateDispatcher() {
  if (drainPromise) return
  drainPromise = drainTelegramUpdates().finally(() => {
    drainPromise = null
  })
  void drainPromise.catch((error) => {
    console.error("[telegram] update dispatcher failed", error)
  })
}

export function startTelegramUpdateDispatcher() {
  if (interval) return
  triggerTelegramUpdateDispatcher()
  interval = setInterval(triggerTelegramUpdateDispatcher, DISPATCH_INTERVAL_MS)
  interval.unref()
}
