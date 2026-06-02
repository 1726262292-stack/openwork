import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMcp, listMcp, setMcpEnabled } from "./mcp.js";
import { buildOpenworkRuntimeConfig } from "./openwork-runtime-config.js";
import { addPlugin, listPlugins, removePlugin } from "./plugins.js";
import { readRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const WORKSPACE_ID = "ws_runtime_test";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

function serverConfig(root: string, dbPath: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{ id: WORKSPACE_ID, name: "Test", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  } satisfies ServerConfig;
}

async function withWorkspace(fn: (input: { root: string; config: ServerConfig }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "openwork-runtime-config-"));
  const previousDb = process.env.OPENWORK_RUNTIME_DB;
  const dbPath = join(root, "runtime.sqlite");
  process.env.OPENWORK_RUNTIME_DB = dbPath;
  try {
    await fn({ root, config: serverConfig(root, dbPath) });
  } finally {
    if (previousDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
    else process.env.OPENWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}

async function expectMissing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toThrow();
}

describe("runtime OpenCode config store", () => {
  test("stores MCP changes in the OpenWork runtime DB without rewriting workspace files", async () => {
    await withWorkspace(async ({ root, config }) => {
      const opencodePath = join(root, "opencode.jsonc");
      const opencode = '{\n  "mcp": {\n    "project": { "type": "remote", "url": "https://project.example/mcp" }\n  }\n}\n';
      await writeFile(opencodePath, opencode, "utf8");

      await addMcp(config, WORKSPACE_ID, "runtime", { type: "remote", url: "https://runtime.example/mcp", enabled: true });
      await setMcpEnabled(config, WORKSPACE_ID, "runtime", false);

      expect(await readFile(opencodePath, "utf8")).toBe(opencode);
      await expectMissing(join(root, ".opencode", "openwork.json"));
      expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.runtime?.enabled).toBe(false);

      const items = await listMcp(config, WORKSPACE_ID, root);
      expect(items.map((item) => `${item.name}:${item.source}`)).toContain("project:config.project");
      expect(items.map((item) => `${item.name}:${item.source}`)).toContain("runtime:config.remote");
    });
  });

  test("stores plugin changes in the OpenWork runtime DB without rewriting workspace files", async () => {
    await withWorkspace(async ({ root, config }) => {
      const opencodePath = join(root, "opencode.jsonc");
      const opencode = '{\n  "plugin": ["project-plugin"]\n}\n';
      await writeFile(opencodePath, opencode, "utf8");

      expect(await addPlugin(config, WORKSPACE_ID, "runtime-plugin")).toBe(true);
      expect(await removePlugin(config, WORKSPACE_ID, "runtime-plugin")).toBe(true);
      expect(await addPlugin(config, WORKSPACE_ID, "runtime-plugin")).toBe(true);

      expect(await readFile(opencodePath, "utf8")).toBe(opencode);
      await expectMissing(join(root, ".opencode", "openwork.json"));
      expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin).toEqual(["runtime-plugin"]);

      const result = await listPlugins(config, WORKSPACE_ID, root, false);
      expect(result.items.map((item) => item.spec)).toEqual(["project-plugin", "runtime-plugin"]);

      await addMcp(config, WORKSPACE_ID, "runtime", { type: "remote", url: "https://runtime.example/mcp", enabled: true });
      const runtimeConfig = JSON.parse(await buildOpenworkRuntimeConfig(config, WORKSPACE_ID)) as {
        plugin?: string[];
        mcp?: Record<string, Record<string, unknown>>;
      };
      expect(runtimeConfig.plugin).toContain("runtime-plugin");
      expect(runtimeConfig.mcp?.runtime?.url).toBe("https://runtime.example/mcp");
    });
  });

  test("malformed user opencode config does not block runtime config reads", async () => {
    await withWorkspace(async ({ root, config }) => {
      await writeFile(join(root, "opencode.jsonc"), '{ "mcp": {\n}\n}\n}\n', "utf8");
      await addMcp(config, WORKSPACE_ID, "runtime", { type: "remote", url: "https://runtime.example/mcp", enabled: true });
      await addPlugin(config, WORKSPACE_ID, "runtime-plugin");

      const mcpItems = await listMcp(config, WORKSPACE_ID, root);
      const pluginItems = await listPlugins(config, WORKSPACE_ID, root, false);

      expect(mcpItems.map((item) => item.name)).toEqual(["runtime"]);
      expect(pluginItems.items.map((item) => item.spec)).toEqual(["runtime-plugin"]);
    });
  });

  test("explicitly migrates legacy OpenWork runtime config into the runtime DB", async () => {
    await withWorkspace(async ({ root, config }) => {
      await mkdir(join(root, ".opencode"), { recursive: true });
      const openworkPath = join(root, ".opencode", "openwork.json");
      await writeFile(openworkPath, JSON.stringify({
        version: 1,
        workspace: { name: "Test" },
        plugin: ["legacy-plugin"],
        mcp: { legacy: { type: "remote", url: "https://legacy.example/mcp" } },
        permission: { external_directory: { "/legacy/*": "allow" } },
        provider: { legacy: { npm: "legacy-provider" } },
      }, null, 2) + "\n", "utf8");

      const server = await startServer(config) as Served;
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/runtime-config/migrate`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          migrated: true,
          keys: ["plugin", "mcp", "permission", "provider"],
        });

        const runtime = await readRuntimeOpencodeConfig(config, WORKSPACE_ID);
        expect(runtime.plugin).toEqual(["legacy-plugin"]);
        expect(runtime.mcp?.legacy?.url).toBe("https://legacy.example/mcp");
        expect(runtime.permission?.external_directory?.["/legacy/*"]).toBe("allow");
        expect(runtime.provider?.legacy).toEqual({ npm: "legacy-provider" });

        const openwork = JSON.parse(await readFile(openworkPath, "utf8")) as Record<string, unknown>;
        expect(openwork.version).toBe(1);
        expect(openwork.workspace).toEqual({ name: "Test" });
        expect(openwork.plugin).toBeUndefined();
        expect(openwork.mcp).toBeUndefined();
        expect(openwork.permission).toBeUndefined();
        expect(openwork.provider).toBeUndefined();

        const statusResponse = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/runtime-config`, {
          headers: { authorization: `Bearer ${config.token}` },
        });
        expect(statusResponse.status).toBe(200);
        expect(await statusResponse.json()).toMatchObject({
          runtimeKeys: ["plugin", "mcp", "permission", "provider"],
          legacyOpenwork: { keys: [] },
          userOpencode: { exists: false, keys: [] },
        });
      } finally {
        await server.stop(true);
      }
    });
  });
});
