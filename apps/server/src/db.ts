/**
 * Shared accessor for the OpenWork desktop SQLite DB.
 *
 * The DB is the runtime source of truth for OpenWork-owned state (server config,
 * workspace registry, tokens, audit). The original JSON/JSONL files are preserved
 * (and snapshotted to `.pre-db.bak`) for revert; they are no longer written at runtime.
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  openDb,
  closeDb,
  resolveDefaultDbPath,
  runPhase1ImportOnce,
  workspaceTable,
  authorizedRootTable,
  drizzle,
  type DesktopDb,
  type ImportOnceReport,
} from "@openwork/desktop-db";
import type { ServerConfig, WorkspaceConfig } from "./types.js";
import { buildWorkspaceInfos } from "./workspaces.js";

let dbPromise: Promise<DesktopDb> | null = null;
let dbPath: string | null = null;
let importedFor: string | null = null;

/**
 * Resolve the DB path from the server config so it sits next to `server.json`
 * (or honors `OPENWORK_DB`). Falls back to the package default.
 */
function resolveDbPath(config?: ServerConfig): string {
  // A per-workspace config path wins so each server instance gets its own DB next to
  // its server.json. `OPENWORK_DB` / platform defaults are the no-config fallback.
  const configPath = config?.configPath?.trim();
  if (configPath) return join(dirname(configPath), "openwork.db");
  return resolveDefaultDbPath();
}

/** Open (and migrate) the desktop DB, cached per-process and keyed by resolved path. */
export async function getDb(config?: ServerConfig): Promise<DesktopDb> {
  const path = resolveDbPath(config);
  if (dbPromise && dbPath === path) return dbPromise;
  if (dbPromise && dbPath !== path) {
    // Path changed (e.g. between tests). Reset the package singleton.
    closeDb();
    importedFor = null;
  }
  dbPath = path;
  dbPromise = openDb({ path });
  return dbPromise;
}

/** Reset the cached DB connection (tests only). */
export function resetDbForTests(): void {
  closeDb();
  dbPromise = null;
  dbPath = null;
  importedFor = null;
}

/**
 * Run the one-time file -> DB import (guarded by `migration_state`). Resolves the
 * source paths from the server config so a custom `--config` / data dir is honored.
 * Safe and cheap to call on every startup.
 */
export async function ensureImported(config: ServerConfig): Promise<ImportOnceReport | null> {
  const db = await getDb(config);
  const key = config.configPath ?? "";
  if (importedFor === key) return null;
  importedFor = key;

  const serverJsonPath = config.configPath?.trim() || join(homedir(), ".config", "openwork", "server.json");
  return runPhase1ImportOnce(db, {
    serverJsonPath,
    // tokens.json + audit dir resolve from env/defaults inside the importer.
  });
}

/**
 * Load the workspace registry from the DB as `WorkspaceConfig[]` (ordered by
 * `sortOrder`, so index 0 = active). Returns null if the DB has no workspaces yet
 * (caller should fall back to the file-derived config).
 */
export async function loadWorkspaceRegistryFromDb(
  config: ServerConfig,
): Promise<{ workspaces: WorkspaceConfig[]; authorizedRoots: string[] } | null> {
  const db = await getDb(config);
  const rows = await db
    .select()
    .from(workspaceTable)
    .orderBy(drizzle.asc(workspaceTable.sortOrder));
  if (rows.length === 0) return null;

  const workspaces: WorkspaceConfig[] = rows.map((row) => ({
    id: row.id,
    path: row.path,
    name: row.name,
    preset: row.preset ?? undefined,
    workspaceType: (row.workspaceType as WorkspaceConfig["workspaceType"]) ?? "local",
    remoteType: (row.remoteType as WorkspaceConfig["remoteType"]) ?? undefined,
    baseUrl: row.baseUrl ?? undefined,
    directory: row.directory ?? undefined,
    displayName: row.displayName ?? undefined,
    openworkHostUrl: row.openworkHostUrl ?? undefined,
    openworkToken: row.openworkToken ?? undefined,
    openworkWorkspaceId: row.openworkWorkspaceId ?? undefined,
    openworkWorkspaceName: row.openworkWorkspaceName ?? undefined,
    sandboxBackend: row.sandboxBackend ?? undefined,
    sandboxRunId: row.sandboxRunId ?? undefined,
    sandboxContainerName: row.sandboxContainerName ?? undefined,
    opencodeUsername: row.opencodeUsername ?? undefined,
    opencodePassword: row.opencodePassword ?? undefined,
  }));

  const rootRows = await db.select().from(authorizedRootTable);
  const authorizedRoots = rootRows.map((row) => row.path);

  return { workspaces, authorizedRoots };
}

/**
 * Reconcile a freshly-resolved `ServerConfig` with the DB:
 * 1. Run the one-time file -> DB import (preserves source files; gated by fingerprint).
 * 2. If the DB holds a workspace registry, make it authoritative — rebuild
 *    `config.workspaces` and `config.authorizedRoots` from the DB.
 *
 * Call this right after `resolveServerConfig`, BEFORE managed-OpenCode wiring (so its
 * mutations apply to the DB-derived workspaces). Mutates `config` in place.
 */
export async function reconcileConfigWithDb(config: ServerConfig): Promise<void> {
  await ensureImported(config);
  const registry = await loadWorkspaceRegistryFromDb(config);
  if (!registry) return;

  const configDir = config.configPath ? dirname(config.configPath) : process.cwd();
  config.workspaces = buildWorkspaceInfos(registry.workspaces, configDir);
  if (registry.authorizedRoots.length > 0) {
    config.authorizedRoots = registry.authorizedRoots;
  }
}
