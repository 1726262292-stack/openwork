import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { epochMs } from "../columns";

/**
 * Tracks one-time file -> DB imports so we never re-import on every start.
 *
 * Keyed by `source` (e.g. "server.json", "tokens.json", "audit"). Each row records the
 * imported source's `path` and a non-cryptographic content `hash` (for diagnostics).
 *
 * IMPORTANT: the import is gated **once ever per source** — once a source has a row with
 * status "imported", we skip it on every subsequent start regardless of later content
 * changes. We NEVER modify, copy, rename, or delete the source files; they remain in
 * place so an older (pre-DB) app version still works after a rollback.
 */
export const migrationStateTable = sqliteTable("migration_state", {
  source: text("source").primaryKey(),
  /** "imported" | "skipped" | "error" */
  status: text("status").notNull(),
  /** Absolute path of the imported source (file or dir), or "" if not found. */
  path: text("path").notNull().default(""),
  /** Non-cryptographic content hash of the imported source (diagnostics only). */
  hash: text("hash").notNull().default(""),
  /** Number of rows imported. */
  rowCount: integer("row_count").notNull().default(0),
  importedAt: epochMs("imported_at").notNull(),
});

export type MigrationStateRow = typeof migrationStateTable.$inferSelect;
export type MigrationStateInsert = typeof migrationStateTable.$inferInsert;
