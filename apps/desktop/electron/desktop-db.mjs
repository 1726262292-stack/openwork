// DB-backed desktop state for the Electron main process.
//
// Opens the SAME SQLite DB the OpenWork server uses (next to server.json), so the
// desktop workspace list, per-workspace server tokens, and preferred ports are a single
// source of truth shared with the server. The original Electron JSON files
// (openwork-workspaces.json, openwork-server-tokens.json, openwork-server-state.json)
// are imported once and left untouched in place (no copy/rename/delete) so an older
// (pre-DB) app version still works after a rollback.

import {
  openDb,
  resolveDbPathForServerConfig,
  runDesktopImportOnce,
  workspaceTable,
  workspaceServerTokenTable,
  workspacePortTable,
  preferenceTable,
  authorizedRootTable,
  drizzle,
  DESKTOP_SELECTED_WORKSPACE_PREF,
  DESKTOP_WATCHED_WORKSPACE_PREF,
  DESKTOP_PREFERRED_PORT_PREF,
  getAllMirroredPreferences,
  getPreference as getPreferenceFromDb,
  setPreference as setPreferenceInDb,
  removePreference as removePreferenceFromDb,
  readEnvForInjection,
  getDesktopBootstrapConfig as getBootstrapFromDb,
  setDesktopBootstrapConfig as setBootstrapInDb,
} from "@openwork/desktop-db";

const { eq, asc } = drizzle;

let dbPromise = null;
let importedFor = null;

/**
 * Open (and migrate) the desktop DB, then run the one-time import of the Electron state
 * files. `serverConfigPath` pins the DB next to server.json. `userDataDir` locates the
 * three legacy JSON files. Cached per process.
 */
export async function getDesktopDb({ serverConfigPath, userDataDir, envPath, bootstrapPath }) {
  const dbPath = resolveDbPathForServerConfig(serverConfigPath);
  if (!dbPromise) {
    dbPromise = openDb({ path: dbPath });
  }
  const db = await dbPromise;

  if (userDataDir && importedFor !== dbPath) {
    importedFor = dbPath;
    const path = await import("node:path");
    await runDesktopImportOnce(db, {
      workspacesPath: path.join(userDataDir, "openwork-workspaces.json"),
      serverTokensPath: path.join(userDataDir, "openwork-server-tokens.json"),
      serverStatePath: path.join(userDataDir, "openwork-server-state.json"),
      envPath: envPath ?? undefined,
      bootstrapPath: bootstrapPath ?? undefined,
    }).catch((error) => {
      console.warn("[desktop-db] one-time import failed", error);
    });
  }

  return db;
}

function rowToWorkspaceEntry(row) {
  const isLocal = row.workspaceType !== "remote";
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    preset: row.preset ?? "starter",
    workspaceType: row.workspaceType ?? "local",
    remoteType: row.remoteType ?? null,
    baseUrl: !isLocal ? row.baseUrl ?? null : null,
    directory: !isLocal ? row.directory ?? null : null,
    displayName: row.displayName ?? null,
    openworkHostUrl: row.openworkHostUrl ?? null,
    openworkToken: row.openworkToken ?? null,
    openworkClientToken: row.openworkClientToken ?? null,
    openworkHostToken: row.openworkHostToken ?? null,
    openworkWorkspaceId: row.openworkWorkspaceId ?? null,
    openworkWorkspaceName: row.openworkWorkspaceName ?? null,
    sandboxBackend: row.sandboxBackend ?? null,
    sandboxRunId: row.sandboxRunId ?? null,
    sandboxContainerName: row.sandboxContainerName ?? null,
  };
}

async function readPreference(db, key) {
  const rows = await db.select().from(preferenceTable).where(eq(preferenceTable.key, key));
  return rows[0]?.value ?? null;
}

function writePreference(db, key, value, now) {
  db.insert(preferenceTable)
    .values({ key, value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: preferenceTable.key, set: { value, updatedAt: now } })
    .run();
}

/** Read the desktop workspace state (workspaces + selection) from the DB. */
export async function readWorkspaceStateFromDb(db) {
  const rows = await db.select().from(workspaceTable).orderBy(asc(workspaceTable.sortOrder));
  const workspaces = rows.map(rowToWorkspaceEntry);
  const selectedId = String((await readPreference(db, DESKTOP_SELECTED_WORKSPACE_PREF)) ?? "");
  const watchedRaw = await readPreference(db, DESKTOP_WATCHED_WORKSPACE_PREF);
  const watchedId = watchedRaw ? String(watchedRaw) : null;
  return {
    selectedId,
    selectedWorkspaceId: selectedId,
    watchedId,
    watchedWorkspaceId: watchedId,
    activeId: selectedId || null,
    workspaces,
  };
}

