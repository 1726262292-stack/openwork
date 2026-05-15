import { afterEach, expect, test } from "bun:test";
import { createApp } from "./app.js";
import { createAppDependencies } from "./context/app-dependencies.js";

afterEach(() => {
  delete process.env.OPENWORK_TOKEN;
  delete process.env.OPENWORK_HOST_TOKEN;
});

function createTestApp(options?: { requireAuth?: boolean; seedRegistry?: boolean }) {
  if (options?.requireAuth) {
    process.env.OPENWORK_TOKEN = "client-token";
    process.env.OPENWORK_HOST_TOKEN = "host-token";
  }

  const dependencies = createAppDependencies({
    environment: "test",
    inMemory: true,
    legacy: {
      desktopDataDir: `/tmp/openwork-server-v2-test-desktop-${Math.random().toString(16).slice(2)}`,
      orchestratorDataDir: `/tmp/openwork-server-v2-test-orchestrator-${Math.random().toString(16).slice(2)}`,
    },
    runtime: {
      bootstrapPolicy: "disabled",
    },
    startedAt: new Date("2026-04-14T00:00:00.000Z"),
    version: "0.0.0-test",
  });

  if (options?.seedRegistry) {
    dependencies.persistence.registry.importLocalWorkspace({
      dataDir: "/tmp/openwork-phase5-local",
      displayName: "Alpha Local",
      status: "ready",
    });
    dependencies.persistence.registry.importRemoteWorkspace({
      baseUrl: "https://remote.example.com/w/alpha",
      directory: "/srv/remote-alpha",
      displayName: "Remote Alpha",
      legacyNotes: {
        source: "test",
      },
      remoteType: "openwork",
      remoteWorkspaceId: "alpha",
      serverAuth: { openworkToken: "secret" },
      serverBaseUrl: "https://remote.example.com",
      serverHostingKind: "self_hosted",
      serverLabel: "remote.example.com",
      workspaceStatus: "ready",
    });
  }

  return {
    app: createApp({ dependencies }),
    dependencies,
  };
}

test("root info uses the shared success envelope and route conventions", async () => {
  const { app } = createTestApp();
  const response = await app.request("http://openwork.local/");
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(response.headers.get("x-request-id")).toBe(body.meta.requestId);
  expect(body).toMatchObject({
    ok: true,
    data: {
      service: "openwork-server-v2",
      routes: {
        system: "/system",
        workspaces: "/workspaces",
        workspaceResource: "/workspaces/:workspaceId",
      },
      contract: {
        source: "hono-openapi",
        sdkPackage: "@openwork/server-sdk",
      },
    },
  });
});

test("system health returns a consistent envelope", async () => {
  const { app } = createTestApp();
  const response = await app.request("http://openwork.local/system/health");
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.data.status).toBe("ok");
  expect(body.data.database.kind).toBe("sqlite");
  expect(["ready", "warning"]).toContain(body.data.database.status);
});

test("system metadata includes phase 10 registry, runtime, and cutover state", async () => {
  const { app } = createTestApp();
  const response = await app.request("http://openwork.local/system/meta");
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.data.foundation.phase).toBe(10);
  expect(body.data.foundation.startup.registry.localServerId).toBe("srv_local");
  expect(body.data.foundation.startup.registry.hiddenWorkspaceIds).toHaveLength(2);
  expect(body.data.runtimeSupervisor.bootstrapPolicy).toBe("disabled");
});

