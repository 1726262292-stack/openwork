import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { beforeAll, expect, test } from "bun:test"
import type { CloudRuntimeStore } from "../src/workers/worker-access.js"

function seedRequiredEnv() {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS ??= "http://127.0.0.1:8790"
  process.env.PROVISIONER_MODE = "daytona"
  process.env.DAYTONA_API_KEY = "daytona-test-key"
  process.env.DAYTONA_SNAPSHOT = "openwork-0.18.8"
}

type SharedModule = typeof import("../src/routes/workers/shared.js")
type AccessModule = typeof import("../src/workers/worker-access.js")
let shared: SharedModule
let access: AccessModule

beforeAll(async () => {
  seedRequiredEnv()
  ;[shared, access] = await Promise.all([
    import("../src/routes/workers/shared.js"),
    import("../src/workers/worker-access.js"),
  ])
})

function worker() {
  const now = new Date("2026-08-27T10:00:00.000Z")
  return {
    id: createDenTypeId("worker"),
    org_id: createDenTypeId("organization"),
    created_by_user_id: createDenTypeId("user"),
    name: "Daytona Cloud",
    description: null,
    destination: "cloud",
    status: "healthy",
    image_version: "openwork-0.18.8",
    workspace_path: null,
    sandbox_backend: "cloud-instance",
    last_heartbeat_at: null,
    last_active_at: null,
    created_at: now,
    updated_at: now,
  } satisfies Parameters<SharedModule["fetchWorkerRuntimeJson"]>[0]["worker"]
}

function runtimeStore(): CloudRuntimeStore {
  return {
    async claimFailedWorker() { return false },
    async claimRecycleWorker() { return false },
    async getActiveTokens() {
      return [
        { scope: "host", token: "host-token" },
        { scope: "client", token: "client-token" },
        { scope: "activity", token: "activity-token" },
      ]
    },
    async markProvisioningWorkerFailed() {},
    async markHealthyWorkerFailed() {},
  }
}

test("generic Daytona runtime routes refresh expiry and request only the fresh preview", async () => {
  const runtimeWorker = worker()
  const requested: string[] = []
  const result = await shared.fetchWorkerRuntimeJson({
    worker: runtimeWorker,
    path: "/runtime/versions",
  }, {
    resolveCloudAccess: (ownership) => access.resolveCloudRuntimeAccess(ownership, {
      loadWorker: async () => runtimeWorker,
      store: runtimeStore(),
      continueProvisioning: async () => {},
      getSandboxRecord: async () => ({
        signed_preview_url: "https://expired.preview.example.test",
        signed_preview_url_expires_at: new Date("2026-08-27T09:00:00.000Z"),
      }),
      refreshSignedPreview: async () => ({
        signed_preview_url: "https://fresh.preview.example.test",
        signed_preview_url_expires_at: new Date("2026-08-27T12:00:00.000Z"),
      }),
      inspectSandbox: async () => ({ state: "started" }),
      probeSignedPreview: async () => true,
      startWake: () => {},
      startRecovery: () => {},
      now: () => new Date("2026-08-27T10:00:00.000Z").getTime(),
    }),
    fetchImpl: async (input) => {
      requested.push(String(input))
      return Response.json({ version: "fresh" })
    },
  })

  expect(result).toEqual({ ok: true, status: 200, payload: { version: "fresh" } })
  expect(requested).toEqual(["https://fresh.preview.example.test/runtime/versions"])
  expect(requested.join(" ")).not.toContain("expired.preview.example.test")
})

test("Daytona instance persistence and API responses never expose an expiring preview as timeless", () => {
  const now = new Date("2026-08-27T10:00:00.000Z")
  const runtimeWorker = worker()
  const daytona = {
    id: createDenTypeId("workerInstance"),
    worker_id: runtimeWorker.id,
    provider: "daytona",
    region: "us",
    url: "https://stale.preview.example.test",
    status: "healthy",
    created_at: now,
    updated_at: now,
  } satisfies Parameters<SharedModule["toInstanceResponse"]>[0]
  const render = { ...daytona, provider: "render", url: "https://durable.render.example.test" }

  expect(shared.persistedWorkerInstanceUrl(daytona)).toEndWith("/v1/cloud/instance")
  expect(shared.persistedWorkerInstanceUrl(daytona)).not.toContain("stale.preview.example.test")
  expect(shared.toInstanceResponse(daytona)?.url).toBeNull()
  expect(shared.persistedWorkerInstanceUrl(render)).toBe("https://durable.render.example.test")
  expect(shared.toInstanceResponse(render)?.url).toBe("https://durable.render.example.test")
})

test("cloud create defaults to cloud-instance and tokens resolve a usable fresh URL", async () => {
  const sandboxBackend = shared.workerSandboxBackend({ destination: "cloud", sandboxBackend: undefined })
  const runtimeWorker = { ...worker(), sandbox_backend: sandboxBackend }
  const requested: string[] = []
  const resolved = await shared.getWorkerTokensAndConnect(runtimeWorker, {
    resolveCloudAccess: async () => ({
      status: "ready",
      workerId: runtimeWorker.id,
      url: "https://create-token.preview.example.test",
      expiresAt: new Date("2026-08-27T12:00:00.000Z"),
      clientToken: "client-token",
      hostToken: "host-token",
    }),
    fetchImpl: async (input) => {
      requested.push(String(input))
      return Response.json({ activeId: "created-workspace", items: [] })
    },
  })

  expect(sandboxBackend).toBe("cloud-instance")
  expect(resolved).toEqual({
    tokens: { owner: "host-token", host: "host-token", client: "client-token" },
    connect: {
      openworkUrl: "https://create-token.preview.example.test/w/created-workspace",
      workspaceId: "created-workspace",
    },
  })
  expect(requested).toEqual(["https://create-token.preview.example.test/workspaces"])
  expect(requested.join(" ")).not.toContain("workers.example.test")
})
