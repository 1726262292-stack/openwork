import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) {
    const stop = stops.pop();
    if (stop) await stop();
  }
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function createWorkspaceRoot() {
  const root = await mkdtemp(join(tmpdir(), "openwork-file-sessions-"));
  roots.push(root);
  return root;
}

async function startOpenworkServer(workspaceRoot: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: workspaceRoot, preset: "starter", workspaceType: "local" }],
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

async function json(response: Response): Promise<unknown> {
  expect(response.status).toBe(200);
  return response.json();
}

function nestedString(value: unknown, first: string, second: string): string {
  if (!isRecord(value) || !isRecord(value[first]) || typeof value[first][second] !== "string") {
    throw new Error(`Expected ${first}.${second}`);
  }
  return value[first][second];
}

function numberField(value: unknown, field: string): number {
  if (!isRecord(value) || typeof value[field] !== "number") {
    throw new Error(`Expected numeric ${field}`);
  }
  return value[field];
}

function itemRecords(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("Expected items array");
  }
  const items: Record<string, unknown>[] = [];
  for (const item of value.items) {
    if (!isRecord(item)) throw new Error("Expected item record");
    items.push(item);
  }
  return items;
}

describe("file session catalog event API", () => {
  test("serves catalog events with preserved cursor order and payload shape", async () => {
    const root = await createWorkspaceRoot();
    const { base, token } = await startOpenworkServer(root);

    const created = await json(await fetch(`${base}/workspace/ws_1/files/sessions`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({}),
    }));
    const sessionId = nestedString(created, "session", "id");

    const written = await json(await fetch(`${base}/files/sessions/${sessionId}/write-batch`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        writes: [{ path: "notes/a.md", contentBase64: Buffer.from("hello").toString("base64") }],
      }),
    }));
    expect(numberField(written, "cursor")).toBe(1);

    const operated = await json(await fetch(`${base}/files/sessions/${sessionId}/ops`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        operations: [
          { type: "mkdir", path: "notes/sub" },
          { type: "rename", from: "notes/a.md", to: "notes/b.md" },
        ],
      }),
    }));
    expect(numberField(operated, "cursor")).toBe(3);

    const events = await json(await fetch(`${base}/files/sessions/${sessionId}/catalog/events?since=1`, {
      headers: auth(token),
    }));
    expect(numberField(events, "cursor")).toBe(3);
    const items = itemRecords(events);
    expect(items.map((item) => item.type)).toEqual(["mkdir", "rename"]);
    expect(items.map((item) => item.path)).toEqual(["notes/sub", "notes/a.md"]);
    expect(items[1]?.toPath).toBe("notes/b.md");
    expect(items.every((item) => item.workspaceId === "ws_1" && typeof item.timestamp === "number")).toBe(true);
  });
});
