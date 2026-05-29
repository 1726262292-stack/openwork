import { join } from "node:path";
import { homedir } from "node:os";
import type { AuditEntry } from "./types.js";
import { getDb } from "./db.js";
import { auditTable, createDesktopTypeId, drizzle } from "@openwork/desktop-db";

function expandHome(value: string): string {
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function resolveOpenworkDataDir(): string {
  const override = process.env.OPENWORK_DATA_DIR?.trim();
  if (override) return expandHome(override);
  return join(homedir(), ".openwork", "openwork-server");
}

/**
 * @deprecated Audit is now stored in the SQLite DB; this only points at the legacy
 * JSONL location (preserved on disk for revert). Kept for path/back-compat references.
 */
export function auditLogPath(workspaceId: string): string {
  return join(resolveOpenworkDataDir(), "audit", `${workspaceId}.jsonl`);
}

/** @deprecated See {@link auditLogPath}. */
export function legacyAuditLogPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "openwork", "audit.jsonl");
}

/**
 * DB-backed audit log (replaces `~/.openwork/openwork-server/audit/<id>.jsonl`).
 *
 * The original JSONL files are preserved on disk (snapshotted to `audit-pre-db-bak/`)
 * and imported once into the `audit` table. New entries are written to the DB only.
 *
 * `recordAudit` keeps its `(workspaceRoot, entry)` signature for call-site
 * compatibility; `workspaceRoot` is no longer used (the empty-workspaceId "legacy"
 * case is preserved as `workspaceId = ""`).
 */
export async function recordAudit(_workspaceRoot: string, entry: AuditEntry): Promise<void> {
  const db = await getDb();
  await db
    .insert(auditTable)
    .values({
      id: createDesktopTypeId("audit"),
      sourceId: entry.id ?? null,
      workspaceId: entry.workspaceId?.trim() ?? "",
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      summary: entry.summary,
      timestamp: entry.timestamp,
    })
    .run();
}

function rowToEntry(row: typeof auditTable.$inferSelect): AuditEntry {
  return {
    id: row.sourceId ?? row.id,
    workspaceId: row.workspaceId,
    actor: row.actor,
    action: row.action,
    target: row.target,
    summary: row.summary,
    timestamp: row.timestamp,
  };
}

export async function readLastAudit(
  _workspaceRoot: string,
  workspaceId: string,
): Promise<AuditEntry | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(auditTable)
    .where(drizzle.eq(auditTable.workspaceId, workspaceId))
    .orderBy(drizzle.desc(auditTable.timestamp))
    .limit(1);
  const row = rows[0];
  return row ? rowToEntry(row) : null;
}

export async function readAuditEntries(
  _workspaceRoot: string,
  workspaceId: string,
  limit = 50,
): Promise<AuditEntry[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(auditTable)
    .where(drizzle.eq(auditTable.workspaceId, workspaceId))
    .orderBy(drizzle.desc(auditTable.timestamp))
    .limit(Math.max(1, limit));
  return rows.map(rowToEntry);
}
