import { describe, expect, test } from "bun:test"
import { createHash, createHmac } from "node:crypto"
import { handleScheduledTasksCron } from "../app/api/cron/scheduled-tasks/route.js"

const env = {
  CRON_SECRET: "vercel-cron-secret",
  DEN_API_BASE: "https://den-api.test",
  DEN_SCHEDULED_TASKS_INTERNAL_SECRET: "internal-scheduler-secret",
}

describe("Scheduled Tasks Vercel cron", () => {
  test("requires Vercel's cron bearer", async () => {
    const response = await handleScheduledTasksCron(
      new Request("https://web.test/api/cron/scheduled-tasks"),
      { env },
    )
    expect(response.status).toBe(401)
  })

  test("fails closed when runtime configuration is incomplete", async () => {
    const response = await handleScheduledTasksCron(
      new Request("https://web.test/api/cron/scheduled-tasks", {
        headers: { Authorization: "Bearer vercel-cron-secret" },
      }),
      { env: { ...env, DEN_SCHEDULED_TASKS_INTERNAL_SECRET: "" } },
    )
    expect(response.status).toBe(503)
  })

  test("wakes the single signed Den tick endpoint", async () => {
    let upstream: Request | null = null
    const response = await handleScheduledTasksCron(
      new Request("https://web.test/api/cron/scheduled-tasks", {
        headers: { Authorization: "Bearer vercel-cron-secret" },
      }),
      {
        env,
        now: () => 123_000,
        requestId: () => "wake-1",
        fetchImpl: async (input, init) => {
          upstream = new Request(input, init)
          return Response.json({ processedAt: 123_000, claimedRunIds: [] })
        },
      },
    )
    expect(response.status).toBe(200)
    if (!upstream) throw new Error("expected upstream tick request")
    expect(upstream.url).toBe("https://den-api.test/internal/scheduled-tasks/tick")
    const body = await upstream.text()
    expect(JSON.parse(body)).toEqual({
      now: 123_000,
      source: "vercel-cron",
      scope: { kind: "scheduler-owner", schedulerOwner: "den" },
    })
    const canonical = [
      "123",
      "wake-1",
      "POST",
      "/internal/scheduled-tasks/tick",
      createHash("sha256").update(body).digest("hex"),
    ].join("\n")
    const signature = createHmac("sha256", env.DEN_SCHEDULED_TASKS_INTERNAL_SECRET)
      .update(canonical)
      .digest("hex")
    expect(upstream.headers.get("x-den-scheduler-signature")).toBe(`v1=${signature}`)
  })
})
