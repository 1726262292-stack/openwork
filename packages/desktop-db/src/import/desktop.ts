import type { DesktopDb } from "../client";
import {
  envVarTable,
  preferenceTable,
  workspacePortTable,
  workspaceServerTokenTable,
  workspaceTable,
} from "../schema/index";
import { isReservedEnvKey, isValidEnvKey } from "../env-store";
import {
  BOOTSTRAP_API_BASE_URL_PREF,
  BOOTSTRAP_BASE_URL_PREF,
  BOOTSTRAP_REQUIRE_SIGNIN_PREF,
} from "../bootstrap";
import { type ImportResult, readJsonFile } from "./helpers";
import { runImportSourcesOnce, type ImportSource } from "./gate";

/**
 * Importers for the Electron desktop-only state files (under `app.getPath("userData")`):
 * - `openwork-workspaces.json`  -> workspace table + selection (preference rows)
 * - `openwork-server-tokens.json` -> workspace_server_token table
 * - `openwork-server-state.json`  -> workspace_port table + preferred port preference
 *
 * Source files are preserved; `runDesktopImportOnce` snapshots `.pre-db.bak` and gates
 * via `migration_state` (same pattern as the server-side Phase 1 import).
 */

interface ElectronWorkspaceEntry {
  id?: string;
  name?: string;
  path?: string;
  preset?: string;
  workspaceType?: string;
  remoteType?: string | null;
  baseUrl?: string | null;
  directory?: string | null;
  displayName?: string | null;
  openworkHostUrl?: string | null;
  openworkToken?: string | null;
  openworkClientToken?: string | null;
  openworkHostToken?: string | null;
  openworkWorkspaceId?: string | null;
  openworkWorkspaceName?: string | null;
  sandboxBackend?: string | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
}

interface ElectronWorkspaceState {
  selectedId?: string;
  selectedWorkspaceId?: string;
  watchedId?: string | null;
  watchedWorkspaceId?: string | null;
  activeId?: string | null;
  workspaces?: ElectronWorkspaceEntry[];
}

export const DESKTOP_SELECTED_WORKSPACE_PREF = "desktop.selectedWorkspaceId";
export const DESKTOP_WATCHED_WORKSPACE_PREF = "desktop.watchedWorkspaceId";
export const DESKTOP_PREFERRED_PORT_PREF = "desktop.preferredPort";

function setPreference(db: DesktopDb, key: string, value: unknown, now: number) {
  db.insert(preferenceTable)
    .values({ key, value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: preferenceTable.key, set: { value, updatedAt: now } })
    .run();
}

export async function importElectronWorkspaces(db: DesktopDb, path: string): Promise<ImportResult> {
  const parsed = await readJsonFile<ElectronWorkspaceState>(path);
  if (!parsed) return { count: 0, found: false };

  const now = Date.now();
  let count = 0;
  const workspaces = parsed.workspaces ?? [];
  const selectedId = parsed.selectedId ?? parsed.selectedWorkspaceId ?? parsed.activeId ?? "";
  const watchedId = parsed.watchedId ?? parsed.watchedWorkspaceId ?? "";

  db.transaction((tx) => {
    workspaces.forEach((ws, index) => {
      const id = String(ws.id ?? "").trim();
      if (!id) return;
      const isLocal = ws.workspaceType !== "remote";
      const values = {
        id,
        path: ws.path ?? "",
        name: ws.name ?? ws.path ?? "Workspace",
        preset: ws.preset ?? null,
        workspaceType: ws.workspaceType ?? "local",
        remoteType: ws.remoteType ?? null,
        baseUrl: !isLocal ? ws.baseUrl ?? null : null,
        directory: !isLocal ? ws.directory ?? null : null,
        displayName: ws.displayName ?? null,
        openworkHostUrl: ws.openworkHostUrl ?? null,
        openworkToken: ws.openworkToken ?? null,
        openworkClientToken: ws.openworkClientToken ?? null,
        openworkHostToken: ws.openworkHostToken ?? null,
        openworkWorkspaceId: ws.openworkWorkspaceId ?? null,
        openworkWorkspaceName: ws.openworkWorkspaceName ?? null,
        sandboxBackend: ws.sandboxBackend ?? null,
        sandboxRunId: ws.sandboxRunId ?? null,
        sandboxContainerName: ws.sandboxContainerName ?? null,
        sortOrder: index,
        updatedAt: now,
      };
      tx.insert(workspaceTable)
        .values({ ...values, createdAt: now })
        .onConflictDoUpdate({ target: workspaceTable.id, set: values })
        .run();
      count += 1;
    });

    setPreference(tx as unknown as DesktopDb, DESKTOP_SELECTED_WORKSPACE_PREF, selectedId, now);
    setPreference(tx as unknown as DesktopDb, DESKTOP_WATCHED_WORKSPACE_PREF, watchedId, now);
  });

  return { count, found: true };
}

interface ElectronTokenStore {
  version?: number;
  workspaces?: Record<
    string,
    { clientToken?: string | null; hostToken?: string | null; ownerToken?: string | null; updatedAt?: number }
  >;
}

