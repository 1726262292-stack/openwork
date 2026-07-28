import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { beforeAll, describe, expect, test } from "bun:test"
import type { CloudProviderMaterializationProvider } from "../src/llm/cloud-provider-materialization.js"

type MaterializerModule = typeof import("../src/llm/cloud-provider-materialization.js")
type MaterializeInput = Parameters<MaterializerModule["materializeCloudWorkerProviders"]>[0]
type Store = NonNullable<MaterializeInput["store"]>
type FetchImpl = NonNullable<MaterializeInput["fetchImpl"]>
type Logger = NonNullable<MaterializeInput["logger"]>
type FetchCall = {
  method: string
  path: string
  headers: Record<string, string>
  body: unknown
}

const organizationId = createDenTypeId("organization")
const instanceUrl = "https://worker.example.test"
let materializeCloudWorkerProviders: MaterializerModule["materializeCloudWorkerProviders"]
let computeCloudProviderMaterializationFingerprint: MaterializerModule["computeCloudProviderMaterializationFingerprint"]
let openworkProvidersFingerprintEnv: string

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
}

beforeAll(async () => {
  seedRequiredEnv()
  const materializer = await import("../src/llm/cloud-provider-materialization.js")
  materializeCloudWorkerProviders = materializer.materializeCloudWorkerProviders
  computeCloudProviderMaterializationFingerprint = materializer.computeCloudProviderMaterializationFingerprint
  openworkProvidersFingerprintEnv = materializer.OPENWORK_PROVIDERS_FINGERPRINT_ENV
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function parseBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string" || !body.trim()) {
    return null
  }

  return JSON.parse(body)
}

function headersRecord(headers: HeadersInit | undefined) {
  const record: Record<string, string> = {}
  new Headers(headers).forEach((value, key) => {
    record[key] = value
  })
  return record
}

function bodyEntries(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return []
  }

  const entries = Object.entries(body).find(([key]) => key === "entries")?.[1]
  return Array.isArray(entries)
    ? entries.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : []
}

function bodyEntryValue(body: unknown, key: string) {
  for (const entry of bodyEntries(body)) {
    if (entry.key === key && typeof entry.value === "string") {
      return entry.value
    }
  }
  return null
}

function makeAnthropicProvider(input: {
  apiKey: string
  modelId?: string
}): CloudProviderMaterializationProvider {
  const modelId = input.modelId ?? "claude-fable-5"
  return {
    id: createDenTypeId("llmProvider"),
    source: "models_dev",
    providerId: "anthropic",
    name: "Anthropic",
    providerConfig: {
      id: "anthropic",
      name: "Anthropic",
      npm: "@ai-sdk/anthropic",
      env: ["ANTHROPIC_API_KEY"],
      api: "https://api.anthropic.com/v1",
    },
    apiKey: input.apiKey,
    models: [
      {
        modelId,
        name: modelId,
        modelConfig: {
          id: modelId,
          name: modelId,
          tool_call: true,
        },
      },
    ],
  }
}

function makeStore(providers: () => CloudProviderMaterializationProvider[]): Store {
  return {
    async listProviders() {
      return providers()
    },
    async getActiveTokens() {
      return [
        { scope: "host", token: "host-token" },
        { scope: "client", token: "client-token" },
      ]
    },
  }
}