/** Replace the desktop workspace state (workspaces + selection) in the DB. */
export async function writeWorkspaceStateToDb(db, nextState) {
  const now = Date.now();
  const workspaces = Array.isArray(nextState?.workspaces) ? nextState.workspaces : [];
  const selectedId = String(nextState?.selectedId ?? nextState?.activeId ?? "");
  const watchedId = typeof nextState?.watchedId === "string" ? nextState.watchedId : "";

  db.transaction((tx) => {
    tx.delete(workspaceTable).run();
    workspaces.forEach((ws, index) => {
      const id = String(ws?.id ?? "").trim();
      if (!id) return;
      const isLocal = ws.workspaceType !== "remote";
      tx.insert(workspaceTable)
        .values({
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
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
    writePreference(tx, DESKTOP_SELECTED_WORKSPACE_PREF, selectedId, now);
    writePreference(tx, DESKTOP_WATCHED_WORKSPACE_PREF, watchedId, now);
  });

  return readWorkspaceStateFromDb(db);
}

// --- Per-workspace server tokens (workspace_server_token table) ---

export async function loadWorkspaceTokensFromDb(db, workspaceKey) {
  const rows = await db
    .select()
    .from(workspaceServerTokenTable)
    .where(eq(workspaceServerTokenTable.workspaceKey, workspaceKey));
  const row = rows[0];
  if (!row) return null;
  return {
    clientToken: row.clientToken,
    hostToken: row.hostToken,
    ownerToken: row.ownerToken ?? null,
    updatedAt: row.updatedAt,
  };
}

export async function saveWorkspaceTokensToDb(db, workspaceKey, tokens) {
  const now = Date.now();
  await db
    .insert(workspaceServerTokenTable)
    .values({
      workspaceKey,
      clientToken: tokens.clientToken ?? null,
      hostToken: tokens.hostToken ?? null,
      ownerToken: tokens.ownerToken ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workspaceServerTokenTable.workspaceKey,
      set: {
        clientToken: tokens.clientToken ?? null,
        hostToken: tokens.hostToken ?? null,
        ownerToken: tokens.ownerToken ?? null,
        updatedAt: now,
      },
    })
    .run();
}

export async function setWorkspaceOwnerTokenInDb(db, workspaceKey, ownerToken) {
  const existing = await loadWorkspaceTokensFromDb(db, workspaceKey);
  if (!existing) return;
  await db
    .update(workspaceServerTokenTable)
    .set({ ownerToken, updatedAt: Date.now() })
    .where(eq(workspaceServerTokenTable.workspaceKey, workspaceKey))
    .run();
}

// --- Preferred ports (workspace_port table + preference) ---

export async function readPreferredPortFromDb(db, workspaceKey) {
  if (workspaceKey) {
    const rows = await db
      .select()
      .from(workspacePortTable)
      .where(eq(workspacePortTable.workspaceKey, workspaceKey));
    if (rows[0]) return rows[0].port;
  }
  const pref = await readPreference(db, DESKTOP_PREFERRED_PORT_PREF);
  return typeof pref === "number" ? pref : null;
}

export async function persistPreferredPortInDb(db, workspaceKey, port) {
  const now = Date.now();
  if (workspaceKey) {
    await db
      .insert(workspacePortTable)
      .values({ workspaceKey, port, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: workspacePortTable.workspaceKey, set: { port, updatedAt: now } })
      .run();
    // Clear the global preferred-port preference (matches old port-state semantics).
    writePreference(db, DESKTOP_PREFERRED_PORT_PREF, null, now);
  } else {
    writePreference(db, DESKTOP_PREFERRED_PORT_PREF, port, now);
  }
}

// --- Renderer preference mirror (preference table) ---

/** All mirrored renderer preferences as `key -> rawString` (for boot hydration). */
export async function getAllPreferences(db) {
  return getAllMirroredPreferences(db);
}

export async function getPreference(db, key) {
  return getPreferenceFromDb(db, key);
}

export async function setPreference(db, key, value) {
  await setPreferenceInDb(db, key, String(value));
}

export async function removePreference(db, key) {
  await removePreferenceFromDb(db, key);
}

// --- User env vars (env_var table) for child-process injection ---

/** Flat `key -> value` of user env vars (reserved keys stripped) for process.env. */
export async function readUserEnvForInjection(db) {
  return readEnvForInjection(db);
}

// --- Desktop bootstrap (cloud / Den) config ---

export async function getDesktopBootstrap(db) {
  return getBootstrapFromDb(db);
}

export async function setDesktopBootstrap(db, config) {
  await setBootstrapInDb(db, config);
  return getBootstrapFromDb(db);
}

export { authorizedRootTable };