export async function importElectronServerTokens(db: DesktopDb, path: string): Promise<ImportResult> {
  const parsed = await readJsonFile<ElectronTokenStore>(path);
  if (!parsed) return { count: 0, found: false };

  const now = Date.now();
  let count = 0;
  const entries = Object.entries(parsed.workspaces ?? {});

  db.transaction((tx) => {
    for (const [workspaceKey, tokens] of entries) {
      const values = {
        workspaceKey,
        clientToken: tokens.clientToken ?? null,
        hostToken: tokens.hostToken ?? null,
        ownerToken: tokens.ownerToken ?? null,
        createdAt: tokens.updatedAt ?? now,
        updatedAt: tokens.updatedAt ?? now,
      };
      tx.insert(workspaceServerTokenTable)
        .values(values)
        .onConflictDoUpdate({
          target: workspaceServerTokenTable.workspaceKey,
          set: {
            clientToken: values.clientToken,
            hostToken: values.hostToken,
            ownerToken: values.ownerToken,
            updatedAt: values.updatedAt,
          },
        })
        .run();
      count += 1;
    }
  });

  return { count, found: true };
}

interface ElectronPortState {
  version?: number;
  workspacePorts?: Record<string, number>;
  preferredPort?: number | null;
}

export async function importElectronServerState(db: DesktopDb, path: string): Promise<ImportResult> {
  const parsed = await readJsonFile<ElectronPortState>(path);
  if (!parsed) return { count: 0, found: false };

  const now = Date.now();
  let count = 0;
  const ports = Object.entries(parsed.workspacePorts ?? {});

  db.transaction((tx) => {
    for (const [workspaceKey, port] of ports) {
      if (typeof port !== "number") continue;
      tx.insert(workspacePortTable)
        .values({ workspaceKey, port, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: workspacePortTable.workspaceKey,
          set: { port, updatedAt: now },
        })
        .run();
      count += 1;
    }
    if (typeof parsed.preferredPort === "number") {
      setPreference(tx as unknown as DesktopDb, DESKTOP_PREFERRED_PORT_PREF, parsed.preferredPort, now);
      count += 1;
    }
  });

  return { count, found: true };
}

interface EnvJsonFile {
  schemaVersion?: number;
  variables?: Array<{ key?: unknown; value?: unknown; updatedAt?: unknown }>;
}

/** Import env.json -> env_var table (skips invalid + reserved keys). */
export async function importEnvJson(db: DesktopDb, path: string): Promise<ImportResult> {
  const parsed = await readJsonFile<EnvJsonFile>(path);
  if (!parsed) return { count: 0, found: false };
  const now = Date.now();
  let count = 0;
  const variables = Array.isArray(parsed.variables) ? parsed.variables : [];

  db.transaction((tx) => {
    for (const entry of variables) {
      const key = typeof entry?.key === "string" ? entry.key : "";
      const value = typeof entry?.value === "string" ? entry.value : "";
      if (!isValidEnvKey(key) || isReservedEnvKey(key)) continue;
      const updatedAt = typeof entry?.updatedAt === "number" ? entry.updatedAt : now;
      tx.insert(envVarTable)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({ target: envVarTable.key, set: { value, updatedAt } })
        .run();
      count += 1;
    }
  });

  return { count, found: true };
}

interface BootstrapJsonFile {
  baseUrl?: unknown;
  apiBaseUrl?: unknown;
  requireSignin?: unknown;
}

/** Import desktop-bootstrap.json -> bootstrap preference rows. */
export async function importDesktopBootstrap(db: DesktopDb, path: string): Promise<ImportResult> {
  const parsed = await readJsonFile<BootstrapJsonFile>(path);
  if (!parsed) return { count: 0, found: false };
  const now = Date.now();
  const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "";
  const apiBaseUrl = typeof parsed.apiBaseUrl === "string" ? parsed.apiBaseUrl.trim() : "";
  const requireSignin = parsed.requireSignin === true;

  // preference.value is NOT NULL JSON; store "" for unset URLs.
  db.transaction((tx) => {
    setPreference(tx as unknown as DesktopDb, BOOTSTRAP_BASE_URL_PREF, baseUrl, now);
    setPreference(tx as unknown as DesktopDb, BOOTSTRAP_API_BASE_URL_PREF, apiBaseUrl, now);
    setPreference(tx as unknown as DesktopDb, BOOTSTRAP_REQUIRE_SIGNIN_PREF, requireSignin, now);
  });

  return { count: 1, found: true };
}

export interface DesktopImportOptions {
  workspacesPath: string;
  serverTokensPath: string;
  serverStatePath: string;
  envPath?: string;
  bootstrapPath?: string;
}

export type { ImportOnceStatus as DesktopImportStatus, ImportOnceEntry as DesktopImportEntry } from "./gate";
export type DesktopImportReport = Record<string, import("./gate").ImportOnceEntry>;

/**
 * One-time import of the Electron state files (+ env.json, desktop-bootstrap.json),
 * gated by `migration_state` (keyed `electron:<file>` / `env.json` / etc.).
 *
 * Each source is imported AT MOST ONCE. Source files are never modified, copied, or
 * deleted — they stay in place so an older (pre-DB) app version still works after a
 * rollback. Cheap on subsequent starts (a single DB lookup per source before file I/O).
 */
export async function runDesktopImportOnce(
  db: DesktopDb,
  options: DesktopImportOptions,
): Promise<DesktopImportReport> {
  const sources: ImportSource[] = [
    { key: "electron:openwork-workspaces.json", path: options.workspacesPath, kind: "file", run: importElectronWorkspaces },
    { key: "electron:openwork-server-tokens.json", path: options.serverTokensPath, kind: "file", run: importElectronServerTokens },
    { key: "electron:openwork-server-state.json", path: options.serverStatePath, kind: "file", run: importElectronServerState },
  ];

  if (options.envPath) {
    sources.push({ key: "env.json", path: options.envPath, kind: "file", run: importEnvJson });
  }
  if (options.bootstrapPath) {
    sources.push({ key: "desktop-bootstrap.json", path: options.bootstrapPath, kind: "file", run: importDesktopBootstrap });
  }

  return runImportSourcesOnce(db, sources);
}
