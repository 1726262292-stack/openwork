import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { epochMs, jsonColumn, typeIdColumn } from "../columns";

/**
 * Audit log — replaces the append-only `~/.openwork/openwork-server/audit/<id>.jsonl`.
 *
 * One row per audit entry (was one JSONL line). The `actor` is stored as JSON
 * (`{ type, clientId?, tokenHash?, scope? }`). No retention policy today; consider
 * adding pruning now that it's a table.
 */
export const auditTable = sqliteTable(
  "audit",
  {
    /** Original randomUUID id is preserved as `sourceId`; row uses a TypeID. */
    id: typeIdColumn("audit", "id").primaryKey(),
    sourceId: text("source_id"),
    /** Empty string for the legacy workspace-relative log (no workspace id). */
    workspaceId: text("workspace_id").notNull().default(""),
    actor: jsonColumn<{
      type: "remote" | "host";
      clientId?: string;
      tokenHash?: string;
      scope?: "owner" | "collaborator" | "viewer";
    }>("actor").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull(),
    summary: text("summary").notNull(),
    timestamp: epochMs("timestamp").notNull(),
  },
  (table) => [
    index("audit_workspace_timestamp_idx").on(table.workspaceId, table.timestamp),
  ],
);

export type AuditRow = typeof auditTable.$inferSelect;
export type AuditInsert = typeof auditTable.$inferInsert;
