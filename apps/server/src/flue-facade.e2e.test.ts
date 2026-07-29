import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasRegisteredProvider, resolveModel } from "@flue/runtime/internal";
import type { Provider } from "@openwork/engine-protocol";

import { FLUE_CATALOG_CACHE_FILE, FlueCatalogBridge, resetFlueCatalogCacheForTest } from "./flue/catalog.js";
import { openworkRuntimeConfigFilePath, writeOpenworkRuntimeConfigFile } from "./openwork-runtime-config.js";
import { writeGlobalRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
const previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;
const previousMistralApiKey = process.env.MISTRAL_API_KEY;
const previousConnectedMistralApiKey = process.env.OPENWORK_FLUE_E2E_MISTRAL_KEY;
const providerEnvNames = [
  "ANTHROPIC_API_KEY",
  "PROBE_PICKER_EVAL_API_KEY",
  "OPENROUTER_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "AWS_BEARER_TOKEN_BEDROCK",
];
const previousProviderEnv = new Map(providerEnvNames.map((name) => [name, process.env[name]]));

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  resetFlueCatalogCacheForTest();
  while (roots.length) await rm(roots.pop() ?? "", { recursive: true, force: true });
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
  if (previousMistralApiKey === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = previousMistralApiKey;
  if (previousConnectedMistralApiKey === undefined) delete process.env.OPENWORK_FLUE_E2E_MISTRAL_KEY;
  else process.env.OPENWORK_FLUE_E2E_MISTRAL_KEY = previousConnectedMistralApiKey;
  for (const name of providerEnvNames) {
    const previous = previousProviderEnv.get(name);
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string) {
  return { ...auth(token), "Content-Type": "application/json" };
}

async function createWorkspaceRoot() {
  const root = await mkdtemp(join(tmpdir(), "openwork-flue-facade-"));
  roots.push(root);
  process.env.OPENWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  await mkdir(join(root, ".opencode"), { recursive: true });
  return root;
}

function startMockOpencode() {
  const requests: Array<{ pathname: string; method: string }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push({ pathname: url.pathname, method: request.method });
      if (url.pathname === "/global/health") {
        return Response.json({ healthy: true, version: "mock-opencode" });
      }
      if (url.pathname === "/session") {
        return Response.json([]);
      }
      return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
    },
  });
  stops.push(() => server.stop(true));
  return { server, requests };
}

async function startOpenworkServer(workspaceRoot: string, opencodeBaseUrl: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [
      {
        id: "ws_1",
        name: "Workspace",
        path: workspaceRoot,
        preset: "starter",
        workspaceType: "local",
        baseUrl: opencodeBaseUrl,
      },
    ],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  return { base: `http://127.0.0.1:${server.port}`, token: config.token, config };
}

function deterministicProvider(): Provider {
  return {
    id: "flue",
    name: "Flue",
    source: "custom",
    env: [],
    options: {},
    models: {},
  };
}

async function seedEmptyCatalog(workspaceRoot: string): Promise<void> {
  await seedCatalog(workspaceRoot, {});
}

async function seedCatalog(workspaceRoot: string, payload: unknown): Promise<void> {
  const bridge = new FlueCatalogBridge({
    cachePath: join(workspaceRoot, FLUE_CATALOG_CACHE_FILE),
    resolveModelsUrl: async () => "https://models.example.test",
    fetchCatalog: async () => ({
      ok: true,
      status: 200,
      async json(): Promise<unknown> {
        return payload;
      },
    }),
  });
  await bridge.materialize({
    runtimeConfig: {},
    envStore: {},
    processEnv: {},
    deterministicProvider: deterministicProvider(),
  });
}

async function configureDenRuntimeProvider(config: ServerConfig): Promise<void> {
  await writeGlobalRuntimeOpencodeConfig(config, () => ({
    provider: {
      "den-import": {
        id: "den-import",
        name: "Den Imported Provider",
        npm: "@ai-sdk/openai-compatible",
        env: ["DEN_IMPORT_API_KEY"],
        api: "http://127.0.0.1:1/v1",
        models: {
          "den-model": {
            name: "Den Model",
            limit: { context: 4_096, output: 512 },
          },
        },
      },
    },
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  expect(response.ok).toBe(true);
  return response.json();
}

function readStringField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field : "";
}

function readNumberField(value: unknown, key: string): number {
  if (!isRecord(value)) return Number.NaN;
  const field = value[key];
  return typeof field === "number" ? field : Number.NaN;
}

function providerFromList(value: unknown, providerId: string): Record<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.all)) return null;
  for (const provider of value.all) {
    if (isRecord(provider) && provider.id === providerId) return provider;
  }
  return null;
}

