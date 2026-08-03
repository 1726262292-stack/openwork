import { describe, expect, test } from "bun:test"
import { createHash, createHmac } from "node:crypto"
import {
  DEN_SCHEDULED_TASK_TICK_PATH,
  createDenScheduledTaskTickHeaders,
  postDenScheduledTaskTick,
} from "./wake-request.js"

describe("Den Scheduled Tasks wake request", () => {
  test("signs the exact timestamp, request, method, path, and body digest", async () => {
    const secret = "scheduler-secret-with-at-least-32-bytes"
    const body = JSON.stringify({ now: 123_000, source: "den-loop" })
    const headers = await createDenScheduledTaskTickHeaders({
      secret,
      body,
      timestampSeconds: 123,
      requestId: "request-1",
    })
    const bodyHash = createHash("sha256").update(body).digest("hex")
    const canonical = [
      "123",
      "request-1",
      "POST",
      DEN_SCHEDULED_TASK_TICK_PATH,
      bodyHash,
    ].join("\n")
    const expected = createHmac("sha256", secret).update(canonical).digest("hex")
    expect(headers["X-Den-Scheduler-Signature"]).toBe(`v1=${expected}`)
  })

  test("wakes the one Den tick endpoint with a Den-owned scope", async () => {
    const captured: Request[] = []
    const result = await postDenScheduledTaskTick({
      baseUrl: "https://den.example.test",
      secret: "scheduler-secret-with-at-least-32-bytes",
      source: "vercel-cron",
      now: () => 456_000,
      requestId: () => "request-2",
      fetchImpl: async (input, init) => {
        captured.push(new Request(input, init))
        return Response.json({ processedAt: 456_000, claimedRunIds: [] })
      },
    })
    const request = captured[0]
    if (!request) throw new Error("Expected a tick request")
    expect(request.url).toBe(
      `https://den.example.test${DEN_SCHEDULED_TASK_TICK_PATH}`,
    )
    expect(request.method).toBe("POST")
    expect(await request.json()).toEqual({
      now: 456_000,
      source: "vercel-cron",
      scope: { kind: "scheduler-owner", schedulerOwner: "den" },
    })
    expect(result).toEqual({
      requestId: "request-2",
      status: 200,
      result: { processedAt: 456_000, claimedRunIds: [] },
    })
  })
})
