import type { ScheduledTaskTickInput } from "@openwork/scheduled-tasks"

export const DEN_SCHEDULED_TASK_TICK_PATH = "/internal/scheduled-tasks/tick"

export interface DenScheduledTaskTickHeaders extends Record<string, string> {
  "Content-Type": "application/json"
  "X-Den-Scheduler-Timestamp": string
  "X-Den-Scheduler-Request-Id": string
  "X-Den-Scheduler-Signature": string
}

export interface DenScheduledTaskTickWakeResult {
  requestId: string
  status: number
  result: unknown
}

type TickFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  )
  return bytesToHex(new Uint8Array(digest))
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  )
  return bytesToHex(new Uint8Array(signature))
}

export async function createDenScheduledTaskTickHeaders(input: {
  secret: string
  body: string
  timestampSeconds: number
  requestId: string
}): Promise<DenScheduledTaskTickHeaders> {
  const canonical = [
    String(input.timestampSeconds),
    input.requestId,
    "POST",
    DEN_SCHEDULED_TASK_TICK_PATH,
    await sha256Hex(input.body),
  ].join("\n")
  const signature = await hmacSha256Hex(input.secret, canonical)
  return {
    "Content-Type": "application/json",
    "X-Den-Scheduler-Timestamp": String(input.timestampSeconds),
    "X-Den-Scheduler-Request-Id": input.requestId,
    "X-Den-Scheduler-Signature": `v1=${signature}`,
  }
}

export async function postDenScheduledTaskTick(input: {
  baseUrl: string
  secret: string
  source: "vercel-cron" | "den-loop"
  now?: () => number
  requestId?: () => string
  fetchImpl?: TickFetch
}): Promise<DenScheduledTaskTickWakeResult> {
  const now = input.now?.() ?? Date.now()
  const requestId = input.requestId?.() ?? crypto.randomUUID()
  const tick: ScheduledTaskTickInput = {
    now,
    source: input.source,
    scope: { kind: "scheduler-owner", schedulerOwner: "den" },
  }
  const body = JSON.stringify(tick)
  const headers = await createDenScheduledTaskTickHeaders({
    secret: input.secret,
    body,
    timestampSeconds: Math.floor(now / 1_000),
    requestId,
  })
  const url = new URL(DEN_SCHEDULED_TASK_TICK_PATH, input.baseUrl)
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`den_scheduled_task_tick_failed:${response.status}`)
  }
  const result = response.status === 204 ? null : await response.json()
  return { requestId, status: response.status, result }
}
