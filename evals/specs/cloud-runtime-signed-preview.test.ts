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
  process.env.DAYTONA_SNAPSHOT = "openwork-test-snapshot";
}

test("Cloud runtime access refreshes signed previews without old proxy routing", async ({ evidence }) => {
  seedRequiredEnv();
  const [
    { resolveCloudRuntimeAccess },
    { persistedWorkerInstanceUrl },
    { getWorker, getWorkerTokens, withWorkerConnection, workerNeedsConnectionResolution },
  ] = await Promise.all([
    import("../../ee/apps/den-api/src/workers/worker-access.js"),
    import("../../ee/apps/den-api/src/routes/workers/shared.js"),
    import("../../ee/apps/den-web/app/(den)/_lib/den-flow.js"),
  ]);
  const runtimeWorker: CloudRuntimeWorker = {
    id: createDenTypeId("worker"),
    name: "Cloud runtime proof",
    status: "healthy",
    image_version: "openwork-test-snapshot",
  };
  const runtimeStore: CloudRuntimeStore = {
    async claimFailedWorker() { return false; },
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
  const oldProxyUrl = `https://workers.example.test/${runtimeWorker.id}`;
  const requested: string[] = [];
  const result = await resolveCloudRuntimeAccess({
    organizationId: createDenTypeId("organization"),
    workerId: runtimeWorker.id,
  }, {
    loadWorker: async () => runtimeWorker,
    store: runtimeStore,
    continueProvisioning: async () => {},
    getSandboxRecord: async () => ({
      signed_preview_url: "https://expired.preview.example.test",
      signed_preview_url_expires_at: new Date("2026-08-27T09:00:00.000Z"),
    }),
    refreshSignedPreview: async () => ({
      signed_preview_url: "https://fresh.preview.example.test",
      signed_preview_url_expires_at: new Date("2026-08-27T12:00:00.000Z"),
    }),
    probeSignedPreview: async (url) => {
      requested.push(`${url}/health`);
      return true;
    },
    inspectSandbox: async () => ({ state: "started" }),
    startWake: () => {},
    now: () => new Date("2026-08-27T10:00:00.000Z").getTime(),
  });

  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("expected ready Cloud runtime");
  expect(result.url).toBe("https://fresh.preview.example.test");
  expect(result.expiresAt).toEqual(new Date("2026-08-27T12:00:00.000Z"));
  expect(result.clientToken).toBe("client-token");
  expect(result.hostToken).toBe("host-token");
  expect(requested).toEqual(["https://fresh.preview.example.test/health"]);
  expect(requested).not.toContain(oldProxyUrl);
  expect(requested.every((url) => new URL(url).hostname !== "workers.example.test")).toBe(true);
  const persistedUrl = persistedWorkerInstanceUrl({ provider: "daytona", url: result.url });
  expect(persistedUrl).toMatch(/\/v1\/cloud\/instance$/);
  expect(persistedUrl).not.toBe(result.url);
  const created = getWorker({
    worker: { id: runtimeWorker.id, name: runtimeWorker.name, status: "provisioning" },
    instance: null,
    tokens: { client: "client-token", owner: "host-token", host: "host-token" },
  });
  if (!created) throw new Error("create worker payload did not parse");
  expect(workerNeedsConnectionResolution(created)).toBe(true);
  const lateTokens = getWorkerTokens({
    tokens: { client: "client-token", owner: "host-token", host: "host-token" },
    connect: { openworkUrl: `${result.url}/w/workspace`, workspaceId: "workspace" },
  });
  if (!lateTokens) throw new Error("late worker token payload did not parse");
  const webWorker = withWorkerConnection(created, lateTokens);
  expect(webWorker.openworkUrl).toBe("https://fresh.preview.example.test/w/workspace");
  expect(workerNeedsConnectionResolution(webWorker)).toBe(false);
  evidence.recordAssertionEvidence(
    "Expired Daytona access resolves through a fresh signed preview only",
    "The resolver refreshed the expired preview, probed only the fresh URL, returned both runtime credentials, made no request to the removed proxy, persisted only a lifecycle URL, and the Web state adopted the late resolver URL after create returned tokens first.",
    true,
  );
});

test("Cloud Automation readiness starts after a stopped-worker wake", async ({ evidence }) => {
  seedRequiredEnv();
  const { resolveCloudAgentReadyWorker } = await import("../../ee/apps/den-api/src/automations/cloud-agent-executor.js");
  const workerId = createDenTypeId("worker");
  let now = 0;
  let wakeCalls = 0;
  let sleeps = 0;
  const result = await resolveCloudAgentReadyWorker({
    organizationId: createDenTypeId("organization"),
    ownerMemberId: createDenTypeId("member"),
  }, new AbortController().signal, {
    ownerUserId: async () => createDenTypeId("user"),
    resolveAccess: async () => {
      if (wakeCalls === 0) return { status: "waking", workerId, reason: "stopped" };
      if (now < 319_000) return { status: "waking", workerId, reason: "reprovisioning" };
      return {
        status: "ready",
        workerId,
        url: "https://post-wake.preview.example.test",
        expiresAt: new Date("2026-08-27T12:00:00.000Z"),
        clientToken: "client-token",
        hostToken: "host-token",
      };
    },
    wakeWorker: async () => {
      wakeCalls += 1;
      now += 200_000;
    },
    resolveWorkspace: async (access) => ({ baseUrl: access.url, workspaceId: "post-wake-workspace" }),
    now: () => now,
    sleep: async (ms) => {
      sleeps += 1;
      now += ms;
    },
  });

  expect(result.ok).toBe(true);
  expect(wakeCalls).toBe(1);
  expect(sleeps).toBe(119);
  expect(now).toBe(319_000);
  evidence.recordAssertionEvidence(
    "Cloud Automation keeps its readiness budget after wake",
    "A deterministic 200-second lifecycle wake completed once, then the runtime still received 119 seconds of readiness polling before succeeding.",
    true,
  );
});
