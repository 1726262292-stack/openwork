import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { epochMs, jsonColumn, secretText, timestamps, typeIdColumn } from "../columns";

/**
 * Workspaces — replaces `server.json` `workspaces[]` registry AND the Electron
 * `openwork-workspaces.json` list (these duplicate each other today).
 *
 * The workspace `id` is the deterministic `ws_<sha256[:12]>` identifier from the server
 * (`workspaces.ts`). We keep it as the primary key but store it as plain text (NOT a
 * TypeID) because it is content-derived and must stay stable across the migration.
 */
export const workspaceTable = sqliteTable(
  "workspace",
  {
    /** Deterministic ws_<hash> id (server `workspaceIdForKey`). Stable, content-derived. */
    id: text("id").primaryKey(),
    path: text("path").notNull(),
    name: text("name").notNull(),
    preset: text("preset"),
    /** "local" | "remote" */
    workspaceType: text("workspace_type").notNull().default("local"),
    /** "opencode" | "openwork" */
    remoteType: text("remote_type"),
    baseUrl: text("base_url"),
    directory: text("directory"),
    displayName: text("display_name"),
    openworkHostUrl: text("openwork_host_url"),
    openworkToken: secretText("openwork_token"),
    /** Per-remote-workspace client/host tokens (desktop `openwork-workspaces.json`). */
    openworkClientToken: secretText("openwork_client_token"),
    openworkHostToken: secretText("openwork_host_token"),
    openworkWorkspaceId: text("openwork_workspace_id"),
    openworkWorkspaceName: text("openwork_workspace_name"),
    sandboxBackend: text("sandbox_backend"),
    sandboxRunId: text("sandbox_run_id"),
    sandboxContainerName: text("sandbox_container_name"),
    opencodeUsername: text("opencode_username"),
    opencodePassword: secretText("opencode_password"),
    /** Active-workspace ordering. Lower = earlier; index 0 = active workspace. */
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workspace_path_unique").on(table.path),
    index("workspace_sort_order_idx").on(table.sortOrder),
  ],
);

/**
 * Authorized roots — replaces `server.json` `authorizedRoots[]`. Server-global today;
 * we key by workspace for forward flexibility, with a NULL workspace meaning global.
 */
export const authorizedRootTable = sqliteTable(
  "authorized_root",
  {
    id: typeIdColumn("authorizedRoot", "id").primaryKey(),
    /** NULL = server-global authorized root. */
    workspaceId: text("workspace_id").references(() => workspaceTable.id, {
      onDelete: "cascade",
    }),
    path: text("path").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("authorized_root_path_unique").on(table.path)],
);

/**
 * Per-workspace OpenWork metadata — replaces the non-opencode sections of
 * `<root>/.opencode/openwork.json` (`version`, `workspace.{name,createdAt,preset}`).
 */
export const workspaceMetaTable = sqliteTable("workspace_meta", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaceTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  workspaceName: text("workspace_name"),
  preset: text("preset"),
  ...timestamps,
});

/**
 * Blueprint session materialization mapping — replaces
 * `openwork.json` `blueprint.materialized.sessions`.
 *
 * NOTE: this is intentionally export-sanitized today (session ids are stripped on
 * workspace export). Preserve that behavior when projecting back out.
 */
export const blueprintSessionTable = sqliteTable(
  "blueprint_session",
  {
    id: typeIdColumn("blueprintSession", "id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    templateId: text("template_id").notNull(),
    /** Real OpenCode session id (e.g. "ses_..."). Machine-specific. */
    sessionId: text("session_id").notNull(),
    hydratedAt: epochMs("hydrated_at").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("blueprint_session_ws_template_unique").on(table.workspaceId, table.templateId),
  ],
);

/**
 * Desktop cloud sync state — replaces the `desktopCloudSync` key inside `openwork.json`.
 * The full entry (pendingChanges, snapshot, teamIds, etc.) is stored as JSON; key by
 * workspace + contextKey ("<organizationId>::<orgMemberId>").
 */
export const desktopCloudSyncTable = sqliteTable(
  "desktop_cloud_sync",
  {
    id: typeIdColumn("desktopCloudSync", "id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    contextKey: text("context_key").notNull(),
    organizationId: text("organization_id").notNull(),
    orgMemberId: text("org_member_id").notNull(),
    /** Full DesktopCloudSyncEntry JSON. */
    data: jsonColumn<unknown>("data").notNull(),
    fetchedAt: epochMs("fetched_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("desktop_cloud_sync_ws_context_unique").on(table.workspaceId, table.contextKey),
  ],
);

export type WorkspaceRow = typeof workspaceTable.$inferSelect;
export type WorkspaceInsert = typeof workspaceTable.$inferInsert;
export type AuthorizedRootRow = typeof authorizedRootTable.$inferSelect;
export type WorkspaceMetaRow = typeof workspaceMetaTable.$inferSelect;
export type BlueprintSessionRow = typeof blueprintSessionTable.$inferSelect;
export type DesktopCloudSyncRow = typeof desktopCloudSyncTable.$inferSelect;