test("openapi route is generated from the live Hono app", async () => {
  const { app } = createTestApp();
  const response = await app.request("http://openwork.local/openapi.json");
  const document = await response.json();

  expect(response.status).toBe(200);
  expect(document.openapi).toBe("3.1.0");
  expect(document.info.title).toBe("OpenWork Server V2");
  expect(document.paths["/system/health"].get.operationId).toBe("getSystemHealth");
  expect(document.paths["/system/meta"].get.operationId).toBe("getSystemMeta");
  expect(document.paths["/system/capabilities"].get.operationId).toBe("getSystemCapabilities");
  expect(document.paths["/system/status"].get.operationId).toBe("getSystemStatus");
  expect(document.paths["/system/opencode/health"].get.operationId).toBe("getSystemOpencodeHealth");
  expect(document.paths["/system/runtime/versions"].get.operationId).toBe("getSystemRuntimeVersions");
  expect(document.paths["/system/runtime/upgrade"].post.operationId).toBe("postSystemRuntimeUpgrade");
  expect(document.paths["/v1/app-version"].get.operationId).toBe("getV1AppVersion");
  expect(document.paths["/v1/workers"].get.operationId).toBe("getV1Workers");
  expect(document.paths["/v1/workers/{workerId}/tokens"].post.operationId).toBe("postV1WorkersByWorkerIdTokens");
  expect(document.paths["/v1/templates"].get.operationId).toBe("getV1Templates");
  expect(document.paths["/v1/templates"].post.operationId).toBe("postV1Templates");
  expect(document.paths["/v1/templates/{templateId}"].delete.operationId).toBe("deleteV1TemplatesByTemplateId");
  expect(document.paths["/v1/skills"].get.operationId).toBe("getV1Skills");
  expect(document.paths["/v1/skills"].post.operationId).toBe("postV1Skills");
  expect(document.paths["/v1/skill-hubs"].get.operationId).toBe("getV1SkillHubs");
  expect(document.paths["/v1/skill-hubs/{skillHubId}/skills"].post.operationId).toBe("postV1SkillHubsBySkillHubIdSkills");
  expect(document.paths["/v1/llm-providers"].get.operationId).toBe("getV1LlmProviders");
  expect(document.paths["/v1/llm-providers/{llmProviderId}/connect"].get.operationId).toBe("getV1LlmProvidersByLlmProviderIdConnect");
  expect(document.paths["/system/cloud/bootstrap"].get.operationId).toBe("getSystemCloudBootstrap");
  expect(document.paths["/dev/log"].get.operationId).toBe("getDevLog");
  expect(document.paths["/dev/log"].post.operationId).toBe("postDevLog");
  expect(document.paths["/v1/me"].get.operationId).toBe("getV1Me");
  expect(document.paths["/v1/me/orgs"].get.operationId).toBe("getV1MeOrgs");
  expect(document.paths["/v1/me/desktop-config"].get.operationId).toBe("getV1MeDesktopConfig");
  expect(document.paths["/v1/auth/desktop-handoff/exchange"].post.operationId).toBe("postV1AuthDesktopHandoffExchange");
  expect(document.paths["/api/auth/organization/set-active"].post.operationId).toBe("postApiAuthOrganizationSetActive");
  expect(document.paths["/workspaces/{workspaceId}/cloud/llm-providers/state"].get.operationId).toBe("getWorkspacesByWorkspaceIdCloudLlmProvidersState");
  expect(document.paths["/workspaces/{workspaceId}/cloud/llm-providers/sync"].post.operationId).toBe("postWorkspacesByWorkspaceIdCloudLlmProvidersSync");
  expect(document.paths["/workspaces/{workspaceId}/cloud/llm-providers/{cloudProviderId}"].put.operationId).toBe("putWorkspacesByWorkspaceIdCloudLlmProvidersByCloudProviderId");
  expect(document.paths["/workspaces/{workspaceId}/config/disabled-providers"].patch.operationId).toBe("patchWorkspacesByWorkspaceIdConfigDisabledProviders");
  expect(document.paths["/system/servers/connect"].post.operationId).toBe("postSystemServersConnect");
  expect(document.paths["/workspaces"].get.operationId).toBe("getWorkspaces");
  expect(document.paths["/workspaces/local"].post.operationId).toBe("postWorkspacesLocal");
  expect(document.paths["/workspaces/{workspaceId}/config"].get.operationId).toBe("getWorkspacesByWorkspaceIdConfig");
  expect(document.paths["/system/cloud-signin"].get.operationId).toBe("getSystemCloudSignin");
  expect(document.paths["/system/managed/mcps"].get.operationId).toBe("getSystemManagedMcps");
  expect(document.paths["/system/router/identities/telegram"].get.operationId).toBe("getSystemRouterIdentitiesTelegram");
  expect(document.paths["/workspaces/{workspaceId}/export"].get.operationId).toBe("getWorkspacesByWorkspaceIdExport");
  expect(document.paths["/workspaces/{workspaceId}/reload-events"].get.operationId).toBe("getWorkspacesByWorkspaceIdReloadEvents");
  expect(document.paths["/workspaces/{workspaceId}/sessions"].get.operationId).toBe("getWorkspacesByWorkspaceIdSessions");
  expect(document.paths["/workspaces/{workspaceId}/events"].get.operationId).toBe("getWorkspacesByWorkspaceIdEvents");
});

