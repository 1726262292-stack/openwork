import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { ServerConfig } from "./types.js";
import { ensureDir } from "./utils.js";
import {
  openworkWorkspaceConfigs,
  runtimeDbSchema,
  runtimeOpencodeConfigs,
  schemaMigrations,
} from "./runtime-db-schema.js";

const CURRENT_SCHEMA_VERSION = 1;
const INITIAL_SCHEMA_NAME = "initial_runtime_store";

type RuntimeJsonTable = "runtime_opencode_configs" | "openwork_workspace_configs";
type RuntimeJsonRow = { configJson: string };
type RuntimeMigrationRow = { version: number; name: string; appliedAt: number };

type RuntimeDb = {
  path: string;
  getJsonRow: (table: RuntimeJsonTable, workspaceId: string) => RuntimeJsonRow | undefined;
  updateJsonRow: (
    table: RuntimeJsonTable,
    workspaceId: string,
    updater: (currentJson: string | undefined) => string,
  ) => string;
  diagnostics: () => RuntimeDbDiagnostics;
};

export type RuntimeDbDiagnostics = {
  path: string;
  schemaVersion: number;
  migrations: RuntimeMigrationRow[];
  tables: Record<RuntimeJsonTable | "migration_state", number>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function runtimeDbPath(config: ServerConfig): string {
  const override = process.env.OPENWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "openwork");
  return join(configDir, "runtime.sqlite");
}

function createSchemaSql(): string {
  return [
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS migration_state (source TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, path TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL DEFAULT '', row_count INTEGER NOT NULL DEFAULT 0, imported_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS openwork_workspace_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  ].join("; ");
}

function rowCountSql(table: RuntimeJsonTable | "migration_state"): string {
  return `SELECT COUNT(1) AS count FROM ${table}`;
}

function getSchemaVersion(migrations: RuntimeMigrationRow[]): number {
  return migrations.reduce((max, row) => Math.max(max, row.version), 0);
}

function normalizeMigrationRow(value: unknown): RuntimeMigrationRow | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.version !== "number" || typeof value.name !== "string" || typeof value.appliedAt !== "number") {
    return undefined;
  }
  return { version: value.version, name: value.name, appliedAt: value.appliedAt };
}

async function openBunRuntimeDb(path: string): Promise<RuntimeDb> {
  const { Database } = await import("bun:sqlite");
  const { drizzle } = await import("drizzle-orm/bun-sqlite");
  const sqlite = new Database(path, { create: true });
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.exec(createSchemaSql());
  const db: BunSQLiteDatabase<typeof runtimeDbSchema> = drizzle(sqlite, { schema: runtimeDbSchema });
  db.insert(schemaMigrations)
    .values({ version: CURRENT_SCHEMA_VERSION, name: INITIAL_SCHEMA_NAME, appliedAt: Date.now() })
    .onConflictDoNothing()
    .run();

  const tableSchema = {
    runtime_opencode_configs: runtimeOpencodeConfigs,
    openwork_workspace_configs: openworkWorkspaceConfigs,
  };

  return {
    path,
    getJsonRow: (table, workspaceId) => db
      .select({ configJson: tableSchema[table].configJson })
      .from(tableSchema[table])
      .where(eq(tableSchema[table].workspaceId, workspaceId))
      .get(),
    updateJsonRow: (table, workspaceId, updater) => sqlite.transaction(() => {
      const current = db
        .select({ configJson: tableSchema[table].configJson })
        .from(tableSchema[table])
        .where(eq(tableSchema[table].workspaceId, workspaceId))
        .get();
      const configJson = updater(current?.configJson);
      db.insert(tableSchema[table])
        .values({ workspaceId, configJson, updatedAt: Date.now() })
        .onConflictDoUpdate({
          target: tableSchema[table].workspaceId,
          set: { configJson, updatedAt: Date.now() },
        })
        .run();
      return configJson;
    })(),
    diagnostics: () => {
      const migrations = db.select().from(schemaMigrations).all();
      const count = (table: RuntimeJsonTable | "migration_state") => {
        const row = sqlite.query(rowCountSql(table)).get();
        return isRecord(row) && typeof row.count === "number" ? row.count : 0;
      };
      return {
        path,
        schemaVersion: getSchemaVersion(migrations),
        migrations,
        tables: {
          runtime_opencode_configs: count("runtime_opencode_configs"),
          openwork_workspace_configs: count("openwork_workspace_configs"),
          migration_state: count("migration_state"),
        },
      };
    },
  };
}

