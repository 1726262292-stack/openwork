import { resolve } from "node:path";
import type { DesktopDb } from "../client";
import {
  authorizedRootTable,
  serverConfigTable,
  workspaceTable,
} from "../schema/index";
import { createDesktopTypeId } from "../typeid";
import { type ImportResult, readJsonFile } from "./helpers";

/**
 * Import `server.json` into the DB:
 * - scalar server settings -> server_config (key/value)
 * - workspaces[] -> workspace table (id preserved, order preserved)
 * - authorizedRoots[] -> authorized_root table (server-global, workspaceId = NULL)
 *
 * Idempotent: re-running upserts the same rows.
 */

interface ServerJsonWorkspace {
  id?: string;
  path: string;
  name?: string;
  preset?: string;
  workspaceType?: string;
  remoteType?: string;
  baseUrl?: string;
  directory?: string;
  displayName?: string;
  openworkHostUrl?: string;
  openworkToken?: string;
  openworkWorkspaceId?: string;
  openworkWorkspaceName?: string;
  sandboxBackend?: string;
  sandboxRunId?: string;
  sandboxContainerName?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
}

interface ServerJson {
  host?: string;
  port?: number;
  token?: string;
  hostToken?: string;
  approval?: { mode?: string; timeoutMs?: number };
  workspaces?: ServerJsonWorkspace[];
  corsOrigins?: string[];
  authorizedRoots?: string[];
  readOnly?: boolean;
  opencodeBaseUrl?: string;
  opencodeDirectory?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  logFormat?: string;
  logRequests?: boolean;
}

const SERVER_CONFIG_KEYS: (keyof ServerJson)[] = [
  "host",
  "port",
  "token",
  "hostToken",
  "approval",
  "corsOrigins",
  "readOnly",
  "opencodeBaseUrl",
  "opencodeDirectory",
  "opencodeUsername",
  "opencodePassword",
  "logFormat",
  "logRequests",
];

export async function importServerJson(db: DesktopDb, path: string): Promise<ImportResult> {
  const parsed = await readJsonFile<ServerJson>(path);
  if (!parsed) return { count: 0, found: false };

  const now = Date.now();
  let count = 0;

  db.transaction((tx) => {
    // Scalar server settings -> server_config
    for (const key of SERVER_CONFIG_KEYS) {
      const value = parsed[key];
      if (value === undefined) continue;
      tx.insert(serverConfigTable)
        .values({ key, value, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: serverConfigTable.key,
          set: { value, updatedAt: now },
        })
        .run();
      count += 1;
    }

    // Workspaces (preserve array order via sortOrder)
    const workspaces = parsed.workspaces ?? [];
    workspaces.forEach((ws, index) => {
      const id = ws.id ?? `ws_${resolve(ws.path)}`;
      tx.insert(workspaceTable)
        .values({
          id,
          path: ws.path,
          name: ws.name ?? ws.path,
          preset: ws.preset ?? null,
          workspaceType: ws.workspaceType ?? "local",
          remoteType: ws.remoteType ?? null,
          baseUrl: ws.baseUrl ?? null,
          directory: ws.directory ?? null,
          displayName: ws.displayName ?? null,
          openworkHostUrl: ws.openworkHostUrl ?? null,
          openworkToken: ws.openworkToken ?? null,
          openworkWorkspaceId: ws.openworkWorkspaceId ?? null,
          openworkWorkspaceName: ws.openworkWorkspaceName ?? null,
          sandboxBackend: ws.sandboxBackend ?? null,
          sandboxRunId: ws.sandboxRunId ?? null,
          sandboxContainerName: ws.sandboxContainerName ?? null,
          opencodeUsername: ws.opencodeUsername ?? null,
          opencodePassword: ws.opencodePassword ?? null,
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: workspaceTable.id,
          set: {
            path: ws.path,
            name: ws.name ?? ws.path,
            preset: ws.preset ?? null,
            workspaceType: ws.workspaceType ?? "local",
            remoteType: ws.remoteType ?? null,
            baseUrl: ws.baseUrl ?? null,
            directory: ws.directory ?? null,
            displayName: ws.displayName ?? null,
            openworkHostUrl: ws.openworkHostUrl ?? null,
            openworkToken: ws.openworkToken ?? null,
            openworkWorkspaceId: ws.openworkWorkspaceId ?? null,
            openworkWorkspaceName: ws.openworkWorkspaceName ?? null,
            sandboxBackend: ws.sandboxBackend ?? null,
            sandboxRunId: ws.sandboxRunId ?? null,
            sandboxContainerName: ws.sandboxContainerName ?? null,
            opencodeUsername: ws.opencodeUsername ?? null,
            opencodePassword: ws.opencodePassword ?? null,
            sortOrder: index,
            updatedAt: now,
          },
        })
        .run();
      count += 1;
    });

    // Authorized roots (server-global)
    for (const root of parsed.authorizedRoots ?? []) {
      const resolved = resolve(root);
      tx.insert(authorizedRootTable)
        .values({
          id: createDesktopTypeId("authorizedRoot"),
          workspaceId: null,
          path: resolved,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: authorizedRootTable.path })
        .run();
      count += 1;
    }
  });

  return { count, found: true };
}
