import { createServer, type Server } from "node:http";
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

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("Cloud runtime access refreshes signed previews behind stable legacy routing", async ({ evidence }) => {
  seedRequiredEnv();
  const [
    { probeCloudRuntimeSignedPreview, resolveCloudRuntimeAccess },
    { getWorkerTokensAndConnect, persistedWorkerInstanceUrl },
    { proxyCloudWorkerCompatibilityRequest },
    { getWorker, getWorkerTokens, withWorkerConnection, workerNeedsConnectionResolution },
  ] = await Promise.all([
    import("../../ee/apps/den-api/src/workers/worker-access.js"),
    import("../../ee/apps/den-api/src/routes/workers/shared.js"),
    import("../../ee/apps/den-api/src/workers/worker-compatibility-proxy.js"),
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
  const legacyWorker = {
    id: runtimeWorker.id,
    org_id: createDenTypeId("organization"),
    created_by_user_id: createDenTypeId("user"),
    name: runtimeWorker.name,
    description: null,
    destination: "cloud",
    status: "healthy",
    image_version: runtimeWorker.image_version ?? null,
    workspace_path: null,
    sandbox_backend: "cloud-instance",
    last_heartbeat_at: null,
    last_active_at: null,
    created_at: new Date("2026-08-27T08:00:00.000Z"),
    updated_at: new Date("2026-08-27T09:00:00.000Z"),
  } satisfies Parameters<typeof getWorkerTokensAndConnect>[0];
  const resolveTokenAccess = async () => result;
  const legacyTokens = await getWorkerTokensAndConnect(legacyWorker, {
    apiPublicUrl: "https://api.example.test/api/den",
    resolveCloudAccess: resolveTokenAccess,
    fetchImpl: async () => Response.json({ activeId: "workspace", items: [] }),
  });
  const webTokens = await getWorkerTokensAndConnect(legacyWorker, {
    apiPublicUrl: "https://api.example.test/api/den",
    includeExpiringOpenworkUrl: true,
    resolveCloudAccess: resolveTokenAccess,
    fetchImpl: async () => Response.json({ activeId: "workspace", items: [] }),
  });
  if (!("connect" in legacyTokens) || !legacyTokens.connect) throw new Error("legacy worker tokens did not include a stable route");
  if (!("connect" in webTokens) || !webTokens.connect) throw new Error("Web worker tokens did not include a preview route");
  expect(legacyTokens.connect.openworkUrl).toBe(`https://api.example.test/api/den/v1/cloud/workers/${runtimeWorker.id}/w/workspace`);
  expect(legacyTokens.connect.openworkUrl).not.toContain("preview.example.test");
  expect(webTokens.connect.openworkUrl).toBe("https://fresh.preview.example.test/w/workspace");
  const legacyStableRoot = legacyTokens.connect.openworkUrl.replace(/\/w\/[^/]+$/, "");
  const legacyProxyTargets: string[] = [];
  const legacyProxyResponse = await proxyCloudWorkerCompatibilityRequest({
    request: new Request(`${legacyStableRoot}/workspaces?published=1`, {
      headers: { Authorization: "Bearer client-token" },
    }),
    workerId: runtimeWorker.id,
  }, {
    authenticate: async ({ request, workerId }) => request.headers.get("authorization") === "Bearer client-token" && workerId === runtimeWorker.id
      ? { organizationId: legacyWorker.org_id, scope: "client" }
      : null,
    resolveCloudAccess: async () => ({
      ...result,
      status: "ready",
      url: "https://refreshed-after-token.preview.example.test",
    }),
    fetchImpl: async (url) => {
      legacyProxyTargets.push(String(url));
      return Response.json({ activeId: "workspace", items: [] });
    },
  });
  expect(legacyProxyResponse.status).toBe(200);
  expect(legacyProxyTargets).toEqual(["https://refreshed-after-token.preview.example.test/workspaces?published=1"]);
  const created = getWorker({
    worker: { id: runtimeWorker.id, name: runtimeWorker.name, status: "provisioning" },
    instance: null,
    tokens: { client: "client-token", owner: "host-token", host: "host-token" },
  });
  if (!created) throw new Error("create worker payload did not parse");
  expect(workerNeedsConnectionResolution(created)).toBe(true);
  const lateTokens = getWorkerTokens(webTokens);
  if (!lateTokens) throw new Error("late worker token payload did not parse");
  const webWorker = withWorkerConnection(created, lateTokens);
  expect(webWorker.openworkUrl).toBe("https://fresh.preview.example.test/w/workspace");
  expect(workerNeedsConnectionResolution(webWorker)).toBe(false);

  let redirectedTargetHit = false;
  const target = createServer((_request, response) => {
    redirectedTargetHit = true;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  const sandbox = createServer((_request, response) => {
    const address = target.address();
    if (!address || typeof address === "string") throw new Error("redirect target did not bind");
    response.writeHead(302, { location: `http://127.0.0.1:${address.port}/internal-health` });
    response.end();
  });
  await Promise.all([listen(target), listen(sandbox)]);
  try {
    const address = sandbox.address();
    if (!address || typeof address === "string") throw new Error("sandbox server did not bind");
    expect(await probeCloudRuntimeSignedPreview(`http://127.0.0.1:${address.port}`)).toBe(false);
    expect(redirectedTargetHit).toBe(false);
  } finally {
    await Promise.all([close(target), close(sandbox)]);
  }
  evidence.recordAssertionEvidence(
    "Published desktops keep a stable worker URL while Daytona previews refresh",
    "A legacy empty token request received a non-null configured Den API worker route with its workspace mount and no preview hostname; the existing client token reached a separately refreshed preview through that stable route. Web opt-in still received the direct fresh preview, the removed standalone worker host was never used, persistence kept only a lifecycle URL, and a sandbox-controlled redirect was rejected.",
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
