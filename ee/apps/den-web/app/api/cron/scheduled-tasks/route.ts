import { timingSafeEqual } from "node:crypto"
import { postDenScheduledTaskTick } from "@openwork/scheduled-tasks-den"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type CronEnv = Record<string, string | undefined>
type CronFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

function secretMatches(actual: string, expected: string): boolean {
  const left = new TextEncoder().encode(actual)
  const right = new TextEncoder().encode(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function handleScheduledTasksCron(
  request: Request,
  options?: {
    env?: CronEnv
    fetchImpl?: CronFetch
    now?: () => number
    requestId?: () => string
  },
): Promise<Response> {
  const env = options?.env ?? process.env
  const cronSecret = env.CRON_SECRET?.trim() ?? ""
  const denApiBase = env.DEN_API_BASE?.trim() ?? ""
  const schedulerSecret = env.DEN_SCHEDULED_TASKS_INTERNAL_SECRET?.trim() ?? ""
  if (!cronSecret || !denApiBase || !schedulerSecret) {
    return Response.json(
      { ok: false, error: "scheduled_tasks_cron_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
  const authorization = request.headers.get("authorization") ?? ""
  if (!secretMatches(authorization, `Bearer ${cronSecret}`)) {
    return Response.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    )
  }
  try {
    const wake = await postDenScheduledTaskTick({
      baseUrl: denApiBase,
      secret: schedulerSecret,
      source: "vercel-cron",
      fetchImpl: options?.fetchImpl,
      now: options?.now,
      requestId: options?.requestId,
    })
    return Response.json(
      { ok: true, requestId: wake.requestId, result: wake.result },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return Response.json(
      { ok: false, error: "scheduled_tasks_tick_failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    )
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleScheduledTasksCron(request)
}
