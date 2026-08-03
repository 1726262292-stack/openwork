import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import http from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  automationEngineAdmissionRequestSchema,
  createAutomationEngineEventSequenceValidator,
  type AutomationEngineAdmissionRequest,
} from "@openwork/automations"
import type {
  AutomationEngineRuntime,
  AutomationEngineRuntimeFactory,
} from "../src/automations/native-runtime.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
}

type NativeRuntimeModule = typeof import("../src/automations/native-runtime.js")

let createEngine: typeof import("../src/automations/execution-adapter.js")["createDenAutomationEngine"]
let nativeRuntime: NativeRuntimeModule

beforeAll(async () => {
  seedRequiredEnv()
  const [adapter, runtime] = await Promise.all([
    import("../src/automations/execution-adapter.js"),
    import("../src/automations/native-runtime.js"),
  ])
  createEngine = adapter.createDenAutomationEngine
  nativeRuntime = runtime
})

const temporaryRoots: string[] = []
const activeServers: http.Server[] = []
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  await Promise.all(activeServers.splice(0).map((server) => new Promise((resolve) => server.close(() => resolve(null)))))
})

async function temporaryStateRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "automation-native-test-"))
  temporaryRoots.push(root)
  return root
}

async function listen(server: http.Server): Promise<string> {
  activeServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address !== "object") throw new Error("mock server has no port")
  return `http://127.0.0.1:${address.port}`
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    request.on("data", (chunk) => { body += String(chunk) })
    request.on("end", () => resolve(body))
    request.on("error", reject)
  })
}

type McpMockOptions = {
  toolNames?: string[]
  onToolCall?: (name: string, args: Record<string, unknown>) => { text: string; isError?: boolean }
  seenAuthorization?: string[]
}

/** Minimal Streamable-HTTP MCP server: enough JSON-RPC to satisfy the SDK
 * client (initialize, initialized notification, tools/list, tools/call). */
function mcpMockServer(options: McpMockOptions = {}): http.Server {
  const toolNames = options.toolNames ?? ["search_capabilities", "execute_capability"]
  return http.createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST") {
        response.writeHead(405).end()
        return
      }
      options.seenAuthorization?.push(String(request.headers.authorization ?? ""))
      const parsed: unknown = JSON.parse((await readBody(request)) || "{}")
      const message = Array.isArray(parsed) ? parsed[0] as Record<string, unknown> : parsed as Record<string, unknown>
      const respond = (result: unknown) => {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }))
      }
      switch (message.method) {
        case "initialize":
          respond({
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "mock-automation-run", version: "1.0.0" },
          })
          return
        case "tools/list":
          respond({
            tools: toolNames.map((name) => ({
              name,
              description: name,
              inputSchema: { type: "object" },
            })),
          })
          return
        case "tools/call": {
          const params = (message.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
          const outcome = options.onToolCall?.(params.name ?? "", params.arguments ?? {})
            ?? { text: JSON.stringify({ ok: true }) }
          respond({
            content: [{ type: "text", text: outcome.text }],
            ...(outcome.isError ? { isError: true } : {}),
          })
          return
        }
        default:
          response.writeHead(202).end()
      }
    })().catch(() => response.writeHead(500).end())
  })
}

type ChatTurn =
  | { toolCall: { name: string; arguments: Record<string, unknown> }; usage?: { prompt: number; completion: number } }
  | { text: string; usage?: { prompt: number; completion: number } }
  | { status: number }
  | { hang: true }

function providerMockServer(turns: ChatTurn[], seen: Array<{ authorization: string | undefined; body: Record<string, unknown> }>): http.Server {
  let call = 0
  return http.createServer((request, response) => {
    void (async () => {
      const body = JSON.parse((await readBody(request)) || "{}") as Record<string, unknown>
      seen.push({ authorization: request.headers.authorization as string | undefined, body })
      const turn = turns[Math.min(call, turns.length - 1)]
      call += 1
      if (!turn || "hang" in turn) return
      if ("status" in turn) {
        response.writeHead(turn.status, { "content-type": "application/json" }).end(JSON.stringify({ error: "denied" }))
        return
      }
      const usage = turn.usage
        ? { prompt_tokens: turn.usage.prompt, completion_tokens: turn.usage.completion }
        : undefined
      const message = "toolCall" in turn
        ? {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: `call_${call}`,
              type: "function",
              function: { name: turn.toolCall.name, arguments: JSON.stringify(turn.toolCall.arguments) },
            }],
          }
        : { role: "assistant", content: turn.text }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        choices: [{ index: 0, finish_reason: "toolCall" in turn ? "tool_calls" : "stop", message }],
        ...(usage ? { usage } : {}),
      }))
    })().catch(() => response.writeHead(500).end())
  })
}

