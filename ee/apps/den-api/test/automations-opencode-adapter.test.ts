import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  automationEngineAdmissionRequestSchema,
  createAutomationEngineEventSequenceValidator,
  type AutomationEngineAdmissionRequest,
} from "@openwork/automations"
import type {
  AutomationOpenCodeRuntime,
  AutomationOpenCodeRuntimeFactory,
} from "../src/automations/opencode-runtime.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
}

let createEngine: typeof import("../src/automations/execution-adapter.js")["createDenOpenCodeAutomationEngine"]
let failClosedPermissions: typeof import("../src/automations/opencode-runtime.js")["failClosedAutomationPermissions"]

beforeAll(async () => {
  seedRequiredEnv()
  const [adapter, runtime] = await Promise.all([
    import("../src/automations/execution-adapter.js"),
    import("../src/automations/opencode-runtime.js"),
  ])
  createEngine = adapter.createDenOpenCodeAutomationEngine
  failClosedPermissions = runtime.failClosedAutomationPermissions
})

const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryStateRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "automation-opencode-test-"))
  temporaryRoots.push(root)
  return root
}

function admissionRequest(): AutomationEngineAdmissionRequest {
  return automationEngineAdmissionRequestSchema.parse({
    admissionKey: "automation-admission-1",
    automation: {
      id: "automation-1",
      organizationId: "organization-1",
      ownerMemberId: "member-1",
      name: "Morning brief",
      state: "active",
      currentRevisionId: "revision-1",
      nextDueAt: null,
      latestRunAt: null,
      needsAttentionReason: null,
      createdAt: 1_000,
      updatedAt: 1_000,
      archivedAt: null,
    },
    revision: {
      id: "revision-1",
      automationId: "automation-1",
      version: 1,
      instructions: "Prepare the morning brief.",
      schedule: { kind: "daily", timezone: "UTC", hour: 8, minute: 0 },
      model: { providerId: "provider-1", modelId: "model-1" },
      maximumRuntimeMs: 60_000,
      digest: "0123456789abcdef",
      createdAt: 1_000,
    },
    run: {
      id: "run-1",
      automationId: "automation-1",
      revisionId: "revision-1",
      trigger: "manual",
      scheduledFor: null,
      idempotencyKey: "automation-admission-1",
      status: "claimed",
      leaseOwner: "den-1",
      leaseExpiresAt: 61_000,
      heartbeatAt: 1_000,
      attemptCount: 1,
      cloudThread: {
        id: "ath_01k1pq4ea00000000000000000",
        threadKind: "automation",
        executionLocation: "cloud",
        automationId: "automation-1",
        automationRunId: "run-1",
        engineKind: "openwork-den-opencode-v1",
      },
      providerId: "provider-1",
      modelId: "model-1",
      startedAt: 1_000,
      finishedAt: null,
      error: null,
      resultSummary: null,
      usage: { inputTokens: null, outputTokens: null, costMicros: null },
      createdAt: 1_000,
      updatedAt: 1_000,
    },
    capabilityAccess: {
      endpoint: "https://den.example.test/automations/run-1/mcp",
      bearerToken: "run-secret-token",
      expiresAt: 120_000,
    },
    requestedAt: 1_000,
  })
}

function successfulRuntimeFactory(calls: Array<{ sessionId: string | null; runtimeDirectory: string }>): AutomationOpenCodeRuntimeFactory {
  return async (input) => {
    calls.push({ sessionId: input.sessionId, runtimeDirectory: input.runtimeDirectory })
    await mkdir(path.join(input.runtimeDirectory, "runtime"), { recursive: true })
    await writeFile(path.join(input.runtimeDirectory, "runtime", "marker"), "temporary")
    let disposed = false
    const runtime: AutomationOpenCodeRuntime = {
      sessionId: input.sessionId ?? "session-1",
      isAlive: () => !disposed,
      async inspect() {
        return {
          state: "succeeded",
          observations: [
            { key: "assistant:1", type: "assistant", payload: { text: "Brief ready." }, createdAt: 2_000 },
            { key: "usage:1", type: "usage", payload: { inputTokens: 10, outputTokens: 4, costMicros: 2 }, createdAt: 2_000 },
          ],
          resultSummary: "Brief ready.",
          usage: { inputTokens: 10, outputTokens: 4, costMicros: 2 },
          error: null,
        }
      },
      async abort() { return "cancelled" },
      async dispose() { disposed = true },
    }
    return runtime
  }
}

