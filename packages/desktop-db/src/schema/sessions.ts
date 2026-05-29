import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { epochMs, timestamps, typeIdColumn } from "../columns";

/**
 * File sessions — currently IN-MEMORY only (`FileSessionStore`). Persisting them to the
 * DB changes restart semantics (today they're TTL-evicted). Included so the option
 * exists; the server can choose to keep them in-memory and ignore these tables.
 */
export const fileSessionTable = sqliteTable(
  "file_session",
  {
    id: typeIdColumn("fileSession", "id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    workspaceRoot: text("workspace_root").notNull(),
    actorTokenHash: text("actor_token_hash").notNull(),
    /** "owner" | "collaborator" | "viewer" */
    actorScope: text("actor_scope").notNull(),
    canWrite: integer("can_write", { mode: "boolean" }).notNull().default(false),
    createdAt: epochMs("created_at").notNull(),
    expiresAt: epochMs("expires_at").notNull(),
  },
  (table) => [index("file_session_workspace_idx").on(table.workspaceId)],
);

export const fileSessionEventTable = sqliteTable(
  "file_session_event",
  {
    id: typeIdColumn("fileSessionEvent", "id").primaryKey(),
    /** Monotonic per-workspace sequence. */
    seq: integer("seq").notNull(),
    workspaceId: text("workspace_id").notNull(),
    /** "write" | "delete" | "rename" | "mkdir" */
    type: text("type").notNull(),
    path: text("path").notNull(),
    toPath: text("to_path"),
    /** "mtimeMs:size" fingerprint. */
    revision: text("revision"),
    timestamp: epochMs("timestamp").notNull(),
  },
  (table) => [
    uniqueIndex("file_session_event_ws_seq_unique").on(table.workspaceId, table.seq),
  ],
);

/**
 * Per-session preferences — GREENFIELD. None exist today. Key/value per (session,
 * workspace) so we can expand per-session model/agent/UI prefs without migrations.
 */
export const sessionPrefTable = sqliteTable(
  "session_pref",
  {
    id: typeIdColumn("sessionPref", "id").primaryKey(),
    /** OpenCode session id (e.g. "ses_..."). */
    sessionId: text("session_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    key: text("key").notNull(),
    value: text("value"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("session_pref_session_key_unique").on(table.sessionId, table.key),
    index("session_pref_workspace_idx").on(table.workspaceId),
  ],
);

export type FileSessionRow = typeof fileSessionTable.$inferSelect;
export type FileSessionEventRow = typeof fileSessionEventTable.$inferSelect;
export type SessionPrefRow = typeof sessionPrefTable.$inferSelect;
export type SessionPrefInsert = typeof sessionPrefTable.$inferInsert;