function admissionRequest(overrides?: { endpoint?: string }): AutomationEngineAdmissionRequest {
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
        engineKind: "openwork-den-native-v1",
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
      endpoint: overrides?.endpoint ?? "https://den.example.test/automations/run-1/mcp",
      bearerToken: "run-secret-token",
      expiresAt: Date.now() + 300_000,
    },
    requestedAt: 1_000,
  })
}

function resolvedModel(input: { api: string; apiKey?: string | null; npm?: string; cost?: { input: number; output: number } }) {
  return {
    ok: true as const,
    value: {
      accessKind: "authorized_custom" as const,
      providerRecordId: "lpr_1",
      providerId: "provider-1",
      modelId: "model-1",
      providerName: "Mock provider",
      modelName: "Mock model",
      providerConfig: {
        id: "provider-1",
        npm: input.npm ?? "@ai-sdk/openai-compatible",
        api: input.api,
        env: ["MOCK_API_KEY"],
      },
      modelConfig: {
        id: "model-1",
        tool_call: true,
        ...(input.cost ? { cost: { ...input.cost, cache_read: 0, cache_write: 0 } } : {}),
      },
      apiKey: input.apiKey === undefined ? "mock-secret-key" : input.apiKey,
    },
  }
}

async function settledSnapshot(runtime: AutomationEngineRuntime) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const snapshot = await runtime.inspect()
    if (snapshot.state !== "running") return snapshot
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("native runtime did not settle in time")
}