test("cloud compatibility routes proxy and persist cloud state through server-v2", async () => {
  const originalFetch = globalThis.fetch;
  const { app, dependencies } = createTestApp();

  dependencies.services.managed.upsertCloudSignin({
    auth: { authToken: "cloud-token" },
    cloudBaseUrl: "https://app.openworklabs.com",
    metadata: null,
    orgId: null,
    userId: null,
  });

  globalThis.fetch = (async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = init?.method ?? (typeof input === "string" || input instanceof URL ? "GET" : input.method ?? "GET");
    if (url.pathname === "/api/den/v1/app-version") {
      return new Response(JSON.stringify({ latestAppVersion: "0.11.212", minAppVersion: "0.11.207" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/api/den/v1/me") {
      return new Response(JSON.stringify({
        user: { id: "usr_1", email: "omar@example.com", name: "Omar" },
        session: { id: "ses_1" },
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/api/den/v1/me/orgs") {
      return new Response(JSON.stringify({
        orgs: [
          { id: "org_1", name: "Alpha", slug: "alpha", role: "owner", isActive: true },
          { id: "org_2", name: "Beta", slug: "beta", role: "member", isActive: false },
        ],
        activeOrgId: "org_1",
        activeOrgSlug: "alpha",
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/api/den/v1/me/desktop-config") {
      return new Response(JSON.stringify({
        allowedDesktopVersions: ["0.11.212"],
        blockZenModel: true,
        disallowNonCloudModels: true,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/api/den/v1/workers") {
      return new Response(JSON.stringify({
        workers: [{ id: "worker_1", name: "Worker One", status: "ready", instance: { url: "https://worker.example.com", provider: "daytona" }, isMine: true, createdAt: "2026-04-23T00:00:00.000Z" }],
      }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/den/v1/workers/worker_1/tokens") {
      return new Response(JSON.stringify({
        tokens: { client: "client-token", owner: "owner-token", host: "host-token" },
        connect: { openworkUrl: "https://worker.example.com", workspaceId: "ws_remote_1" },
      }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/den/v1/templates" && method === "GET") {
      return new Response(JSON.stringify({
        templates: [{ id: "tpl_1", organizationId: "org_1", name: "Starter", templateData: { preset: "starter" }, createdAt: null, updatedAt: null, creator: null }],
      }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/den/v1/templates" && method === "POST") {
      return new Response(JSON.stringify({
        template: { id: "tpl_2", organizationId: "org_1", name: "Created", templateData: { preset: "new" }, createdAt: null, updatedAt: null, creator: null },
      }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/den/v1/templates/tpl_2") {
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/den/v1/skills" && method === "GET") {
      return new Response(JSON.stringify({
        skills: [{ id: "skill_1", title: "Org Skill", description: null, skillText: "hello", shared: "org", updatedAt: null }],
      }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/den/v1/skills" && method === "POST") {
      return new Response(JSON.stringify({ id: "skill_2" }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/den/v1/skill-hubs") {
      return new Response(JSON.stringify({
        skillHubs: [{ id: "hub_1", name: "Hub One", skills: [{ id: "skill_1", title: "Org Skill", description: null, skillText: "hello", shared: "org", updatedAt: null }] }],
      }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/den/v1/skill-hubs/hub_1/skills") {
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/auth/organization/set-active") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    const [versionResponse, meResponse, orgsResponse, desktopConfigResponse, workersResponse, workerTokensResponse, templatesResponse, skillsResponse, skillHubsResponse] = await Promise.all([
      app.request("http://openwork.local/v1/app-version"),
      app.request("http://openwork.local/v1/me"),
      app.request("http://openwork.local/v1/me/orgs"),
      app.request("http://openwork.local/v1/me/desktop-config"),
      app.request("http://openwork.local/v1/workers?limit=20"),
      app.request("http://openwork.local/v1/workers/worker_1/tokens", { method: "POST" }),
      app.request("http://openwork.local/v1/templates"),
      app.request("http://openwork.local/v1/skills"),
      app.request("http://openwork.local/v1/skill-hubs"),
    ]);

    expect(versionResponse.status).toBe(200);
    expect(await versionResponse.json()).toMatchObject({ latestAppVersion: "0.11.212", minAppVersion: "0.11.207" });
    expect(meResponse.status).toBe(200);
    expect(await meResponse.json()).toMatchObject({ user: { id: "usr_1", email: "omar@example.com" } });
    expect(orgsResponse.status).toBe(200);
    expect(await orgsResponse.json()).toMatchObject({ activeOrgId: "org_1", activeOrgSlug: "alpha" });
    expect(desktopConfigResponse.status).toBe(200);
    expect(await desktopConfigResponse.json()).toMatchObject({ blockZenModel: true, disallowNonCloudModels: true });
    expect(workersResponse.status).toBe(200);
    expect(await workersResponse.json()).toMatchObject({ workers: [{ workerId: "worker_1", workerName: "Worker One" }] });
    expect(workerTokensResponse.status).toBe(200);
    expect(await workerTokensResponse.json()).toMatchObject({ tokens: { client: "client-token" } });
    expect(templatesResponse.status).toBe(200);
    expect(await templatesResponse.json()).toMatchObject({ templates: [{ id: "tpl_1", name: "Starter" }] });
    expect(skillsResponse.status).toBe(200);
    expect(await skillsResponse.json()).toMatchObject({ skills: [{ id: "skill_1", title: "Org Skill" }] });
    expect(skillHubsResponse.status).toBe(200);
    expect(await skillHubsResponse.json()).toMatchObject({ skillHubs: [{ id: "hub_1", name: "Hub One" }] });

    const createTemplateResponse = await app.request("http://openwork.local/v1/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Created", templateData: { preset: "new" } }),
    });
    expect(createTemplateResponse.status).toBe(200);
    expect(await createTemplateResponse.json()).toMatchObject({ template: { id: "tpl_2", name: "Created" } });

    const deleteTemplateResponse = await app.request("http://openwork.local/v1/templates/tpl_2", { method: "DELETE" });
    expect(deleteTemplateResponse.status).toBe(200);
    expect(await deleteTemplateResponse.json()).toMatchObject({ ok: true });

    const createSkillResponse = await app.request("http://openwork.local/v1/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillText: "hello", shared: "org" }),
    });
    expect(createSkillResponse.status).toBe(200);
    expect(await createSkillResponse.json()).toMatchObject({ id: "skill_2" });

    const addSkillToHubResponse = await app.request("http://openwork.local/v1/skill-hubs/hub_1/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "skill_2" }),
    });
    expect(addSkillToHubResponse.status).toBe(200);
    expect(await addSkillToHubResponse.json()).toMatchObject({ ok: true });

    const setActiveResponse = await app.request("http://openwork.local/api/auth/organization/set-active", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ organizationId: "org_2" }),
    });

    expect(setActiveResponse.status).toBe(200);
    expect(await setActiveResponse.json()).toMatchObject({ ok: true, activeOrgId: "org_1", activeOrgSlug: "alpha" });
    expect(dependencies.persistence.repositories.cloudSignin.getPrimary()?.metadata).toMatchObject({
      activeOrgName: "Alpha",
      activeOrgSlug: "alpha",
      validatedUser: { id: "usr_1", email: "omar@example.com", name: "Omar" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cloud bootstrap and dev log routes expose the remaining compatibility surfaces", async () => {
  const originalDevLog = process.env.OPENWORK_DEV_LOG_FILE;
  const { app } = createTestApp();
  const tempLogPath = `/tmp/openwork-server-v2-dev-log-${Math.random().toString(16).slice(2)}.jsonl`;
  process.env.OPENWORK_DEV_LOG_FILE = tempLogPath;

  try {
    const bootstrapResponse = await app.request("http://openwork.local/system/cloud/bootstrap");
    const bootstrapBody = await bootstrapResponse.json();
    expect(bootstrapResponse.status).toBe(200);
    expect(bootstrapBody.data).toMatchObject({
      apiBaseUrl: expect.any(String),
      baseUrl: expect.any(String),
      requireSignin: false,
    });

    const probeResponse = await app.request("http://openwork.local/dev/log");
    const probeBody = await probeResponse.json();
    expect(probeResponse.status).toBe(200);
    expect(probeBody).toMatchObject({ ok: true, path: tempLogPath });

    const appendResponse = await app.request("http://openwork.local/dev/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ scope: "test", value: 1 }]),
    });
    const appendBody = await appendResponse.json();
    expect(appendResponse.status).toBe(200);
    expect(appendBody).toMatchObject({ ok: true, count: 1 });
  } finally {
    if (originalDevLog === undefined) {
      delete process.env.OPENWORK_DEV_LOG_FILE;
    } else {
      process.env.OPENWORK_DEV_LOG_FILE = originalDevLog;
    }
  }
});

test("runtime routes expose the initial server-owned status surfaces", async () => {
  const { app } = createTestApp();

  const [opencodeResponse, routerResponse, runtimeResponse] = await Promise.all([
    app.request("http://openwork.local/system/opencode/health"),
    app.request("http://openwork.local/system/router/health"),
    app.request("http://openwork.local/system/runtime/summary"),
  ]);

  const opencodeBody = await opencodeResponse.json();
  const routerBody = await routerResponse.json();
  const runtimeBody = await runtimeResponse.json();

  expect(opencodeResponse.status).toBe(200);
  expect(opencodeBody.data.status).toBe("disabled");
  expect(routerBody.data.status).toBe("disabled");
  expect(runtimeBody.data.bootstrapPolicy).toBe("disabled");
});

test("not found routes use the shared error envelope", async () => {
  const { app } = createTestApp();
  const response = await app.request("http://openwork.local/nope");
  const body = await response.json();

  expect(response.status).toBe(404);
  expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
  expect(body).toMatchObject({
    ok: false,
    error: {
      code: "not_found",
    },
  });
});

test("system status reports registry summary and capabilities", async () => {
  const { app } = createTestApp({ seedRegistry: true });
  const response = await app.request("http://openwork.local/system/status");
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.data.registry).toMatchObject({
    hiddenWorkspaceCount: 2,
    remoteServerCount: 1,
    totalServers: 2,
    visibleWorkspaceCount: 2,
  });
  expect(body.data.capabilities.transport.v2).toBe(true);
  expect(body.data.capabilities.registry.remoteServerConnections).toBe(true);
  expect(body.data.auth.required).toBe(false);
});

test("workspace list excludes hidden workspaces by default", async () => {
  const { app } = createTestApp({ seedRegistry: true });
  const response = await app.request("http://openwork.local/workspaces");
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.data.items).toHaveLength(2);
  expect(body.data.items.map((item: any) => item.displayName).sort()).toEqual(["Alpha Local", "Remote Alpha"]);
  expect(body.data.items.find((item: any) => item.displayName === "Remote Alpha")?.backend.kind).toBe("remote_openwork");
});

test("workspace detail hides internal workspaces from non-host readers", async () => {
  const { app, dependencies } = createTestApp({ requireAuth: true, seedRegistry: true });
  const hiddenWorkspaceId = dependencies.persistence.registry.ensureHiddenWorkspace("control").id;

  const clientResponse = await app.request(`http://openwork.local/workspaces/${hiddenWorkspaceId}`, {
    headers: {
      Authorization: "Bearer client-token",
    },
  });
  const hostResponse = await app.request(`http://openwork.local/workspaces/${hiddenWorkspaceId}`, {
    headers: {
      "X-OpenWork-Host-Token": "host-token",
    },
  });

  expect(clientResponse.status).toBe(404);
  expect(hostResponse.status).toBe(200);
});

test("auth-protected registry reads require client or host scope", async () => {
  const { app } = createTestApp({ requireAuth: true, seedRegistry: true });

  const anonymous = await app.request("http://openwork.local/workspaces");
  const client = await app.request("http://openwork.local/workspaces", {
    headers: {
      Authorization: "Bearer client-token",
    },
  });
  const clientHidden = await app.request("http://openwork.local/workspaces?includeHidden=true", {
    headers: {
      Authorization: "Bearer client-token",
    },
  });
  const hostInventory = await app.request("http://openwork.local/system/servers", {
    headers: {
      "X-OpenWork-Host-Token": "host-token",
    },
  });

  expect(anonymous.status).toBe(401);
  expect(client.status).toBe(200);
  expect(clientHidden.status).toBe(403);
  expect(hostInventory.status).toBe(200);
});

test("host-scoped remote server connect syncs remote workspaces into the local registry", async () => {
  const remote = Bun.serve({
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/workspaces") {
        return Response.json({
          ok: true,
          data: {
            items: [
              {
                backend: {
                  kind: "local_opencode",
                  local: { configDir: "/srv/config", dataDir: "/srv/project-alpha", opencodeProjectId: null },
                  remote: null,
                  serverId: "srv_local",
                },
                createdAt: new Date().toISOString(),
                displayName: "Remote Project Alpha",
                hidden: false,
                id: "remote-alpha",
                kind: "local",
                notes: null,
                preset: "starter",
                runtime: { backendKind: "local_opencode", health: null, lastError: null, lastSessionRefreshAt: null, lastSyncAt: null, updatedAt: null },
                server: { auth: { configured: false, scheme: "none" }, baseUrl: null, capabilities: {}, hostingKind: "self_hosted", id: "srv_local", isEnabled: true, isLocal: true, kind: "local", label: "Remote", lastSeenAt: null, source: "seeded", updatedAt: new Date().toISOString() },
                slug: "remote-project-alpha",
                status: "ready",
                updatedAt: new Date().toISOString(),
              },
            ],
          },
          meta: { requestId: "owreq_remote_1", timestamp: new Date().toISOString() },
        });
      }
      return new Response("not found", { status: 404 });
    },
    hostname: "127.0.0.1",
    port: 0,
  });

  try {
    const { app } = createTestApp({ requireAuth: true });
    const response = await app.request("http://openwork.local/system/servers/connect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenWork-Host-Token": "host-token",
      },
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${remote.port}`,
        token: "remote-token",
        workspaceId: "remote-alpha",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.server.kind).toBe("remote");
    expect(body.data.selectedWorkspaceId).toMatch(/^ws_/);
    expect(body.data.workspaces[0].backend.kind).toBe("remote_openwork");
    expect(body.data.workspaces[0].backend.remote.remoteWorkspaceId).toBe("remote-alpha");
  } finally {
    remote.stop(true);
  }
});

test("remote server connect returns a gateway error when the remote server rejects credentials", async () => {
  const remote = Bun.serve({
    fetch() {
      return Response.json({ ok: false, error: { code: "unauthorized", message: "bad token", requestId: "owreq_remote_bad_auth" } }, { status: 401 });
    },
    hostname: "127.0.0.1",
    port: 0,
  });

  try {
    const { app } = createTestApp({ requireAuth: true });
    const response = await app.request("http://openwork.local/system/servers/connect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenWork-Host-Token": "host-token",
      },
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${remote.port}`,
        token: "wrong-token",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("bad_gateway");
  } finally {
    remote.stop(true);
  }
});
