import { eq } from "drizzle-orm";
import type { DesktopDb } from "../client";
import {
  migrationStateTable,
  preferenceTable,
  workspacePortTable,
  workspaceServerTokenTable,
  workspaceTable,
} from "../schema/index";
import { type ImportResult, readJsonFile } from "./helpers";
import { fileFingerprint, snapshotOnce } from "./fingerprint";

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

export interface DesktopImportOptions {
  workspacesPath: string;
  serverTokensPath: string;
  serverStatePath: string;
}

export type DesktopImportStatus = "imported" | "already-done" | "missing" | "error";

export interface DesktopImportEntry {
  source: string;
  status: DesktopImportStatus;
  fingerprint: string;
  rowCount: number;
  backupPath: string | null;
  error?: string;
}

export type DesktopImportReport = Record<string, DesktopImportEntry>;

async function getState(db: DesktopDb, source: string) {
  const rows = await db
    .select()
    .from(migrationStateTable)
    .where(eq(migrationStateTable.source, source));
  return rows[0] ?? null;
}

function recordState(
  db: DesktopDb,
  entry: { source: string; status: string; fingerprint: string; rowCount: number; backupPath: string | null },
) {
  const now = Date.now();
  db.insert(migrationStateTable)
    .values({ ...entry, importedAt: now })
    .onConflictDoUpdate({
      target: migrationStateTable.source,
      set: {
        status: entry.status,
        fingerprint: entry.fingerprint,
        rowCount: entry.rowCount,
        backupPath: entry.backupPath,
        importedAt: now,
      },
    })
    .run();
}

/**
 * One-time import of the three Electron state files, gated by `migration_state`
 * (keyed `electron:<file>`). Snapshots `.pre-db.bak`, preserves the originals, and
 * skips when the source fingerprint is unchanged. Cheap on subsequent starts.
 */
export async function runDesktopImportOnce(
  db: DesktopDb,
  options: DesktopImportOptions,
): Promise<DesktopImportReport> {
  const sources: Array<{
    key: string;
    path: string;
    run: (db: DesktopDb, path: string) => Promise<ImportResult>;
  }> = [
    { key: "electron:openwork-workspaces.json", path: options.workspacesPath, run: importElectronWorkspaces },
    { key: "electron:openwork-server-tokens.json", path: options.serverTokensPath, run: importElectronServerTokens },
    { key: "electron:openwork-server-state.json", path: options.serverStatePath, run: importElectronServerState },
  ];

  const report: DesktopImportReport = {};

  for (const source of sources) {
    const fingerprint = await fileFingerprint(source.path);
    if (fingerprint === null) {
      report[source.key] = { source: source.key, status: "missing", fingerprint: "", rowCount: 0, backupPath: null };
      continue;
    }

    const prior = await getState(db, source.key);
    if (prior && prior.status === "imported" && prior.fingerprint === fingerprint) {
      report[source.key] = {
        source: source.key,
        status: "already-done",
        fingerprint,
        rowCount: prior.rowCount,
        backupPath: prior.backupPath ?? null,
      };
      continue;
    }

    try {
      const backupPath = await snapshotOnce(source.path);
      const result = await source.run(db, source.path);
      recordState(db, { source: source.key, status: "imported", fingerprint, rowCount: result.count, backupPath });
      report[source.key] = { source: source.key, status: "imported", fingerprint, rowCount: result.count, backupPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordState(db, { source: source.key, status: "error", fingerprint, rowCount: 0, backupPath: null });
      report[source.key] = { source: source.key, status: "error", fingerprint, rowCount: 0, backupPath: null, error: message };
    }
  }

  return report;
}