describe("Den OpenCode Automation engine", () => {
  test("declares the fail-closed cloud isolation boundary", async () => {
    const engine = createEngine({ stateDirectory: await temporaryStateRoot(), runtimeFactory: successfulRuntimeFactory([]) })
    expect(await engine.capabilities()).toEqual({
      adapterId: "openwork-den-opencode-v1",
      protocolVersion: 1,
      admission: "idempotent",
      reattachment: "receipt",
      eventDelivery: "ordered_at_least_once",
      resultPersistence: "durable",
      cancellation: "supported",
      isolation: {
        location: "cloud",
        filesystem: "none",
        shell: false,
        browser: false,
        computer: false,
        connect: "run-scoped",
        network: "provider-and-connect-only",
      },
    })
  })

  test("globally denies tools and only grants the exact run-scoped Connect pair", () => {
    expect(failClosedPermissions([
      "read",
      "bash",
      "webfetch",
      "openwork_connect_search_capabilities",
      "openwork_connect_execute_capability",
    ])).toEqual([
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "openwork_connect_search_capabilities", pattern: "*", action: "allow" },
      { permission: "openwork_connect_execute_capability", pattern: "*", action: "allow" },
    ])
    expect(() => failClosedPermissions([
      "openwork_connect_search_capabilities",
      "openwork_connect_execute_capability",
      "openwork_connect_manage_automations",
    ])).toThrow("unreviewed Connect tool")
  })

  test("reattaches from a JSON-only receipt and replays contiguous durable events", async () => {
    const root = await temporaryStateRoot()
    const calls: Array<{ sessionId: string | null; runtimeDirectory: string }> = []
    const runtimeFactory = successfulRuntimeFactory(calls)
    const firstEngine = createEngine({ stateDirectory: root, runtimeFactory, now: () => 1_000, pollIntervalMs: 10 })
    const receipt = await firstEngine.admit(admissionRequest())
    expect(await firstEngine.admit(admissionRequest())).toEqual(receipt)
    expect(JSON.stringify(receipt)).not.toContain("run-secret-token")
    expect(receipt.attachment).toEqual({ runtimeKey: expect.any(String) })
    expect(calls).toHaveLength(1)

    const reattachedEngine = createEngine({ stateDirectory: root, runtimeFactory, now: () => 3_000, pollIntervalMs: 10 })
    const durableReceipt = JSON.parse(JSON.stringify(receipt))
    const events = []
    const validator = createAutomationEngineEventSequenceValidator(durableReceipt)
    for await (const event of reattachedEngine.observe(durableReceipt)) {
      validator.accept(event)
      events.push(event)
    }
    expect(events.map((event) => [event.sequence, event.type])).toEqual([
      [1, "user"],
      [2, "assistant"],
      [3, "usage"],
      [4, "terminal"],
    ])
    expect(calls[1]?.sessionId).toBe("session-1")

    const replay = []
    for await (const event of reattachedEngine.observe(durableReceipt, { afterSequence: 2 })) replay.push(event.sequence)
    expect(replay).toEqual([3, 4])
    expect(await reattachedEngine.read(durableReceipt)).toMatchObject({
      status: "succeeded",
      threadId: "ath_01k1pq4ea00000000000000000",
      resultSummary: "Brief ready.",
      finalSequence: 4,
    })
    await expect(readFile(path.join(calls[1]!.runtimeDirectory, "runtime", "marker"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    const persisted = await readFile(path.join(calls[1]!.runtimeDirectory, "state.json"), "utf8")
    expect(persisted).not.toContain("run-secret-token")
    expect(persisted).not.toContain("den.example.test")
  })

  test("cancels and disposes an admitted OpenCode runtime", async () => {
    const root = await temporaryStateRoot()
    let disposed = 0
    let aborted = 0
    const runtimeFactory: AutomationOpenCodeRuntimeFactory = async (input) => ({
      sessionId: input.sessionId ?? "session-cancel",
      isAlive: () => true,
      async inspect() {
        return { state: "running", observations: [], resultSummary: null, usage: { inputTokens: null, outputTokens: null, costMicros: null }, error: null }
      },
      async abort() { aborted += 1; return "cancelled" },
      async dispose() { disposed += 1 },
    })
    const engine = createEngine({ stateDirectory: root, runtimeFactory, now: () => 5_000 })
    const receipt = await engine.admit(admissionRequest())
    expect(await engine.cancel(receipt)).toMatchObject({ outcome: "requested", requestedAt: 5_000 })
    expect(aborted).toBe(1)
    expect(disposed).toBe(1)
    expect(await engine.read(receipt)).toMatchObject({
      status: "cancelled",
      error: { code: "cancelled" },
    })
    expect((await engine.cancel(receipt)).outcome).toBe("already_terminal")
  })
})
