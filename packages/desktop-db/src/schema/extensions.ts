import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { jsonColumn, secretText, timestamps, typeIdColumn } from "../columns";

/**
 * Google Workspace OAuth vault — replaces `extensions/google-workspace/oauth.vault`
 * (+ dev plaintext file). The decrypted record is `{ version, account, scopes, token:
 * { accessToken, refreshToken, expiresAt }, connectedAt, updatedAt }`.
 *
 * `data` holds the encrypted envelope (AES-256-GCM) or, in dev plaintext mode, the raw
 * record JSON. The `vault-key` file concept can be replaced by a server_config row or a
 * DB-level encryption strategy (see plan.md).
 */
export const googleWorkspaceVaultTable = sqliteTable("google_workspace_vault", {
  /** Google account `sub`, or a fixed singleton key (only one connection today). */
  id: typeIdColumn("googleWorkspaceVault", "id").primaryKey(),
  accountSub: text("account_sub"),
  /** Encrypted envelope JSON (or plaintext record in dev mode). */
  data: secretText("data").notNull(),
  encrypted: integer("encrypted", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

/**
 * Extension enable/disable/hidden flags — replaces the renderer localStorage keys
 * `openwork.extension.{enabled,disabled,hidden}.<id>`.
 */
export const extensionStateTable = sqliteTable("extension_state", {
  extensionId: typeIdColumn("extensionState", "extension_id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }),
  hidden: integer("hidden", { mode: "boolean" }),
  ...timestamps,
});

/**
 * Generic preferences — replaces the high-priority renderer `localStorage` keys
 * (server URLs/tokens, model prefs, drafts, onboarding flags, shell-config, etc.).
 * Key/value JSON so the frontend can migrate keys incrementally via `invokeDesktop`.
 */
export const preferenceTable = sqliteTable("preference", {
  key: text("key").primaryKey(),
  value: jsonColumn<unknown>("value").notNull(),
  ...timestamps,
});

export type GoogleWorkspaceVaultRow = typeof googleWorkspaceVaultTable.$inferSelect;
export type ExtensionStateRow = typeof extensionStateTable.$inferSelect;
export type PreferenceRow = typeof preferenceTable.$inferSelect;
export type PreferenceInsert = typeof preferenceTable.$inferInsert;
