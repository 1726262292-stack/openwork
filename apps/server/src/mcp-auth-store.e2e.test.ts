import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

type Served = { port: number; stop: (closeActiveConnections?: boolean) => void | Promise<void> };

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
let previousEnv: Record<string, string | undefined> = {};

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv = {};
});

function setEnv(key: string, value: string) {
  if (!(key in previousEnv)) previousEnv[key] = process.env[key];
  process.env[key] = value;
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "openwork-mcp-auth-clear-"));
  roots.push(root);
  setEnv("OPENWORK_RUNTIME_DB", join(root, "runtime.sqlite"));

  // Point the engine data dir resolution at a temp store with a stale entry.
  const dataHome = join(root, "xdg-data");
  setEnv("XDG_DATA_HOME", dataHome);
  const authStorePath = join(dataHome, "opencode", "mcp-auth.json");
  await mkdir(join(dataHome, "opencode"), { recursive: true });
  await writeFile(
    authStorePath,
    JSON.stringify({
      posthog: {
        serverUrl: "https://mcp.us.posthog.com/mcp",
        tokens: { access_token: "stale" },
        clientInfo: { client_id: "poisoned-client" },
        oauthState: "stale-state",
      },
      linear: { serverUrl: "https://mcp.linear.app/mcp", tokens: { access_token: "good" } },
    }, null, 2),
    "utf8",
  );

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
        path: root,
        preset: "starter",
        workspaceType: "local",
        // Unreachable engine: forces the file-level recovery fallback.
        baseUrl: "http://127.0.0.1:9",
      },
    ],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return {
    base: `http://127.0.0.1:${server.port}`,
    headers: { Authorization: "Bearer owt_test_token" },
    authStorePath,
  };
}

describe("MCP auth clear recovery", () => {
  test("clears a stale auth entry even when the engine is unreachable", async () => {
    const { base, headers, authStorePath } = await setup();

    const response = await fetch(`${base}/workspace/ws_1/mcp/posthog/auth`, {
      method: "DELETE",
      headers,
    });
    expect(response.status).toBe(200);

    const store = JSON.parse(await readFile(authStorePath, "utf8")) as Record<string, unknown>;
    expect(store.posthog).toBeUndefined();
    // Other entries are untouched.
    expect(store.linear).toBeDefined();
  });

  test("is idempotent: clearing an absent entry still succeeds", async () => {
    const { base, headers, authStorePath } = await setup();

    const first = await fetch(`${base}/workspace/ws_1/mcp/posthog/auth`, { method: "DELETE", headers });
    expect(first.status).toBe(200);
    const second = await fetch(`${base}/workspace/ws_1/mcp/posthog/auth`, { method: "DELETE", headers });
    expect(second.status).toBe(200);

    const store = JSON.parse(await readFile(authStorePath, "utf8")) as Record<string, unknown>;
    expect(store.posthog).toBeUndefined();
    expect(store.linear).toBeDefined();
  });
});
