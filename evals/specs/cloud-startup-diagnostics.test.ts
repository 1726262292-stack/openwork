import { test } from "@openwork/testkit";
import { expect } from "vitest";
import { createDenTypeId } from "../../ee/packages/utils/src/typeid.js";
import type { CloudRuntimeStore, CloudRuntimeWorker } from "../../ee/apps/den-api/src/workers/worker-access.js";

function seedRequiredEnv() {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test";
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32);
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32);
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790";
  process.env.CORS_ORIGINS ??= "http://127.0.0.1:8790";
  process.env.PROVISIONER_MODE = "stub";
}

test("Cloud startup failures are diagnosable and explicitly retryable without leaking credentials", async ({ evidence }) => {
  seedRequiredEnv();
  const [failureModule, runtimeModule, gatewayModule, clientModule] = await Promise.all([
    import("../../ee/apps/den-api/src/workers/cloud-failure.js"),
    import("../../ee/apps/den-api/src/workers/worker-access.js"),
    import("../../ee/apps/den-gateway/src/app.js"),
    import("../../apps/app/src/app/lib/den.js"),
  ]);

  const failure = failureModule.createCloudStartupFailure({
    stage: "recovery",
    error: new Error("Timed out waiting for Daytona worker health\nAuthorization: Bearer runtime-secret"),
    now: () => new Date("2026-08-28T12:00:00.000Z"),
  });
  const publicFailure = failureModule.publicCloudStartupFailure(failure);
  expect(publicFailure.code).toBe("runtime_health_timeout");
  expect(JSON.stringify(publicFailure)).not.toContain("runtime-secret");
  evidence.recordAssertionEvidence(
    "A failed sandbox keeps a safe, correlated startup diagnosis",
    `The provider error normalized to ${publicFailure.code} at ${publicFailure.stage} with reference ${publicFailure.reference}; the public payload omitted the raw bearer-bearing error.`,
    true,
  );

  const worker: CloudRuntimeWorker = {
    id: createDenTypeId("worker"),
    name: "Cloud diagnostics proof",
    status: "failed",
  };
  let claimAttempts = 0;
  let provisionCalls = 0;
  const store: CloudRuntimeStore = {
    async claimFailedWorker() {
      claimAttempts += 1;
      return true;
    },
    async claimRecycleWorker() { return false; },
    async getActiveTokens() {
      return [
        { scope: "host", token: "host-token" },
        { scope: "client", token: "client-token" },
        { scope: "activity", token: "activity-token" },
      ];
    },
    async markProvisioningWorkerFailed() {},
    async markHealthyWorkerFailed() {},
  };
  const options = {
    continueProvisioning: async () => { provisionCalls += 1; },
    refreshSignedPreview: async () => null,
    getSandboxRecord: async () => null,
    inspectSandbox: async () => null,
    probeSignedPreview: async () => false,
    startWake: () => {},
    startRecovery: () => {},
    store,
    now: () => 1_000,
  };

  const first = await runtimeModule.resolveCloudRuntimeState({
    worker,
    organizationId: createDenTypeId("organization"),
  }, options);
  const passive = await runtimeModule.resolveCloudRuntimeState({
    worker,
    organizationId: createDenTypeId("organization"),
  }, options);
  const explicit = await runtimeModule.resolveCloudRuntimeState({
    worker,
    organizationId: createDenTypeId("organization"),
  }, { ...options, forceFailedRecovery: true });
  await Promise.resolve();
  await Promise.resolve();

  expect(first.status).toBe("provisioning");
  expect(passive.status).toBe("failed");
  expect(explicit.status).toBe("provisioning");
  expect(claimAttempts).toBe(2);
  expect(provisionCalls).toBe(2);
  evidence.recordAssertionEvidence(
    "Retry bypasses only the passive recovery cooldown",
    "The first failed resolve claimed recovery, a second passive resolve was throttled, and an explicit retry made exactly one new claim and provider attempt.",
    true,
  );

  const originalFetch = globalThis.fetch;
  const retryRequests: Array<{ method: string; path: string }> = [];
  const retryFetch: typeof fetch = async (input, init) => {
    const request = {
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
    };
    retryRequests.push(request);
    return request.path.endsWith("/retry")
      ? Response.json({ error: "not_found" }, { status: 404 })
      : Response.json({ status: "failed", url: null });
  };
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: retryFetch });
  let legacyRetry;
  try {
    legacyRetry = await clientModule
      .createDenClient({ baseUrl: "https://den.example.test", token: "den-token" })
      .retryCloudInstance("org_test");
  } finally {
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
  }

  expect(legacyRetry.status).toBe("failed");
  expect(retryRequests).toEqual([
    { method: "POST", path: "/api/den/v1/cloud/instance/retry" },
    { method: "GET", path: "/api/den/v1/cloud/instance" },
  ]);
  evidence.recordAssertionEvidence(
    "Retry stays compatible with a Den that predates explicit recovery",
    "When the explicit retry route returned 404, the client made one fallback request to the established instance-status route, preserved the failed workspace state, and did not repeat the unsupported POST.",
    true,
  );

  let instanceFetches = 0;
  const gateway = gatewayModule.createGatewayApp({
    denApiBase: "https://den.example.test",
    gatewayKey: "gateway-secret",
    logRequests: false,
    fetchImpl: async () => Response.json({
      status: "failed",
      url: null,
      clientToken: null,
      hostToken: null,
      expiresAt: null,
      failure: publicFailure,
    }),
    instanceFetch: async () => {
      instanceFetches += 1;
      return Response.json({ token: "must-not-be-reached" });
    },
  });
  const response = await gateway.fetch(new Request("https://web.example.test/workspaces", {
    headers: { Authorization: "Bearer browser-session-secret" },
  }));
  const payload = await response.json();

  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("5");
  expect(payload).toEqual({ error: "workspace_not_ready", status: "failed", failure: publicFailure });
  expect(JSON.stringify(payload)).not.toContain("browser-session-secret");
  expect(instanceFetches).toBe(0);
  evidence.recordAssertionEvidence(
    "The gateway reports not-ready as an error instead of a malformed success",
    "A failed workspace returned HTTP 503 workspace_not_ready with Retry-After: 5 and the safe diagnostic; the runtime was never proxied and browser credentials were absent.",
    true,
  );
});
