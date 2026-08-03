import { beforeAll, describe, expect, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
}

let security: typeof import("../src/scheduled-tasks/security.js")
let workers: typeof import("../src/routes/workers/shared.js")
let repository: typeof import("../src/scheduled-tasks/repository.js")
let authority: typeof import("../src/scheduled-tasks/authority.js")

beforeAll(async () => {
  seedRequiredEnv()
  security = await import("../src/scheduled-tasks/security.js")
  workers = await import("../src/routes/workers/shared.js")
  repository = await import("../src/scheduled-tasks/repository.js")
  authority = await import("../src/scheduled-tasks/authority.js")
})

describe("Den Scheduled Tasks security", () => {
  test("accepts the exact signed tick and rejects tampering and stale requests", () => {
    const rawBody = JSON.stringify({ now: 1_000_000, source: "den-loop" })
    const signatureHeader = security.createDenScheduledTaskTickSignature({
      secret: "a-secret-long-enough-for-a-signed-scheduler",
      rawBody,
      timestampSeconds: 1_000,
      requestId: "tick-1",
    })
    const input = {
      secret: "a-secret-long-enough-for-a-signed-scheduler",
      rawBody,
      timestampHeader: "1000",
      requestId: "tick-1",
      signatureHeader,
      now: 1_000_000,
    }
    expect(security.verifyDenScheduledTaskTickSignature(input)).toBe(true)
    expect(security.verifyDenScheduledTaskTickSignature({
      ...input,
      rawBody: JSON.stringify({ now: 1_000_000, source: "vercel-cron" }),
    })).toBe(false)
    expect(security.verifyDenScheduledTaskTickSignature({
      ...input,
      now: 1_301_000,
    })).toBe(false)
  })

  test("never projects the Scheduled Tasks execution token to browser clients", () => {
    expect(workers.publicWorkerTokens("host-secret", "client-secret")).toEqual({
      owner: "host-secret",
      host: "host-secret",
      client: "client-secret",
    })
    expect("execution" in workers.publicWorkerTokens("host-secret", "client-secret")).toBe(false)
  })

  test("requires contiguous worker event sequences", () => {
    expect(repository.isNextScheduledTaskEventSequence({ sequence: 1, latestSequence: null })).toBe(true)
    expect(repository.isNextScheduledTaskEventSequence({ sequence: 2, latestSequence: 1 })).toBe(true)
    expect(repository.isNextScheduledTaskEventSequence({ sequence: 99, latestSequence: null })).toBe(false)
    expect(repository.isNextScheduledTaskEventSequence({ sequence: 3, latestSequence: 1 })).toBe(false)
  })

  test("wakes only stopped Daytona Cloud workers", () => {
    const worker = {
      created_by_user_id: "user-1",
      destination: "cloud" as const,
      sandbox_backend: "cloud-instance",
      status: "stopped" as const,
    }
    expect(authority.classifyDenScheduledTaskWorker(worker, "user-1")).toBe("wakeable-stopped")
    expect(authority.classifyDenScheduledTaskWorker({
      ...worker,
      destination: "local",
    }, "user-1")).toBe("unavailable")
    expect(authority.classifyDenScheduledTaskWorker({
      ...worker,
      sandbox_backend: "daytona",
    }, "user-1")).toBe("unavailable")
    expect(authority.classifyDenScheduledTaskWorker({
      ...worker,
      status: "healthy",
    }, "user-1")).toBe("ready")
  })
})
