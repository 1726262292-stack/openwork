import { describe, expect, test } from "bun:test"
import { createHash, createHmac } from "node:crypto"
import {
  resolveDenScheduledTaskWakeConfig,
  runDenScheduledTaskWakeOnce,
} from "../src/scheduled-tasks/wake-loop.js"

describe("self-hosted Scheduled Tasks wake loop", () => {
  test("stays disabled until explicitly enabled with a secret", () => {
    expect(resolveDenScheduledTaskWakeConfig({}).enabled).toBe(false)
    expect(resolveDenScheduledTaskWakeConfig({
      DEN_SCHEDULED_TASKS_WAKE_ENABLED: "1",
    }).enabled).toBe(false)
  })

  test("uses the same signed Den tick endpoint with den-loop source", async () => {
    const config = resolveDenScheduledTaskWakeConfig({
      DEN_SCHEDULED_TASKS_WAKE_ENABLED: "1",
      DEN_SCHEDULED_TASKS_TICK_BASE_URL: "http://den:8788",
      DEN_SCHEDULED_TASKS_INTERNAL_SECRET: "internal-secret",
      DEN_SCHEDULED_TASKS_WAKE_INTERVAL_MS: "5000",
    })
    const requests: Request[] = []
    const ran = await runDenScheduledTaskWakeOnce({
      config,
      now: () => 456_000,
      requestId: () => "loop-1",
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json({ processedAt: 456_000, claimedRunIds: [] })
      },
    })
    expect(ran).toBe(true)
    const request = requests[0]
    if (!request) throw new Error("expected tick request")
    expect(request.url).toBe("http://den:8788/internal/scheduled-tasks/tick")
    const body = await request.text()
    expect(JSON.parse(body).source).toBe("den-loop")
    const canonical = [
      "456",
      "loop-1",
      "POST",
      "/internal/scheduled-tasks/tick",
      createHash("sha256").update(body).digest("hex"),
    ].join("\n")
    const expected = createHmac("sha256", "internal-secret").update(canonical).digest("hex")
    expect(request.headers.get("x-den-scheduler-signature")).toBe(`v1=${expected}`)
  })
})