function makeInstance(input: {
  storedFingerprint?: string | null
  failEnvWrites?: number
  runtimeProviders?: Record<string, unknown>
} = {}) {
  const calls: FetchCall[] = []
  let storedFingerprint = input.storedFingerprint ?? null
  let failEnvWrites = input.failEnvWrites ?? 0
  const runtimeProviders = input.runtimeProviders ?? {}
  const fetchImpl: FetchImpl = async (url, init) => {
    const parsed = new URL(url)
    const method = init?.method ?? "GET"
    const body = parseBody(init?.body)
    calls.push({
      method,
      path: parsed.pathname,
      headers: headersRecord(init?.headers),
      body,
    })

    if (method === "GET" && parsed.pathname === `/env/${openworkProvidersFingerprintEnv}`) {
      return storedFingerprint
        ? jsonResponse({ item: { key: openworkProvidersFingerprintEnv, value: storedFingerprint } })
        : jsonResponse({ error: "env_not_found" }, 404)
    }

    if (method === "GET" && parsed.pathname === "/workspaces") {
      return jsonResponse({ activeId: "workspace-one", items: [{ id: "workspace-one" }] })
    }

    if (method === "GET" && parsed.pathname === "/workspace/workspace-one/runtime-config") {
      return jsonResponse({ runtime: { provider: runtimeProviders } })
    }

    if (method === "PUT" && parsed.pathname === "/env") {
      if (failEnvWrites > 0) {
        failEnvWrites -= 1
        return jsonResponse({ error: "env_write_failed" }, 500)
      }
      const nextFingerprint = bodyEntryValue(body, openworkProvidersFingerprintEnv)
      if (nextFingerprint) {
        storedFingerprint = nextFingerprint
      }
      return jsonResponse({ ok: true })
    }

    if (method === "PATCH" && parsed.pathname === "/workspace/workspace-one/config") {
      return jsonResponse({ updatedAt: Date.now() })
    }

    if (method === "POST" && parsed.pathname === "/workspace/workspace-one/engine/reload") {
      return jsonResponse({ ok: true, reloadedAt: Date.now() })
    }

    return jsonResponse({ error: "not_found" }, 404)
  }

  return {
    calls,
    fetchImpl,
    get storedFingerprint() {
      return storedFingerprint
    },
  }
}

function callMethods(calls: FetchCall[]) {
  return calls.map((call) => `${call.method} ${call.path}`)
}

function writeCalls(calls: FetchCall[]) {
  return calls.filter((call) => ["PUT", "PATCH", "POST"].includes(call.method))
}

async function materialize(input: {
  workerId?: MaterializeInput["workerId"]
  providers: () => CloudProviderMaterializationProvider[]
  fetchImpl: FetchImpl
  logger?: Logger
  force?: boolean
}) {
  return materializeCloudWorkerProviders({
    organizationId,
    workerId: input.workerId ?? createDenTypeId("worker"),
    instanceUrl,
    hostToken: "host-token",
    clientToken: "client-token",
    store: makeStore(input.providers),
    fetchImpl: input.fetchImpl,
    logger: input.logger,
    force: input.force,
  })
}

