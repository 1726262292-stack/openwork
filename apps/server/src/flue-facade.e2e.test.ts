import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
const previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop() ?? "", { recursive: true, force: true });
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
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
  return { base: `http://127.0.0.1:${server.port}`, token: config.token };
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
  });
});