async function openNodeRuntimeDb(path: string): Promise<RuntimeDb> {
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec(createSchemaSql());
  sqlite
    .prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
    .run(CURRENT_SCHEMA_VERSION, INITIAL_SCHEMA_NAME, Date.now());

  const selectStatements = {
    runtime_opencode_configs: sqlite.prepare("SELECT config_json AS configJson FROM runtime_opencode_configs WHERE workspace_id = ?"),
    openwork_workspace_configs: sqlite.prepare("SELECT config_json AS configJson FROM openwork_workspace_configs WHERE workspace_id = ?"),
  };
  const upsertStatements = {
    runtime_opencode_configs: sqlite.prepare("INSERT INTO runtime_opencode_configs (workspace_id, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at"),
    openwork_workspace_configs: sqlite.prepare("INSERT INTO openwork_workspace_configs (workspace_id, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at"),
  };

  function getJsonRow(table: RuntimeJsonTable, workspaceId: string): RuntimeJsonRow | undefined {
    const row = selectStatements[table].get(workspaceId);
    if (!isRecord(row) || typeof row.configJson !== "string") return undefined;
    return { configJson: row.configJson };
  }

  return {
    path,
    getJsonRow,
    updateJsonRow: (table, workspaceId, updater) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const configJson = updater(getJsonRow(table, workspaceId)?.configJson);
        upsertStatements[table].run(workspaceId, configJson, Date.now());
        sqlite.exec("COMMIT");
        return configJson;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    diagnostics: () => {
      const migrations = sqlite
        .prepare("SELECT version, name, applied_at AS appliedAt FROM schema_migrations ORDER BY version")
        .all()
        .map(normalizeMigrationRow)
        .filter((row): row is RuntimeMigrationRow => row !== undefined);
      const count = (table: RuntimeJsonTable | "migration_state") => {
        const row = sqlite.prepare(rowCountSql(table)).get();
        return isRecord(row) && typeof row.count === "number" ? row.count : 0;
      };
      return {
        path,
        schemaVersion: getSchemaVersion(migrations),
        migrations,
        tables: {
          runtime_opencode_configs: count("runtime_opencode_configs"),
          openwork_workspace_configs: count("openwork_workspace_configs"),
          migration_state: count("migration_state"),
        },
      };
    },
  };
}

const dbByPath = new Map<string, Promise<RuntimeDb>>();
const updateQueueByPath = new Map<string, Promise<void>>();

export async function openRuntimeDb(config: ServerConfig): Promise<RuntimeDb> {
  const path = runtimeDbPath(config);
  const existing = dbByPath.get(path);
  if (existing) return existing;
  await ensureDir(dirname(path));
  const db = typeof process.versions.bun === "string" ? openBunRuntimeDb(path) : openNodeRuntimeDb(path);
  dbByPath.set(path, db);
  return db;
}

export async function updateRuntimeJsonRow(
  config: ServerConfig,
  table: RuntimeJsonTable,
  workspaceId: string,
  updater: (currentJson: string | undefined) => string,
): Promise<string> {
  const db = await openRuntimeDb(config);
  const previous = updateQueueByPath.get(db.path) ?? Promise.resolve();
  const waitForPrevious = previous.catch(() => {});
  let release: () => void = () => {};
  const nextQueue = new Promise<void>((resolveQueue) => {
    release = resolveQueue;
  });
  const queued = waitForPrevious.then(() => nextQueue);
  updateQueueByPath.set(db.path, queued);
  await waitForPrevious;
  try {
    return db.updateJsonRow(table, workspaceId, updater);
  } finally {
    release();
    if (updateQueueByPath.get(db.path) === queued) updateQueueByPath.delete(db.path);
  }
}

export async function getRuntimeDbDiagnostics(config: ServerConfig): Promise<RuntimeDbDiagnostics> {
  return (await openRuntimeDb(config)).diagnostics();
}
