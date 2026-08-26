import { createHash } from "node:crypto"
import {
  type AutomationRunnerAuth,
  type AutomationRunnerIdentity,
  type AutomationRunnerRejection,
  automationRunnerOwnerInactiveRejection,
  automationRunnerRejectionLogFields,
} from "./runner-auth.js"

type RejectionRateLimitResult = {
  limited: boolean
  retryAfterSeconds: number | null
  shouldLog: boolean
}

type RejectionRateLimitEntry = {
  count: number
  windowStartedAt: number
}

export class AutomationRunnerRejectionLimiter {
  private readonly entries = new Map<string, RejectionRateLimitEntry>()
  private readonly now: () => number

  constructor(private readonly options: {
    maxFailures: number
    windowMs: number
    maxEntries: number
    now?: () => number
  }) {
    if (options.maxFailures < 1 || options.windowMs < 1 || options.maxEntries < 1) {
      throw new Error("automation_runner_rejection_limiter_invalid")
    }
    this.now = options.now ?? Date.now
  }

  get size() {
    return this.entries.size
  }

  record(key: string): RejectionRateLimitResult {
    const now = this.now()
    let entry = this.entries.get(key)
    if (entry && now - entry.windowStartedAt >= this.options.windowMs) {
      this.entries.delete(key)
      entry = undefined
    }
    if (!entry) {
      this.makeRoom()
      this.entries.set(key, { count: 1, windowStartedAt: now })
      return { limited: false, retryAfterSeconds: null, shouldLog: true }
    }

    const nextCount = entry.count + 1
    entry.count = Math.min(nextCount, this.options.maxFailures + 1)
    const limited = nextCount > this.options.maxFailures
    return {
      limited,
      retryAfterSeconds: limited
        ? Math.max(1, Math.ceil((entry.windowStartedAt + this.options.windowMs - now) / 1000))
        : null,
      shouldLog: !limited || nextCount === this.options.maxFailures + 1,
    }
  }

  private makeRoom() {
    if (this.entries.size < this.options.maxEntries) return
    const oldest = this.entries.keys().next()
    if (!oldest.done) this.entries.delete(oldest.value)
  }
}

function requestAddress(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    || headers.get("x-real-ip")?.trim()
    || "unknown"
}

export function automationRunnerRejectionLimitKey(rejection: AutomationRunnerRejection, headers: Headers) {
  const material = `${rejection.claims.runnerId ?? "unknown"}\u0000${requestAddress(headers)}`
  return createHash("sha256").update(material).digest("base64url")
}

function rejectionResponse(rateLimit: RejectionRateLimitResult) {
  const headers = new Headers({ "content-type": "application/json" })
  if (rateLimit.retryAfterSeconds !== null) {
    headers.set("Retry-After", String(rateLimit.retryAfterSeconds))
  }
  return new Response(JSON.stringify({ error: "runner_unauthorized" }), {
    status: rateLimit.limited ? 429 : 401,
    headers,
  })
}

export type AutomationRunnerRequestAuthentication =
  | { ok: true; identity: AutomationRunnerIdentity }
  | { ok: false; response: Response }

export class AutomationRunnerRequestAuthenticator {
  constructor(private readonly options: {
    auth: AutomationRunnerAuth
    limiter: AutomationRunnerRejectionLimiter
    audienceFromRequest: (request: Request) => string
    isActiveOwner: (identity: AutomationRunnerIdentity) => Promise<boolean>
    logRejection: (fields: Readonly<Record<string, unknown>>) => void
  }) {}

  async authenticate(request: Request): Promise<AutomationRunnerRequestAuthentication> {
    const authentication = this.options.auth.authenticate(
      request.headers.get("Authorization") ?? undefined,
      this.options.audienceFromRequest(request),
    )
    let rejection: AutomationRunnerRejection
    if (!authentication.ok) {
      rejection = authentication.rejection
    } else if (!(await this.options.isActiveOwner(authentication.identity))) {
      rejection = automationRunnerOwnerInactiveRejection(authentication.identity)
    } else {
      return authentication
    }

    const rateLimit = this.options.limiter.record(automationRunnerRejectionLimitKey(rejection, request.headers))
    if (rateLimit.shouldLog) {
      this.options.logRejection({
        ...automationRunnerRejectionLogFields(rejection),
        rate_limited: rateLimit.limited,
        retry_after_seconds: rateLimit.retryAfterSeconds ?? undefined,
      })
    }
    return { ok: false, response: rejectionResponse(rateLimit) }
  }
}
