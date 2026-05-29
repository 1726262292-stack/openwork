import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { epochMs, secretText } from "../columns";

/**
 * User-level environment variables — replaces `env.json`.
 *
 * Scope: user/machine (NOT per-workspace, NOT per-session). Values are service
 * credentials (e.g. ANTHROPIC_API_KEY) stored in plaintext today (0o600 file). See
 * plan.md open question on at-rest encryption AND the cross-shell read concern
 * (the Rust/Node shells read env.json independently before the server starts).
 *
 * `schemaVersion` is tracked in server_config (`env.schemaVersion`).
 */
export const envVarTable = sqliteTable(
  "env_var",
  {
    /** POSIX env name: ^[A-Za-z_][A-Za-z0-9_]*$. Reserved OPENWORK_/OPENCODE_ refused. */
    key: text("key").primaryKey(),
    value: secretText("value").notNull(),
    updatedAt: epochMs("updated_at").notNull(),
  },
  (table) => [uniqueIndex("env_var_key_unique").on(table.key)],
);

export type EnvVarRow = typeof envVarTable.$inferSelect;
export type EnvVarInsert = typeof envVarTable.$inferInsert;
