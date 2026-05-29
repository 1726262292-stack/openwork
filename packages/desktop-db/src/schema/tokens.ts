import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { epochMs, secretText, timestamps, typeIdColumn } from "../columns";

/**
 * Scoped API tokens — replaces `tokens.json`.
 *
 * Raw tokens are NEVER stored; only their SHA-256 hash (matching `tokens.ts`). The
 * built-in `config.token`/`hostToken` live in server_config (plaintext, as today).
 */
export const tokenTable = sqliteTable(
  "token",
  {
    id: typeIdColumn("token", "id").primaryKey(),
    /** sha256(token) — the raw token is returned once at creation, never persisted. */
    hash: text("hash").notNull(),
    /** "owner" | "collaborator" | "viewer" */
    scope: text("scope").notNull(),
    label: text("label"),
    createdAt: epochMs("created_at").notNull(),
  },
  (table) => [uniqueIndex("token_hash_unique").on(table.hash)],
);

/**
 * Per-workspace server tokens — replaces the Electron `openwork-server-tokens.json`.
 * `workspaceKey` is the lowercased resolved POSIX path used by the Electron shell.
 */
export const workspaceServerTokenTable = sqliteTable("workspace_server_token", {
  workspaceKey: text("workspace_key").primaryKey(),
  clientToken: secretText("client_token"),
  hostToken: secretText("host_token"),
  ownerToken: secretText("owner_token"),
  ...timestamps,
});

/**
 * Preferred ports per workspace — replaces the Electron `openwork-server-state.json`
 * `workspacePorts` map. The global `preferredPort` lives in server_config.
 */
export const workspacePortTable = sqliteTable(
  "workspace_port",
  {
    workspaceKey: text("workspace_key").primaryKey(),
    port: integer("port").notNull(),
    ...timestamps,
  },
  (table) => [index("workspace_port_port_idx").on(table.port)],
);

export type TokenRow = typeof tokenTable.$inferSelect;
export type TokenInsert = typeof tokenTable.$inferInsert;
export type WorkspaceServerTokenRow = typeof workspaceServerTokenTable.$inferSelect;
export type WorkspacePortRow = typeof workspacePortTable.$inferSelect;
