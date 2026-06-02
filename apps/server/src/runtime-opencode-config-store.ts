import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ServerConfig } from "./types.js";
import { ensureDir } from "./utils.js";

export type RuntimeOpencodeConfig = {
  plugin?: string[];
  mcp?: Record<string, Record<string, unknown>>;
  permission?: {
    external_directory?: Record<string, unknown>;
  };
  provider?: Record<string, unknown>;
};

const runtimeOpencodeConfigs = sqliteTable("runtime_opencode_configs", {
  workspaceId: text("workspace_id").primaryKey(),
  configJson: text("config_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

type RuntimeOpencodeDb = {
  select: () => {
    from: (table: typeof runtimeOpencodeConfigs) => {
      where: (condition: unknown) => {
        get: () => { configJson: string } | undefined;
      };
    };
  };
  insert: (table: typeof runtimeOpencodeConfigs) => {
    values: (value: { workspaceId: string; configJson: string; updatedAt: number }) => {
      onConflictDoUpdate: (input: {
        target: typeof runtimeOpencodeConfigs.workspaceId;
        set: { configJson: string; updatedAt: number };
      }) => { run: () => void };
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRuntimeOpencodeConfig(value: unknown): RuntimeOpencodeConfig {
  if (!isRecord(value)) return {};
  const plugin = Array.isArray(value.plugin) ? value.plugin.filter((item) => typeof item === "string") : undefined;
  const mcp = isRecord(value.mcp) ? value.mcp as Record<string, Record<string, unknown>> : undefined;
  const permission = isRecord(value.permission) ? value.permission : undefined;
  const externalDirectory = permission && isRecord(permission.external_directory) ? permission.external_directory : undefined;
  const provider = isRecord(value.provider) ? value.provider : undefined;
  return {
    ...(plugin ? { plugin } : {}),
    ...(mcp ? { mcp } : {}),
    ...(externalDirectory ? { permission: { external_directory: externalDirectory } } : {}),
    ...(provider ? { provider } : {}),
  };
}

function runtimeDbPath(config: ServerConfig): string {
  const override = process.env.OPENWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "openwork");
  return join(configDir, "runtime.sqlite");
}

async function openRuntimeDb(path: string): Promise<RuntimeOpencodeDb> {
  await ensureDir(dirname(path));
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const { drizzle } = await import("drizzle-orm/bun-sqlite");
    const sqlite = new Database(path, { create: true });
    sqlite.run("CREATE TABLE IF NOT EXISTS runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    return drizzle(sqlite) as unknown as RuntimeOpencodeDb;
  }
  const [{ default: Database }, { drizzle }] = await Promise.all([
    import("better-sqlite3"),
    import("drizzle-orm/better-sqlite3"),
  ]);
  const sqlite = new Database(path);
  sqlite.exec("CREATE TABLE IF NOT EXISTS runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  return drizzle(sqlite) as unknown as RuntimeOpencodeDb;
}

const dbByPath = new Map<string, Promise<RuntimeOpencodeDb>>();

async function runtimeDb(config: ServerConfig): Promise<RuntimeOpencodeDb> {
  const path = runtimeDbPath(config);
  const existing = dbByPath.get(path);
  if (existing) return existing;
  const db = openRuntimeDb(path);
  dbByPath.set(path, db);
  return db;
}

export function runtimePluginList(config: RuntimeOpencodeConfig): string[] {
  return Array.isArray(config.plugin) ? config.plugin.filter((item) => typeof item === "string") : [];
}

export function runtimeMcpMap(config: RuntimeOpencodeConfig): Record<string, Record<string, unknown>> {
  return isRecord(config.mcp) ? config.mcp as Record<string, Record<string, unknown>> : {};
}

export function runtimeExternalDirectory(config: RuntimeOpencodeConfig): Record<string, unknown> {
  const permission = isRecord(config.permission) ? config.permission : null;
  const externalDirectory = permission && isRecord(permission.external_directory) ? permission.external_directory : null;
  return externalDirectory ?? {};
}

export async function readRuntimeOpencodeConfig(config: ServerConfig, workspaceId: string): Promise<RuntimeOpencodeConfig> {
  const db = await runtimeDb(config);
  const row = db
    .select()
    .from(runtimeOpencodeConfigs)
    .where(eq(runtimeOpencodeConfigs.workspaceId, workspaceId))
    .get();
  if (!row) return {};
  try {
    return normalizeRuntimeOpencodeConfig(JSON.parse(row.configJson));
  } catch {
    return {};
  }
}

export async function writeRuntimeOpencodeConfig(
  config: ServerConfig,
  workspaceId: string,
  updater: (current: RuntimeOpencodeConfig) => RuntimeOpencodeConfig,
): Promise<RuntimeOpencodeConfig> {
  const db = await runtimeDb(config);
  const next = normalizeRuntimeOpencodeConfig(updater(await readRuntimeOpencodeConfig(config, workspaceId)));
  const now = Date.now();
  const configJson = JSON.stringify(next);
  db
    .insert(runtimeOpencodeConfigs)
    .values({ workspaceId, configJson, updatedAt: now })
    .onConflictDoUpdate({
      target: runtimeOpencodeConfigs.workspaceId,
      set: { configJson, updatedAt: now },
    })
    .run();
  return next;
}

export function mergeOpencodeConfigs(
  persisted: Record<string, unknown>,
  runtime: RuntimeOpencodeConfig,
): Record<string, unknown> {
  const persistedPermission = isRecord(persisted.permission) ? persisted.permission : {};
  const persistedExternalDirectory = isRecord(persistedPermission.external_directory)
    ? persistedPermission.external_directory
    : {};
  return {
    ...persisted,
    plugin: [
      ...(Array.isArray(persisted.plugin) ? persisted.plugin.filter((item) => typeof item === "string") : []),
      ...runtimePluginList(runtime),
    ],
    mcp: {
      ...(isRecord(persisted.mcp) ? persisted.mcp : {}),
      ...runtimeMcpMap(runtime),
    },
    permission: {
      ...persistedPermission,
      external_directory: {
        ...persistedExternalDirectory,
        ...runtimeExternalDirectory(runtime),
      },
    },
    ...(runtime.provider ? { provider: { ...(isRecord(persisted.provider) ? persisted.provider : {}), ...runtime.provider } } : {}),
  };
}
