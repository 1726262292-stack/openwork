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
type WorkspaceFixture = {
  id: string
  workspaceType?: string
  path?: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

function providerPatchFromBody(body: unknown) {
  if (!isRecord(body) || !isRecord(body.opencode) || !isRecord(body.opencode.provider)) {
    return {}
  }

  return body.opencode.provider
}

function workspaceRouteId(path: string, suffix: string) {
  if (!path.startsWith("/workspace/") || !path.endsWith(suffix)) {
    return null
  }

  const encoded = path.slice("/workspace/".length, path.length - suffix.length)
  return encoded ? decodeURIComponent(encoded) : null
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
  failConfigPatches?: number
  runtimeProviders?: Record<string, unknown>
  configReadProviders?: Record<string, unknown>
  missingConfigReadbacks?: number
  workspaces?: WorkspaceFixture[]
  activeId?: string | null
} = {}) {
  const calls: FetchCall[] = []
  const envValues = new Map<string, string>()
  if (input.storedFingerprint) {
    envValues.set(openworkProvidersFingerprintEnv, input.storedFingerprint)
  }
  let failEnvWrites = input.failEnvWrites ?? 0
  let failConfigPatches = input.failConfigPatches ?? 0
  let missingConfigReadbacks = input.missingConfigReadbacks ?? 0
  const runtimeProviders: Record<string, unknown> = { ...(input.runtimeProviders ?? {}) }
  const workspaces = input.workspaces ?? [{ id: "workspace-one" }]
  const activeId = input.activeId === undefined ? workspaces[0]?.id ?? null : input.activeId
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

    if (method === "GET" && parsed.pathname.startsWith("/env/")) {
      const key = decodeURIComponent(parsed.pathname.slice("/env/".length))
      const value = envValues.get(key) ?? null
      return value
        ? jsonResponse({ item: { key, value } })
        : jsonResponse({ error: "env_not_found" }, 404)
    }

    if (method === "GET" && parsed.pathname === "/workspaces") {
      return jsonResponse({ activeId, items: workspaces })
    }

    if (method === "GET" && workspaceRouteId(parsed.pathname, "/runtime-config")) {
      return jsonResponse({ runtime: { provider: runtimeProviders } })
    }

    if (method === "GET" && workspaceRouteId(parsed.pathname, "/config")) {
      if (missingConfigReadbacks > 0) {
        missingConfigReadbacks -= 1
        return jsonResponse({ opencode: { provider: {} } })
      }
      return jsonResponse({ opencode: { provider: input.configReadProviders ?? runtimeProviders } })
    }

    if (method === "PUT" && parsed.pathname === "/env") {
      if (failEnvWrites > 0) {
        failEnvWrites -= 1
        return jsonResponse({ error: "env_write_failed" }, 500)
      }
      for (const entry of bodyEntries(body)) {
        if (typeof entry.key === "string" && typeof entry.value === "string") {
          envValues.set(entry.key, entry.value)
        }
      }
      return jsonResponse({ ok: true })
    }

    if (method === "DELETE" && parsed.pathname.startsWith("/env/")) {
      const key = decodeURIComponent(parsed.pathname.slice("/env/".length))
      if (!envValues.has(key)) {
        return jsonResponse({ error: "env_not_found" }, 404)
      }
      envValues.delete(key)
      return jsonResponse({ ok: true })
    }

    if (method === "PATCH" && workspaceRouteId(parsed.pathname, "/config")) {
      if (failConfigPatches > 0) {
        failConfigPatches -= 1
        return jsonResponse({ error: "config_patch_failed" }, 500)
      }
      const providerPatch = providerPatchFromBody(body)
      for (const [providerId, value] of Object.entries(providerPatch)) {
        if (value === null) {
          delete runtimeProviders[providerId]
        } else if (isRecord(value)) {
          runtimeProviders[providerId] = value
        }
      }
      return jsonResponse({ updatedAt: Date.now() })
    }

    if (method === "POST" && workspaceRouteId(parsed.pathname, "/engine/reload")) {
      return jsonResponse({ ok: true, reloadedAt: Date.now() })
    }

    return jsonResponse({ error: "not_found" }, 404)
  }

  return {
    calls,
    fetchImpl,
    get storedFingerprint() {
      return envValues.get(openworkProvidersFingerprintEnv) ?? null
    },
    envValue(key: string) {
      return envValues.get(key) ?? null
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
      "GET /env/ANTHROPIC_API_KEY",
      "PUT /env",
      "PATCH /workspace/workspace-one/config",
      "POST /workspace/workspace-one/engine/reload",
      "GET /workspace/workspace-one/config",
      "PUT /env",
    ])
    expect(instance.calls[4]?.headers["x-openwork-host-token"]).toBe("host-token")
    expect(instance.calls[4]?.body).toEqual({
      entries: [{ key: "ANTHROPIC_API_KEY", value: "sk-anthropic" }],
    })
    expect(instance.calls[5]?.headers.authorization).toBe("Bearer client-token")
    expect(instance.calls[5]?.body).toEqual({
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
    const instance = makeInstance({ storedFingerprint: fingerprint, runtimeProviders: { [provider.id]: { id: "anthropic" } } })

    const result = await materialize({
      providers: () => [provider],
      fetchImpl: instance.fetchImpl,
      force: true,
    })

    expect(result).toEqual({ ok: true, status: "noop", fingerprint, providers: 1 })
    expect(callMethods(instance.calls)).toEqual([
      `GET /env/${openworkProvidersFingerprintEnv}`,
      "GET /workspaces",
      "GET /workspace/workspace-one/config",
    ])
    expect(writeCalls(instance.calls)).toHaveLength(0)
  })

  test("retries a stored fingerprint when provider read-back is missing", async () => {
    const provider = makeAnthropicProvider({ apiKey: "sk-anthropic" })
    const fingerprint = computeCloudProviderMaterializationFingerprint([provider])
    const instance = makeInstance({ storedFingerprint: fingerprint, missingConfigReadbacks: 1 })

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
      "GET /workspace/workspace-one/config",
      "GET /workspace/workspace-one/runtime-config",
      "GET /env/ANTHROPIC_API_KEY",
      "PUT /env",
      "PATCH /workspace/workspace-one/config",
      "POST /workspace/workspace-one/engine/reload",
      "GET /workspace/workspace-one/config",
      "PUT /env",
    ])
    expect(instance.storedFingerprint).toBe(result.fingerprint)
  })

  test("treats missing provider read-back as materialization failure", async () => {
    const provider = makeAnthropicProvider({ apiKey: "sk-anthropic" })
    const instance = makeInstance({ configReadProviders: {} })

    const result = await materialize({
      providers: () => [provider],
      fetchImpl: instance.fetchImpl,
      force: true,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe(`provider_readback_missing_${provider.id}`)
    }
    expect(callMethods(instance.calls)).toEqual([
      `GET /env/${openworkProvidersFingerprintEnv}`,
      "GET /workspaces",
      "GET /workspace/workspace-one/runtime-config",
      "GET /env/ANTHROPIC_API_KEY",
      "PUT /env",
      "PATCH /workspace/workspace-one/config",
      "POST /workspace/workspace-one/engine/reload",
      "GET /workspace/workspace-one/config",
      "PATCH /workspace/workspace-one/config",
      "DELETE /env/ANTHROPIC_API_KEY",
    ])
    expect(instance.storedFingerprint).toBeNull()
    expect(instance.envValue("ANTHROPIC_API_KEY")).toBeNull()
  })

  test("patches the local session workspace when discovery lists a remote workspace first", async () => {
    const provider = makeAnthropicProvider({ apiKey: "sk-anthropic" })
    const instance = makeInstance({
      activeId: "rem_ws_remote",
      workspaces: [
        { id: "rem_ws_remote", workspaceType: "remote", path: "/remote" },
        { id: "ws_session", workspaceType: "local", path: "/tmp/openwork-runtime" },
      ],
    })

    const result = await materialize({
      providers: () => [provider],
      fetchImpl: instance.fetchImpl,
      force: true,
    })

    expect(result.ok).toBe(true)
    expect(instance.calls.some((call) => call.method === "PATCH" && call.path === "/workspace/ws_session/config")).toBe(true)
    expect(instance.calls.some((call) => call.method === "PATCH" && call.path === "/workspace/rem_ws_remote/config")).toBe(false)
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
      "GET /env/ANTHROPIC_API_KEY",
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

  test("rolls back credential env, skips fingerprint, and retries when config patch fails", async () => {
    const provider = makeAnthropicProvider({ apiKey: "sk-anthropic" })
    const instance = makeInstance({ failConfigPatches: 1 })

    const failed = await materialize({
      providers: () => [provider],
      fetchImpl: instance.fetchImpl,
    })

    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.reason).toBe("runtime_config_patch_failed_500")
    }
    expect(callMethods(instance.calls)).toEqual([
      `GET /env/${openworkProvidersFingerprintEnv}`,
      "GET /workspaces",
      "GET /workspace/workspace-one/runtime-config",
      "GET /env/ANTHROPIC_API_KEY",
      "PUT /env",
      "PATCH /workspace/workspace-one/config",
      "DELETE /env/ANTHROPIC_API_KEY",
    ])
    expect(instance.calls.some((call) => call.path.endsWith("/engine/reload"))).toBe(false)
    expect(instance.storedFingerprint).toBeNull()
    expect(instance.envValue("ANTHROPIC_API_KEY")).toBeNull()

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
