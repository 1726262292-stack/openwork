import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SyncedProvider } from "@openwork/types/den/provider-sync";

import { startDenProviderSync, type DenProviderSyncHandle } from "./den-provider-sync.js";
import {
  readProviderSyncState,
  writeProviderSyncState,
} from "./provider-sync-state.js";
import { readGlobalRuntimeOpencodeConfig, runtimeProviderMap } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

type HttpCall = { method: string; path: string; body: unknown; authorization: string | undefined };
type Closeable = { close: () => Promise<void> };

const roots: string[] = [];
const handles: DenProviderSyncHandle[] = [];
const servers: Closeable[] = [];

afterEach(async () => {
  while (handles.length) handles.pop()?.stop();
  while (servers.length) await servers.pop()?.close();
  while (roots.length) await rm(roots.pop() ?? "", { recursive: true, force: true });
});

function readRequestBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function startHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "test_server_failed" });
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port");
  const close = () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  const result = { baseUrl: `http://127.0.0.1:${address.port}`, close };
  servers.push(result);
  return result;
}

async function createConfig(engineBaseUrl?: string): Promise<ServerConfig> {
  const root = await mkdtemp(join(tmpdir(), "openwork-den-provider-sync-"));
  roots.push(root);
  return {
    host: "127.0.0.1",
    port: 0,
    token: "client-token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1_000 },
    corsOrigins: ["*"],
    workspaces: [{
      id: "ws_1",
      name: "Workspace",
      path: root,
      preset: "starter",
      workspaceType: "local",
      baseUrl: engineBaseUrl,
    }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
}

function syncedProvider(input: {
  id: string;
  localProviderId: string;
  name: string;
  updatedAt: string;
  baseUrl: string;
  modelId: string;
  modelName: string | null;
  apiKey?: string | null;
  apiKeys?: Record<string, string> | null;
  env?: string[];
  npm?: string;
}): SyncedProvider {
  return {
    id: input.id,
    localProviderId: input.localProviderId,
    name: input.name,
    source: "custom",
    providerId: null,
    updatedAt: input.updatedAt,
    baseUrl: input.baseUrl,
    npm: input.npm ?? "@ai-sdk/openai-compatible",
    env: input.env ?? [],
    apiKey: input.apiKey ?? null,
    apiKeys: input.apiKeys ?? null,
    models: [{ modelId: input.modelId, name: input.modelName, modelConfig: null }],
  };
}

describe("Den provider sync loop", () => {
  test("stays dormant without provider sync state", async () => {
    let requestCount = 0;
    const den = await startHttpServer((_request, response) => {
      requestCount += 1;
      sendJson(response, 500, { error: "unexpected_request" });
    });
    const config = await createConfig();
    const handle = startDenProviderSync({
      config,
      env: { OPENWORK_PROVIDER_SYNC_INTERVAL_MS: "60000" },
      envStore: { upsertMany: async () => undefined },
      fetchImpl: (url, init) => globalThis.fetch(url, init),
      reloadOpencodeEngine: async () => undefined,
    });
    handles.push(handle);

    await handle.kick();
    expect(requestCount).toBe(0);
    await writeProviderSyncState(config, {
      enabled: true,
      token: null,
      expiresAt: null,
      denBaseUrl: den.baseUrl,
      orgId: "org_1",
    });
    await handle.kick();
    expect(requestCount).toBe(0);
    expect(den.baseUrl).toStartWith("http://127.0.0.1:");
  });

  test("applies, refreshes, revokes, and purges synced providers", async () => {
    let now = Date.parse("2029-01-01T00:00:00.000Z");
    let denMode: "providers" | "not-modified" = "providers";
    let etag = "etag-1";
    let providers = [
      syncedProvider({
        id: "lpr_den_provider_one",
        localProviderId: "lpr_den_provider_one",
        name: "Org OpenAI",
        updatedAt: "2029-01-01T00:00:00.000Z",
        baseUrl: "https://api.openai.com/v1",
        modelId: "gpt-5",
        modelName: "GPT-5",
        apiKey: "org-openai-key",
        env: ["OPENAI_API_KEY"],
      }),
      syncedProvider({
        id: "lpr_den_provider_two",
        localProviderId: "lpr_den_provider_two",
        name: "Org Anthropic",
        updatedAt: "2029-01-01T00:00:00.000Z",
        baseUrl: "http://10.0.0.8/v1",
        modelId: "claude-sonnet-4-5",
        modelName: null,
        apiKeys: {
          ANTHROPIC_API_KEY: "org-anthropic-key",
          ANTHROPIC_REGION: "on-prem-region",
        },
        env: ["ANTHROPIC_API_KEY", "ANTHROPIC_REGION"],
        npm: "@ai-sdk/anthropic",
      }),
    ];
    const denCalls: HttpCall[] = [];
    const ifNoneMatches: Array<string | undefined> = [];
    const den = await startHttpServer(async (request, response) => {
      denCalls.push({
        method: request.method ?? "GET",
        path: request.url ?? "",
        body: await readRequestBody(request),
        authorization: request.headers.authorization,
      });
      if (request.url === "/v1/provider-sync/providers" && request.method === "GET") {
        ifNoneMatches.push(request.headers["if-none-match"]);
        if (denMode === "not-modified") {
          response.writeHead(304);
          response.end();
          return;
        }
        sendJson(response, 200, { providers, etag });
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    });

    const engineCalls: HttpCall[] = [];
    const syncEvents: string[] = [];
    const envUpserts: Array<{ key: string; value: string }> = [];
    const engine = await startHttpServer(async (request, response) => {
      syncEvents.push(`${request.method} ${request.url}`);
      engineCalls.push({
        method: request.method ?? "GET",
        path: request.url ?? "",
        body: await readRequestBody(request),
        authorization: request.headers.authorization,
      });
      sendJson(response, 200, { ok: true });
    });
    const config = await createConfig(engine.baseUrl);
    await writeProviderSyncState(config, {
      enabled: true,
      token: "provider-sync-jwt",
      expiresAt: new Date(now + 24 * 60 * 60_000).toISOString(),
      denBaseUrl: den.baseUrl,
      orgId: "org_1",
    });
    let reloadCount = 0;
    const handle = startDenProviderSync({
      config,
      env: { OPENWORK_PROVIDER_SYNC_INTERVAL_MS: "60000" },
      envStore: {
        upsertMany: async (entries) => {
          syncEvents.push("env upsert");
          envUpserts.push(...entries);
        },
      },
      now: () => now,
      fetchImpl: (url, init) => globalThis.fetch(url, init),
      engineFetchImpl: (url, init) => globalThis.fetch(url, init),
      reloadOpencodeEngine: async () => {
        syncEvents.push("reload");
        reloadCount += 1;
      },
    });
    handles.push(handle);
    await handle.kick();

    expect(reloadCount).toBe(1);
    expect(runtimeProviderMap(await readGlobalRuntimeOpencodeConfig(config))).toEqual({
      lpr_den_provider_one: {
        name: "Org OpenAI",
        npm: "@ai-sdk/openai-compatible",
        env: ["OPENAI_API_KEY"],
        options: { baseURL: "https://api.openai.com/v1" },
        models: { "gpt-5": { name: "GPT-5" } },
      },
      lpr_den_provider_two: {
        name: "Org Anthropic",
        npm: "@ai-sdk/anthropic",
        env: ["ANTHROPIC_API_KEY", "ANTHROPIC_REGION"],
        options: { baseURL: "http://10.0.0.8/v1" },
        models: { "claude-sonnet-4-5": {} },
      },
    });
    expect(engineCalls.map((call) => [call.method, call.path, call.body])).toEqual([
      ["PUT", "/auth/lpr_den_provider_one", { type: "api", key: "org-openai-key" }],
      ["PUT", "/auth/lpr_den_provider_two", { type: "api", key: "org-anthropic-key" }],
    ]);
    expect(envUpserts).toEqual([
      { key: "ANTHROPIC_API_KEY", value: "org-anthropic-key" },
      { key: "ANTHROPIC_REGION", value: "on-prem-region" },
    ]);
    expect(Object.keys(runtimeProviderMap(await readGlobalRuntimeOpencodeConfig(config)))).toEqual(
      providers.map((provider) => provider.localProviderId),
    );
    expect(engineCalls.slice(0, 2).map((call) => call.path)).toEqual(
      providers.map((provider) => `/auth/${provider.localProviderId}`),
    );
    expect(syncEvents.slice(0, 4)).toEqual([
      "env upsert",
      "PUT /auth/lpr_den_provider_one",
      "PUT /auth/lpr_den_provider_two",
      "reload",
    ]);
    expect(denCalls.every((call) => call.authorization === "Bearer provider-sync-jwt")).toBe(true);

    denMode = "not-modified";
    await handle.kick();
    expect(reloadCount).toBe(1);
    expect(engineCalls).toHaveLength(2);
    expect(ifNoneMatches.at(-1)).toBe("etag-1");

    denMode = "providers";
    etag = "etag-2";
    const retainedProvider = providers[0];
    if (!retainedProvider) throw new Error("Expected a retained provider");
    providers = [retainedProvider];
    await handle.kick();
    expect(reloadCount).toBe(2);
    expect(ifNoneMatches.at(-1)).toBe("etag-1");
    expect(Object.keys(runtimeProviderMap(await readGlobalRuntimeOpencodeConfig(config)))).toEqual([
      "lpr_den_provider_one",
    ]);
    expect(engineCalls.slice(2).map((call) => [call.method, call.path, call.body])).toEqual([
      ["DELETE", "/auth/lpr_den_provider_two", null],
    ]);

    denMode = "providers";
    etag = "etag-3";
    providers = [{
      ...retainedProvider,
      updatedAt: "2029-01-01T00:01:00.000Z",
      apiKey: "org-openai-key-rotated",
    }];
    await handle.kick();
    expect(reloadCount).toBe(2);
    expect(ifNoneMatches.at(-1)).toBe("etag-2");
    expect(engineCalls.slice(3).map((call) => [call.method, call.path, call.body])).toEqual([
      ["PUT", "/auth/lpr_den_provider_one", { type: "api", key: "org-openai-key-rotated" }],
    ]);
    expect(JSON.stringify(await readProviderSyncState(config))).not.toContain("org-openai-key");

    await writeProviderSyncState(config, {
      enabled: false,
      token: null,
      expiresAt: null,
      denBaseUrl: null,
      orgId: null,
    });
    await handle.kick();
    expect(reloadCount).toBe(3);
    expect(runtimeProviderMap(await readGlobalRuntimeOpencodeConfig(config))).toEqual({});
    expect(engineCalls.at(-1)).toMatchObject({
      method: "DELETE",
      path: "/auth/lpr_den_provider_one",
    });
    expect((await readProviderSyncState(config)).applied).toEqual({
      etag: null,
      providers: {},
    });
    now += 1;
  });

  test("makes 401 authorization failures dormant until state is rewritten", async () => {
    let providerRequests = 0;
    const den = await startHttpServer((request, response) => {
      if (request.url === "/v1/provider-sync/providers") providerRequests += 1;
      sendJson(response, 401, { error: "unauthorized" });
    });
    const config = await createConfig();
    const state = {
      enabled: true,
      token: "revoked-provider-sync-jwt",
      expiresAt: "2030-01-01T00:00:00.000Z",
      denBaseUrl: den.baseUrl,
      orgId: "org_1",
    };
    await writeProviderSyncState(config, state);
    const handle = startDenProviderSync({
      config,
      env: { OPENWORK_PROVIDER_SYNC_INTERVAL_MS: "60000" },
      envStore: { upsertMany: async () => undefined },
      now: () => Date.parse("2029-01-01T00:00:00.000Z"),
      fetchImpl: (url, init) => globalThis.fetch(url, init),
      reloadOpencodeEngine: async () => undefined,
    });
    handles.push(handle);
    await handle.kick();

    expect(providerRequests).toBe(1);
    expect((await readProviderSyncState(config)).lastError).toBe("provider_sync_authorization_failed:401");
    await handle.kick();
    expect(providerRequests).toBe(1);

    await writeProviderSyncState(config, state);
    await handle.kick();
    expect(providerRequests).toBe(2);
  });
});
