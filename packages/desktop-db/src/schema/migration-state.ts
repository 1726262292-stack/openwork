import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { epochMs } from "../columns";

/**
 * Tracks one-time file -> DB imports so we never re-import on every start.
 *
 * Keyed by `source` (e.g. "server.json", "tokens.json", "audit"). The `fingerprint`
 * is "<mtimeMs>:<size>" of the source file (or a directory digest for audit); if the
 * source file changes after import, the importer can decide to re-run.
 *
 * Source files are NEVER deleted; on first successful import a `<file>.pre-db.bak`
 * snapshot is written (recorded in `backupPath`) so the migration can be reverted.
 */
export const migrationStateTable = sqliteTable("migration_state", {
  source: text("source").primaryKey(),
  /** "imported" | "skipped" | "error" */
  status: text("status").notNull(),
  /** "<mtimeMs>:<size>" of the imported source, or "" if not found. */
  fingerprint: text("fingerprint").notNull().default(""),
  /** Number of rows imported. */
  rowCount: integer("row_count").notNull().default(0),
  /** Path to the one-time .pre-db.bak snapshot, if any. */
  backupPath: text("backup_path"),
  importedAt: epochMs("imported_at").notNull(),
});

export type MigrationStateRow = typeof migrationStateTable.$inferSelect;
export type MigrationStateInsert = typeof migrationStateTable.$inferInsert;