describe("Cloud provider materialization", () => {
  test("writes a models.dev provider block, credential env, and reloads OpenCode", async () => {
    const provider = makeAnthropicProvider({ apiKey: "sk-anthropic" })
    const instance = makeInstance()

    const result = await materialize({
      providers: () => [provider],
      fetchImpl: instance.fetchImpl,
      force: true,
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe("applied")
    expect(callMethods(instance.calls)).toEqual([
      `GET /env/${openworkProvidersFingerprintEnv}`,
      "GET /workspaces",
      "GET /workspace/workspace-one/runtime-config",
      "PUT /env",
      "PATCH /workspace/workspace-one/config",
      "POST /workspace/workspace-one/engine/reload",
      "PUT /env",
    ])
    expect(instance.calls[3]?.headers["x-openwork-host-token"]).toBe("host-token")
    expect(instance.calls[3]?.body).toEqual({
      entries: [{ key: "ANTHROPIC_API_KEY", value: "sk-anthropic" }],
    })
    expect(instance.calls[4]?.headers.authorization).toBe("Bearer client-token")
    expect(instance.calls[4]?.body).toEqual({
      opencode: {
        provider: {
          [provider.id]: {
            id: "anthropic",
            name: "Anthropic",
            env: ["ANTHROPIC_API_KEY"],
            models: {
              "claude-fable-5": {
                id: "claude-fable-5",
                name: "claude-fable-5",
                tool_call: true,
              },
            },
            npm: "@ai-sdk/anthropic",
            api: "https://api.anthropic.com/v1",
          },
        },
      },
    })
    expect(instance.storedFingerprint).toBe(result.fingerprint)
  })

  test("skips writes and reloads when the stored fingerprint is unchanged", async () => {
    const provider = makeAnthropicProvider({ apiKey: "sk-anthropic" })
    const fingerprint = computeCloudProviderMaterializationFingerprint([provider])
    const instance = makeInstance({ storedFingerprint: fingerprint })

    const result = await materialize({
      providers: () => [provider],
      fetchImpl: instance.fetchImpl,
      force: true,
    })

    expect(result).toEqual({ ok: true, status: "noop", fingerprint, providers: 1 })
    expect(callMethods(instance.calls)).toEqual([`GET /env/${openworkProvidersFingerprintEnv}`])
    expect(writeCalls(instance.calls)).toHaveLength(0)
  })

  test("reapplies exactly once when providers drift, then caches the resolve check", async () => {
    const workerId = createDenTypeId("worker")
    let providers = [makeAnthropicProvider({ apiKey: "sk-first" })]
    const instance = makeInstance()

    await materialize({ workerId, providers: () => providers, fetchImpl: instance.fetchImpl })
    instance.calls.length = 0

    providers = [makeAnthropicProvider({ apiKey: "sk-second", modelId: "claude-fable-5-updated" })]
    const drift = await materialize({ workerId, providers: () => providers, fetchImpl: instance.fetchImpl })
    expect(drift.ok).toBe(true)
    expect(drift.status).toBe("applied")
    expect(writeCalls(instance.calls).map((call) => call.method)).toEqual(["PUT", "PATCH", "POST", "PUT"])

    instance.calls.length = 0
    const cached = await materialize({ workerId, providers: () => providers, fetchImpl: instance.fetchImpl })
    expect(cached.ok).toBe(true)
    expect(cached.status).toBe("cached")
    expect(instance.calls).toHaveLength(0)
  })

  test("does not patch provider blocks when credential env write fails, and retries next resolve", async () => {
    const provider = makeAnthropicProvider({ apiKey: "sk-anthropic" })
    const instance = makeInstance({ failEnvWrites: 1 })

    const failed = await materialize({
      providers: () => [provider],
      fetchImpl: instance.fetchImpl,
    })

    expect(failed.ok).toBe(false)
    expect(callMethods(instance.calls)).toEqual([
      `GET /env/${openworkProvidersFingerprintEnv}`,
      "GET /workspaces",
      "GET /workspace/workspace-one/runtime-config",
      "PUT /env",
    ])
    expect(instance.calls.some((call) => call.method === "PATCH")).toBe(false)
    expect(instance.calls.some((call) => call.path.endsWith("/engine/reload"))).toBe(false)
    expect(instance.storedFingerprint).toBeNull()

    instance.calls.length = 0
    const retried = await materialize({
      providers: () => [provider],
      fetchImpl: instance.fetchImpl,
    })
    expect(retried.ok).toBe(true)
    expect(retried.status).toBe("applied")
    expect(writeCalls(instance.calls).map((call) => call.method)).toEqual(["PUT", "PATCH", "POST", "PUT"])
  })

  test("does not serialize provider keys into logs, results, or fingerprints", async () => {
    const secret = "sk-secret-never"
    const provider = makeAnthropicProvider({ apiKey: secret })
    const instance = makeInstance()
    const logs: Array<{ message: string; metadata?: Record<string, unknown> }> = []
    const logger: Logger = {
      warn(message, metadata) {
        logs.push({ message, metadata })
      },
    }

    const result = await materialize({
      providers: () => [provider],
      fetchImpl: instance.fetchImpl,
      logger,
      force: true,
    })
    const fingerprint = computeCloudProviderMaterializationFingerprint([provider])

    expect(result.ok).toBe(true)
    expect(JSON.stringify({ logs, result, fingerprint })).not.toContain(secret)
    expect(fingerprint).not.toContain(secret)
  })
})