function stringListField(value: unknown, key: string): string[] {
  if (!isRecord(value) || !Array.isArray(value[key])) return [];
  return value[key].filter((item): item is string => typeof item === "string");
}

function materializationSkips(logs: unknown[][]): unknown[] {
  const skips: unknown[] = [];
  for (const log of logs) {
    for (const value of log) {
      if (isRecord(value) && Array.isArray(value.skipped)) skips.push(...value.skipped);
    }
  }
  return skips;
}

function sessionIdFromCreateResponse(value: unknown): string {
  if (!isRecord(value)) return "";
  const id = readStringField(value, "id");
  if (id) return id;
  const item = value.item;
  return isRecord(item) ? readStringField(item, "id") : "";
}

function assistantTextFromSnapshot(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.item) || !Array.isArray(value.item.messages)) return "";
  for (const message of value.item.messages) {
    if (!isRecord(message) || !isRecord(message.info) || message.info.role !== "assistant" || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (isRecord(part) && part.type === "text" && typeof part.text === "string" && part.text.trim()) return part.text;
    }
  }
  return "";
}

function messageInfo(value: unknown, role: "user" | "assistant"): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  for (const message of value) {
    if (isRecord(message) && isRecord(message.info) && message.info.role === role) return message.info;
  }
  return null;
}

async function waitForCompletedMessages(base: string, token: string, sessionId: string): Promise<unknown> {
  for (let index = 0; index < 100; index += 1) {
    const messages = await readJson(await fetch(`${base}/w/ws_1/opencode/session/${encodeURIComponent(sessionId)}/message`, {
      headers: auth(token),
    }));
    const assistant = messageInfo(messages, "assistant");
    if (assistant && isRecord(assistant.time) && typeof assistant.time.completed === "number") return messages;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

async function waitForAssistantText(base: string, token: string, sessionId: string): Promise<string> {
  for (let index = 0; index < 50; index += 1) {
    const snapshot = await readJson(await fetch(`${base}/workspace/ws_1/sessions/${encodeURIComponent(sessionId)}/snapshot`, {
      headers: auth(token),
    }));
    const text = assistantTextFromSnapshot(snapshot);
    if (text) return text;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return "";
}

async function nextSseData(response: Response): Promise<unknown> {
  const body = response.body;
  if (!body) throw new Error("missing SSE body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (let index = 0; index < 50; index += 1) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
          setTimeout(() => resolve({ done: true, value: undefined }), 20);
        }),
      ]);
      if (chunk.done) continue;
      buffer += decoder.decode(chunk.value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim())
          .join("\n");
        if (!data) continue;
        const parsed: unknown = JSON.parse(data);
        return parsed;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return null;
}