function successfulRuntimeFactory(calls: Array<{ sessionId: string | null; runtimeDirectory: string }>): AutomationEngineRuntimeFactory {
  return async (input) => {
    calls.push({ sessionId: input.sessionId, runtimeDirectory: input.runtimeDirectory })
    await mkdir(path.join(input.runtimeDirectory, "runtime"), { recursive: true })
    await writeFile(path.join(input.runtimeDirectory, "runtime", "marker"), "temporary")
    let disposed = false
    const runtime: AutomationEngineRuntime = {
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

describe("Den native Automation engine adapter", () => {
  test("declares the fail-closed cloud isolation boundary", async () => {
    const engine = createEngine({ stateDirectory: await temporaryStateRoot(), runtimeFactory: successfulRuntimeFactory([]) })
    expect(await engine.capabilities()).toEqual({
      adapterId: "openwork-den-native-v1",
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

  test("cancels and disposes an admitted runtime", async () => {
    const root = await temporaryStateRoot()
    let disposed = 0
    let aborted = 0
    const runtimeFactory: AutomationEngineRuntimeFactory = async (input) => ({
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

describe("native runtime boundary", () => {
  test("requires exactly the reviewed Connect tool pair", () => {
    expect(() => nativeRuntime.failClosedAutomationConnectTools(["search_capabilities", "execute_capability"])).not.toThrow()
    expect(() => nativeRuntime.failClosedAutomationConnectTools(["search_capabilities"])).toThrow("missing required tools")
    expect(() => nativeRuntime.failClosedAutomationConnectTools([
      "search_capabilities",
      "execute_capability",
      "manage_automations",
    ])).toThrow("unreviewed tools")
  })

  test("resolves only OpenAI-compatible providers and never leaks the key shape", () => {
    const resolved = resolvedModel({ api: "https://provider.example.test/v1/" }).value
    const endpoint = nativeRuntime.resolveAutomationProviderEndpoint(resolved)
    expect(endpoint.url).toBe("https://provider.example.test/v1/chat/completions")
    expect(endpoint.headers.authorization).toBe("Bearer mock-secret-key")

    const keyless = nativeRuntime.resolveAutomationProviderEndpoint(
      resolvedModel({ api: "https://provider.example.test/v1", apiKey: null }).value,
    )
    expect(keyless.headers.authorization).toBeUndefined()

    expect(() => nativeRuntime.resolveAutomationProviderEndpoint(
      resolvedModel({ api: "https://provider.example.test/v1", npm: "@ai-sdk/anthropic" }).value,
    )).toThrow("not compatible")

    const missingEndpoint = resolvedModel({ api: "https://provider.example.test/v1" }).value
    expect(() => nativeRuntime.resolveAutomationProviderEndpoint({
      ...missingEndpoint,
      providerConfig: { ...missingEndpoint.providerConfig, api: undefined },
    })).toThrow("does not declare an API endpoint")
  })

  test("runs the Connect tool loop in-process and settles with summary and usage", async () => {
    const mcpAuthorization: string[] = []
    const capabilityCalls: Array<{ name: string; args: Record<string, unknown> }> = []
    const mcpUrl = await listen(mcpMockServer({
      seenAuthorization: mcpAuthorization,
      onToolCall: (name, args) => {
        capabilityCalls.push({ name, args })
        return { text: JSON.stringify({ matches: [{ name: "native:google-workspace:listMessages" }] }) }
      },
    }))
    const providerRequests: Array<{ authorization: string | undefined; body: Record<string, unknown> }> = []
    const providerUrl = await listen(providerMockServer([
      { toolCall: { name: "search_capabilities", arguments: { query: "gmail" } }, usage: { prompt: 100, completion: 20 } },
      { text: "Automation complete: summary sent.", usage: { prompt: 150, completion: 30 } },
    ], providerRequests))

    const factory = nativeRuntime.automationNativeRuntimeFactory({
      resolveModelAccess: async () => resolvedModel({ api: providerUrl, apiKey: null, cost: { input: 2, output: 4 } }),
    })
    const runtime = await factory({
      executionId: "execution-1",
      request: admissionRequest({ endpoint: mcpUrl }),
      runtimeDirectory: await temporaryStateRoot(),
      sessionId: null,
    })
    const snapshot = await settledSnapshot(runtime)
    await runtime.dispose()

    expect(snapshot.state).toBe("succeeded")
    expect(snapshot.resultSummary).toBe("Automation complete: summary sent.")
    expect(snapshot.usage).toEqual({ inputTokens: 250, outputTokens: 50, costMicros: 700 })
    expect(snapshot.observations.map((observation) => [observation.type, observation.payload.phase ?? null])).toEqual([
      ["capability_search", "running"],
      ["capability_search", "completed"],
      ["assistant", null],
      ["usage", null],
    ])
    expect(capabilityCalls).toEqual([{ name: "search_capabilities", args: { query: "gmail" } }])
    expect(mcpAuthorization.every((value) => value === "Bearer run-secret-token")).toBe(true)
    expect(providerRequests.every((entry) => entry.authorization === undefined)).toBe(true)
    expect(providerRequests[0]?.body.model).toBe("model-1")
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain("run-secret-token")
    expect(serialized).not.toContain("mock-secret-key")
  })

  test("maps provider credential rejections to provider_unavailable", async () => {
    const mcpUrl = await listen(mcpMockServer())
    const providerUrl = await listen(providerMockServer([{ status: 401 }], []))
    const factory = nativeRuntime.automationNativeRuntimeFactory({
      resolveModelAccess: async () => resolvedModel({ api: providerUrl }),
    })
    const runtime = await factory({
      executionId: "execution-2",
      request: admissionRequest({ endpoint: mcpUrl }),
      runtimeDirectory: await temporaryStateRoot(),
      sessionId: null,
    })
    const snapshot = await settledSnapshot(runtime)
    await runtime.dispose()
    expect(snapshot.state).toBe("failed")
    expect(snapshot.error).toMatchObject({ code: "provider_unavailable", retryable: false })
  })

  test("fails closed before any model call when the Connect endpoint changes shape", async () => {
    const mcpUrl = await listen(mcpMockServer({
      toolNames: ["search_capabilities", "execute_capability", "manage_automations"],
    }))
    const providerRequests: Array<{ authorization: string | undefined; body: Record<string, unknown> }> = []
    const providerUrl = await listen(providerMockServer([{ text: "should never run" }], providerRequests))
    const factory = nativeRuntime.automationNativeRuntimeFactory({
      resolveModelAccess: async () => resolvedModel({ api: providerUrl }),
    })
    await expect(factory({
      executionId: "execution-3",
      request: admissionRequest({ endpoint: mcpUrl }),
      runtimeDirectory: await temporaryStateRoot(),
      sessionId: null,
    })).rejects.toThrow("unreviewed tools")
    expect(providerRequests).toHaveLength(0)
  })

  test("abort stops an in-flight provider call", async () => {
    const mcpUrl = await listen(mcpMockServer())
    const providerUrl = await listen(providerMockServer([{ hang: true }], []))
    const factory = nativeRuntime.automationNativeRuntimeFactory({
      resolveModelAccess: async () => resolvedModel({ api: providerUrl }),
    })
    const runtime = await factory({
      executionId: "execution-4",
      request: admissionRequest({ endpoint: mcpUrl }),
      runtimeDirectory: await temporaryStateRoot(),
      sessionId: null,
    })
    expect(await runtime.abort()).toBe("cancelled")
    expect(await runtime.abort()).toBe("not_running")
    await runtime.dispose()
  })
})
