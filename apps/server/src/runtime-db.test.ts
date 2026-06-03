import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMcp } from "./mcp.js";
import { readOpenworkWorkspaceConfig, writeOpenworkWorkspaceConfig } from "./openwork-workspace-config-store.js";
import { addPlugin } from "./plugins.js";
import { getRuntimeDbDiagnostics } from "./runtime-db.js";
import { readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

const WORKSPACE_ID = "ws_runtime_db_test";

function serverConfig(root: string): ServerConfig {
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

async function withRuntimeDb(fn: (input: { root: string; dbPath: string; config: ServerConfig }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "openwork-runtime-db-"));
  const previousDb = process.env.OPENWORK_RUNTIME_DB;
  const dbPath = join(root, "runtime.sqlite");
  process.env.OPENWORK_RUNTIME_DB = dbPath;
  try {
    await fn({ root, dbPath, config: serverConfig(root) });
  } finally {
    if (previousDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
    else process.env.OPENWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}

function openSqlite(path: string): Database {
  return new Database(path, { create: true });
}

describe("runtime DB", () => {
  test("creates shared schema and records the runtime schema migration", async () => {
    await withRuntimeDb(async ({ config }) => {
      await addPlugin(config, WORKSPACE_ID, "runtime-plugin");
      await writeOpenworkWorkspaceConfig(config, WORKSPACE_ID, () => ({ cloudImports: { plugins: {} } }));

      const diagnostics = await getRuntimeDbDiagnostics(config);

      expect(diagnostics.schemaVersion).toBe(1);
      expect(diagnostics.migrations).toMatchObject([{ version: 1, name: "initial_runtime_store" }]);
      expect(diagnostics.tables.runtime_opencode_configs).toBe(1);
      expect(diagnostics.tables.openwork_workspace_configs).toBe(1);
      expect(diagnostics.tables.migration_state).toBe(0);
    });
  });

  test("opens an existing runtime DB with the old tables without dropping data", async () => {
    await withRuntimeDb(async ({ dbPath, config }) => {
      const sqlite = openSqlite(dbPath);
      sqlite.run("CREATE TABLE runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
      sqlite.run("CREATE TABLE openwork_workspace_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
      sqlite.run(
        "INSERT INTO runtime_opencode_configs (workspace_id, config_json, updated_at) VALUES (?, ?, ?)",
        [WORKSPACE_ID, JSON.stringify({ plugin: ["legacy-runtime-plugin"] }), Date.now()],
      );
      sqlite.close();

      expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin).toEqual(["legacy-runtime-plugin"]);
      const diagnostics = await getRuntimeDbDiagnostics(config);

      expect(diagnostics.schemaVersion).toBe(1);
      expect(diagnostics.tables.runtime_opencode_configs).toBe(1);
      expect(diagnostics.tables.openwork_workspace_configs).toBe(0);
    });
  });

  test("serializes runtime config updates so unrelated keys are preserved", async () => {
    await withRuntimeDb(async ({ config }) => {
      await Promise.all([
        addPlugin(config, WORKSPACE_ID, "runtime-plugin"),
        addMcp(config, WORKSPACE_ID, "runtime-mcp", { type: "remote", url: "https://runtime.example/mcp" }),
        writeRuntimeOpencodeConfig(config, WORKSPACE_ID, (current) => ({
          ...current,
          provider: { runtimeProvider: { npm: "@openwork/runtime-provider" } },
        })),
      ]);

      const runtime = await readRuntimeOpencodeConfig(config, WORKSPACE_ID);

      expect(runtime.plugin).toEqual(["runtime-plugin"]);
      expect(runtime.mcp?.["runtime-mcp"]?.url).toBe("https://runtime.example/mcp");
      expect(runtime.provider?.runtimeProvider).toEqual({ npm: "@openwork/runtime-provider" });
    });
  });

  test("malformed stored JSON still reads as empty config", async () => {
    await withRuntimeDb(async ({ dbPath, config }) => {
      const sqlite = openSqlite(dbPath);
      sqlite.run("CREATE TABLE runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
      sqlite.run("INSERT INTO runtime_opencode_configs (workspace_id, config_json, updated_at) VALUES (?, ?, ?)", [WORKSPACE_ID, "{ invalid", Date.now()]);
      sqlite.close();

      expect(await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).toEqual({});
      await addPlugin(config, WORKSPACE_ID, "runtime-plugin");
      expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin).toEqual(["runtime-plugin"]);
    });
  });

  test("workspace config updates share the same DB and preserve existing JSON keys", async () => {
    await withRuntimeDb(async ({ config }) => {
      await writeOpenworkWorkspaceConfig(config, WORKSPACE_ID, () => ({ cloudImports: { plugins: { plugin_1: { name: "one" } } } }));
      await writeOpenworkWorkspaceConfig(config, WORKSPACE_ID, (current) => ({ ...current, desktopCloudSync: { fetchedAt: 123 } }));

      expect(await readOpenworkWorkspaceConfig(config, WORKSPACE_ID)).toEqual({
        cloudImports: { plugins: { plugin_1: { name: "one" } } },
        desktopCloudSync: { fetchedAt: 123 },
      });
    });
  });
});
