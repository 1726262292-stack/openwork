import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { prepareManagedOpencodeEnvironment } from "./managed-opencode-env.js";
import type { ServerConfig } from "./types.js";

function testConfig(configPath: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "client-token",
    hostToken: "host-token",
    configPath,
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [],
    authorizedRoots: [],
    readOnly: false,
    startedAt: 0,
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

describe("prepareManagedOpencodeEnvironment", () => {
  test("isolates OpenCode home and global config paths under OpenWork runtime storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-managed-opencode-env-"));
    const env = await prepareManagedOpencodeEnvironment(testConfig(join(root, "config", "server.json")));

    expect(env.HOME).toBe(join(root, "config", "managed-opencode", "home"));
    expect(env.USERPROFILE).toBe(env.HOME);
    expect(env.XDG_CONFIG_HOME).toBe(join(root, "config", "managed-opencode", "xdg", "config"));
    expect(env.OPENCODE_CONFIG_DIR).toBe(join(env.XDG_CONFIG_HOME, "opencode"));
    expect(env.APPDATA).toBe(join(root, "config", "managed-opencode", "appdata", "roaming"));
    expect(env.LOCALAPPDATA).toBe(join(root, "config", "managed-opencode", "appdata", "local"));

    await expect(stat(env.OPENCODE_CONFIG_DIR)).resolves.toMatchObject({});
  });
});