describe("Flue opencode-wire facade", () => {
  test("defaults to opencode, then routes flue workspaces in-process", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const { base, token } = await startOpenworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);

    await expect(readJson(await fetch(`${base}/workspace/ws_1/engine`, { headers: auth(token) }))).resolves.toEqual({ engine: "opencode" });

    await expect(readJson(await fetch(`${base}/workspace/ws_1/opencode/global/health`, { headers: auth(token) }))).resolves.toEqual({
      healthy: true,
      version: "mock-opencode",
    });
    await expect(readJson(await fetch(`${base}/w/ws_1/opencode/global/health`, { headers: auth(token) }))).resolves.toEqual({
      healthy: true,
      version: "mock-opencode",
    });
    expect(mock.requests.map((request) => request.pathname)).toEqual(["/global/health", "/global/health"]);

    await expect(readJson(await fetch(`${base}/workspace/ws_1/engine`, {
      method: "PATCH",
      headers: jsonHeaders(token),
      body: JSON.stringify({ engine: "flue" }),
    }))).resolves.toMatchObject({ engine: "flue" });

    await expect(readJson(await fetch(`${base}/workspace/ws_1/opencode/global/health`, { headers: auth(token) }))).resolves.toEqual({
      healthy: true,
      version: "flue-compat-v1",
    });
    await expect(readJson(await fetch(`${base}/w/ws_1/opencode/global/health`, { headers: auth(token) }))).resolves.toEqual({
      healthy: true,
      version: "flue-compat-v1",
    });
    await expect(readJson(await fetch(`${base}/opencode/global/health`, { headers: auth(token) }))).resolves.toEqual({
      healthy: true,
      version: "flue-compat-v1",
    });
    expect(mock.requests.map((request) => request.pathname)).toEqual(["/global/health", "/global/health"]);
  });

  test("creates sessions, emits SSE, and completes a deterministic Flue prompt", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const { base, token } = await startOpenworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);
    await readJson(await fetch(`${base}/workspace/ws_1/engine`, {
      method: "PATCH",
      headers: jsonHeaders(token),
      body: JSON.stringify({ engine: "flue" }),
    }));

    const eventController = new AbortController();
    const events = await fetch(`${base}/workspace/ws_1/opencode/event`, { headers: auth(token), signal: eventController.signal });
    expect(events.ok).toBe(true);

    const created = await readJson(await fetch(`${base}/workspace/ws_1/opencode/session`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ title: "Flue dolphins" }),
    }));
    const sessionId = sessionIdFromCreateResponse(created);
    expect(sessionId.startsWith("ses_")).toBe(true);

    const event = await nextSseData(events);
    eventController.abort();
    expect(event).toMatchObject({ type: "session.created", properties: { sessionID: sessionId } });

    const promptResponse = await fetch(`${base}/workspace/ws_1/opencode/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        model: { providerID: "flue", modelID: "default" },
        parts: [{ type: "text", text: "Research dolphins." }],
      }),
    });
    expect({ status: promptResponse.status, body: await promptResponse.text() }).toEqual({ status: 204, body: "" });

    await expect(readJson(await fetch(`${base}/workspace/ws_1/sessions`, { headers: auth(token) }))).resolves.toMatchObject({
      items: [{ id: sessionId, title: "Flue dolphins", directory: workspaceRoot }],
    });
    await expect(waitForAssistantText(base, token, sessionId)).resolves.toBe("Flue received: Research dolphins.");

    const messages = await waitForCompletedMessages(base, token, sessionId);
    const assistant = messageInfo(messages, "assistant");
    expect(assistant).toMatchObject({
      role: "assistant",
      providerID: "flue",
      modelID: "default",
      cost: 0,
      finish: "stop",
    });
    const tokens = assistant?.tokens;
    expect(readNumberField(tokens, "input")).toBeGreaterThan(0);
    expect(readNumberField(tokens, "output")).toBeGreaterThan(0);
    expect(readNumberField(tokens, "reasoning")).toBe(0);
    expect(readNumberField(tokens, "total")).toBe(
      readNumberField(tokens, "input")
      + readNumberField(tokens, "output")
      + readNumberField(isRecord(tokens) ? tokens.cache : null, "read")
      + readNumberField(isRecord(tokens) ? tokens.cache : null, "write"),
    );
  });

  test("lists Den runtime-map keys as provider identities with and without credentials", async () => {
    delete process.env.MISTRAL_API_KEY;
    process.env.OPENWORK_FLUE_E2E_MISTRAL_KEY = "runtime-map-test-key";
    const workspaceRoot = await createWorkspaceRoot();
    await seedCatalog(workspaceRoot, {
      mistral: {
        id: "mistral",
        name: "Mistral",
        npm: "@ai-sdk/mistral",
        env: ["MISTRAL_API_KEY"],
        api: "https://api.mistral.ai/v1",
        models: {
          "mistral-small-latest": {
            name: "Mistral Small",
            limit: { context: 32_000, output: 4_096 },
          },
        },
      },
    });
    const mock = startMockOpencode();
    const { base, token, config } = await startOpenworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);
    await writeGlobalRuntimeOpencodeConfig(config, () => ({
      disabled_providers: ["lpr_disabled"],
      provider: {
        lpr_demo: {
          id: "mistral",
          name: "Org Mistral (Den)",
          env: ["MISTRAL_API_KEY"],
          models: {
            "mistral-small-latest": { id: "mistral-small-latest", name: "Mistral Small" },
          },
        },
        lpr_connected: {
          id: "mistral",
          name: "Credentialed Org Mistral (Den)",
          env: ["OPENWORK_FLUE_E2E_MISTRAL_KEY"],
          models: {
            "mistral-small-latest": { id: "mistral-small-latest", name: "Mistral Small" },
          },
        },
        lpr_disabled: {
          id: "mistral",
          name: "Disabled Org Mistral (Den)",
          env: ["MISTRAL_API_KEY"],
          models: {
            "mistral-small-latest": { id: "mistral-small-latest", name: "Mistral Small" },
          },
        },
      },
    }));
    await readJson(await fetch(`${base}/workspace/ws_1/engine`, {
      method: "PATCH",
      headers: jsonHeaders(token),
      body: JSON.stringify({ engine: "flue" }),
    }));

    const uncredentialed = await readJson(await fetch(`${base}/w/ws_1/opencode/provider`, { headers: auth(token) }));
    expect(uncredentialed).toMatchObject({
      all: [
        { id: "flue" },
        { id: "lpr_connected", env: ["OPENWORK_FLUE_E2E_MISTRAL_KEY"], models: { "mistral-small-latest": { providerID: "lpr_connected" } } },
        { id: "lpr_demo", env: ["MISTRAL_API_KEY"], models: { "mistral-small-latest": { providerID: "lpr_demo" } } },
      ],
      connected: ["flue", "lpr_connected"],
      default: { flue: "default", lpr_connected: "mistral-small-latest" },
    });
    expect(hasRegisteredProvider("lpr_demo")).toBe(false);
    expect(hasRegisteredProvider("lpr_connected")).toBe(true);
    expect(resolveModel("lpr_connected/mistral-small-latest")).toMatchObject({
      id: "mistral-small-latest",
      provider: "lpr_connected",
      api: "openai-completions",
      baseUrl: "https://api.mistral.ai/v1",
    });
    expect(hasRegisteredProvider("mistral")).toBe(false);
    expect(hasRegisteredProvider("lpr_disabled")).toBe(false);
  });

  test("serves real Den catalog records while isolating unsupported and unmappable providers", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-runtime-map-test-key";
    process.env.PROBE_PICKER_EVAL_API_KEY = "probe-runtime-map-test-key";
    process.env.OPENROUTER_API_KEY = "openrouter-runtime-map-test-key";
    for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_BEARER_TOKEN_BEDROCK"]) {
      delete process.env[name];
    }
    const workspaceRoot = await createWorkspaceRoot();
    await seedEmptyCatalog(workspaceRoot);
    const mock = startMockOpencode();
    const { base, token, config } = await startOpenworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);
    await writeGlobalRuntimeOpencodeConfig(config, () => ({
      provider: {
        lpr_anthropic: {
          id: "anthropic",
          name: "Anthropic Test",
          env: ["ANTHROPIC_API_KEY"],
          models: {
            "claude-fable-5": {
              id: "claude-fable-5",
              name: "Claude Fable 5",
              family: "claude",
              release_date: "2026-07-01",
            },
          },
          npm: "@ai-sdk/anthropic",
        },
        lpr_bedrock: {
          id: "amazon-bedrock",
          name: "Bedrock Test",
          env: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_BEARER_TOKEN_BEDROCK"],
          models: {
            "au.anthropic.claude-opus-4-6-v1": {
              id: "au.anthropic.claude-opus-4-6-v1",
              name: "Claude Opus 4.6",
              family: "claude",
              release_date: "2026-02-01",
            },
          },
          npm: "@ai-sdk/amazon-bedrock",
        },
        lpr_probe: {
          id: "probe-picker-eval",
          name: "Probe Picker Eval",
          env: ["PROBE_PICKER_EVAL_API_KEY"],
          models: {
            "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 mini", family: "gpt-5", release_date: "2025-08-07" },
            "gpt-5.2-chat": { id: "gpt-5.2-chat", name: "GPT-5.2 Chat", family: "gpt-5", release_date: "2025-12-11" },
          },
          npm: "@ai-sdk/openai-compatible",
          api: "http://127.0.0.1:18092/v1",
        },
        lpr_openrouter: {
          id: "openrouter",
          name: "OpenRouter (sandbox)",
          env: ["OPENROUTER_API_KEY"],
          models: {
            "z-ai/glm-5.2": { id: "z-ai/glm-5.2", name: "GLM-5.2", family: "glm", release_date: "2026-06-01" },
          },
          npm: "@ai-sdk/openai-compatible",
          api: "https://openrouter.ai/api/v1",
        },
        lpr_unmappable: {
          id: "unknown-first-party",
          name: "Unknown First Party",
          env: ["UNKNOWN_FIRST_PARTY_API_KEY"],
          models: { model: { id: "model", name: "Unknown Model" } },
          npm: "@unknown/first-party-sdk",
        },
      },
    }));
    await readJson(await fetch(`${base}/workspace/ws_1/engine`, {
      method: "PATCH",
      headers: jsonHeaders(token),
      body: JSON.stringify({ engine: "flue" }),
    }));

    const infoLogs: unknown[][] = [];
    const originalInfo = console.info;
    console.info = (...data: unknown[]) => infoLogs.push(data);
    try {
      const response = await fetch(`${base}/workspace/ws_1/opencode/provider?directory=${encodeURIComponent(workspaceRoot)}`, {
        headers: auth(token),
      });
      const text = await response.text();
      expect({ status: response.status, body: text }).toMatchObject({ status: 200 });
      const body: unknown = JSON.parse(text);
      expect(providerFromList(body, "lpr_anthropic")).toMatchObject({
        id: "lpr_anthropic",
        env: ["ANTHROPIC_API_KEY"],
        models: {
          "claude-fable-5": {
            providerID: "lpr_anthropic",
            api: { id: "anthropic-messages", url: "https://api.anthropic.com" },
          },
        },
      });
      expect(providerFromList(body, "lpr_bedrock")).toMatchObject({
        id: "lpr_bedrock",
        models: { "au.anthropic.claude-opus-4-6-v1": { providerID: "lpr_bedrock" } },
      });
      expect(providerFromList(body, "lpr_probe")).toMatchObject({
        id: "lpr_probe",
        models: {
          "gpt-5-mini": { providerID: "lpr_probe", api: { url: "http://127.0.0.1:18092/v1" } },
          "gpt-5.2-chat": { providerID: "lpr_probe", api: { url: "http://127.0.0.1:18092/v1" } },
        },
      });
      expect(providerFromList(body, "lpr_openrouter")).toMatchObject({
        id: "lpr_openrouter",
        models: {
          "z-ai/glm-5.2": { providerID: "lpr_openrouter", api: { url: "https://openrouter.ai/api/v1" } },
        },
      });
      expect(providerFromList(body, "lpr_unmappable")).toMatchObject({ id: "lpr_unmappable" });
      expect(stringListField(body, "connected")).toEqual(["flue", "lpr_anthropic", "lpr_openrouter", "lpr_probe"]);
      expect(isRecord(body) ? body.default : null).toMatchObject({
        flue: "default",
        lpr_anthropic: "claude-fable-5",
        lpr_openrouter: "z-ai/glm-5.2",
        lpr_probe: "gpt-5-mini",
      });
      expect(materializationSkips(infoLogs)).toEqual(expect.arrayContaining([
        { providerId: "lpr_bedrock", reason: "unsupported_credential_scheme" },
        { providerId: "lpr_unmappable", reason: "unmappable_npm" },
      ]));

      delete process.env.ANTHROPIC_API_KEY;
      const withoutCredential = await readJson(await fetch(`${base}/workspace/ws_1/opencode/provider`, { headers: auth(token) }));
      expect(providerFromList(withoutCredential, "lpr_anthropic")).not.toBeNull();
      expect(stringListField(withoutCredential, "connected")).not.toContain("lpr_anthropic");
    } finally {
      console.info = originalInfo;
    }
  });

  test("owns the auth wire, applies Den-imported credentials live, and never echoes or writes the key", async () => {
    const rawKey = "flue-vault-leak-regression-key";
    const workspaceRoot = await createWorkspaceRoot();
    await seedEmptyCatalog(workspaceRoot);
    const mock = startMockOpencode();
    const { base, token, config } = await startOpenworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);
    await configureDenRuntimeProvider(config);
    await readJson(await fetch(`${base}/workspace/ws_1/engine`, {
      method: "PATCH",
      headers: jsonHeaders(token),
      body: JSON.stringify({ engine: "flue" }),
    }));

    const setResponse = await fetch(`${base}/workspace/ws_1/opencode/auth/den-import`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ type: "api", key: rawKey }),
    });
    const setBody = await setResponse.text();
    expect({ status: setResponse.status, body: setBody }).toEqual({ status: 200, body: "true" });
    expect(setBody).not.toContain(rawKey);

    const providerResponse = await fetch(`${base}/workspace/ws_1/opencode/provider`, { headers: auth(token) });
    const providerBody = await providerResponse.text();
    expect(providerResponse.status).toBe(200);
    expect(providerBody).toContain('"connected":["flue","den-import"]');
    expect(providerBody).toContain('"den-import":"den-model"');
    expect(providerBody).not.toContain(rawKey);
    expect(hasRegisteredProvider("den-import")).toBe(true);
    expect(resolveModel("den-import/den-model")).toMatchObject({
      id: "den-model",
      provider: "den-import",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:1/v1",
    });

    const authMethodsResponse = await fetch(`${base}/workspace/ws_1/opencode/provider/auth`, { headers: auth(token) });
    const authMethodsBody = await authMethodsResponse.text();
    expect(authMethodsResponse.status).toBe(200);
    expect(JSON.parse(authMethodsBody)).toEqual({
      "den-import": [{ type: "api", label: "API key" }],
    });
    expect(authMethodsBody).not.toContain(rawKey);

    const created = await readJson(await fetch(`${base}/workspace/ws_1/opencode/session`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ title: "Den imported model" }),
    }));
    const sessionId = sessionIdFromCreateResponse(created);
    const promptResponse = await fetch(`${base}/workspace/ws_1/opencode/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        model: { providerID: "den-import", modelID: "den-model" },
        parts: [{ type: "text", text: "Use the Den model." }],
      }),
    });
    expect(promptResponse.status).toBe(204);
    const messageResponse = await fetch(`${base}/workspace/ws_1/opencode/session/${encodeURIComponent(sessionId)}/message`, {
      headers: auth(token),
    });
    const messageBody = await messageResponse.text();
    expect(messageResponse.status).toBe(200);
    expect(messageBody).toContain('"providerID":"den-import"');
    expect(messageBody).toContain('"modelID":"den-model"');
    expect(messageBody).not.toContain(rawKey);

    const runtimeConfigPath = await writeOpenworkRuntimeConfigFile(config, "ws_1");
    const runtimeConfigFileContent = await readFile(runtimeConfigPath, "utf8");
    const runtimeConfigResponse = await fetch(`${base}/workspace/ws_1/runtime-config`, {
      headers: auth(token),
    });
    const runtimeConfigResponseBody = await runtimeConfigResponse.text();
    const stateFileContent = await readFile(join(workspaceRoot, ".opencode", "openwork", "flue-state.json"), "utf8");
    const catalogCacheContent = await readFile(join(workspaceRoot, FLUE_CATALOG_CACHE_FILE), "utf8");
    expect(runtimeConfigPath).toBe(openworkRuntimeConfigFilePath(config));
    expect(runtimeConfigResponse.status).toBe(200);
    expect(runtimeConfigFileContent).not.toContain(rawKey);
    expect(runtimeConfigResponseBody).not.toContain(rawKey);
    expect(stateFileContent).not.toContain(rawKey);
    expect(catalogCacheContent).not.toContain(rawKey);

    for (const suffix of ["authorize", "callback"]) {
      const oauthResponse = await fetch(`${base}/workspace/ws_1/opencode/provider/den-import/oauth/${suffix}`, {
        method: "POST",
        headers: jsonHeaders(token),
        body: JSON.stringify({ method: 0 }),
      });
      expect({ status: oauthResponse.status, body: await oauthResponse.json() }).toEqual({
        status: 501,
        body: {
          code: "flue_oauth_unsupported",
          message: "OAuth is unsupported on the Flue engine",
        },
      });
    }

    const removeResponse = await fetch(`${base}/workspace/ws_1/opencode/auth/den-import`, {
      method: "DELETE",
      headers: auth(token),
    });
    expect({ status: removeResponse.status, body: await removeResponse.text() }).toEqual({ status: 200, body: "true" });
    const removedProviderResponse = await fetch(`${base}/workspace/ws_1/opencode/provider`, { headers: auth(token) });
    const removedProviderBody = await removedProviderResponse.text();
    expect(removedProviderResponse.status).toBe(200);
    expect(removedProviderBody).not.toContain('"connected":["flue","den-import"]');
    expect(hasRegisteredProvider("den-import")).toBe(false);

    await fetch(`${base}/workspace/ws_1/opencode/auth/den-import`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ type: "api", key: rawKey }),
    });
    const nullRemoval = await fetch(`${base}/workspace/ws_1/opencode/auth/den-import`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: "null",
    });
    expect({ status: nullRemoval.status, body: await nullRemoval.text() }).toEqual({ status: 200, body: "true" });
    const nullRemovedProviderResponse = await fetch(`${base}/workspace/ws_1/opencode/provider`, { headers: auth(token) });
    const nullRemovedProviderBody = await nullRemovedProviderResponse.text();
    expect(nullRemovedProviderResponse.status).toBe(200);
    expect(nullRemovedProviderBody).not.toContain('"connected":["flue","den-import"]');
  });
});
