import { eq } from "drizzle-orm";
import type { DesktopDb } from "../client";
import { migrationStateTable } from "../schema/index";
import { dirHash, fileHash } from "./fingerprint";
import type { ImportResult } from "./helpers";

/**
 * Shared "import a source exactly once, ever" gate for the migration_state table.
 *
 * Contract:
 * - Source files are NEVER modified, copied, renamed, or deleted. They stay in place so
 *   an older (pre-DB) app version still works after a rollback.
 * - A source is imported AT MOST ONCE: once its migration_state row has status
 *   "imported", we skip it forever, regardless of later content changes.
 * - We record the source path + a non-cryptographic content hash for diagnostics only.
 */

export type ImportOnceStatus = "imported" | "already-done" | "missing" | "error";

export interface ImportOnceEntry {
  source: string;
  status: ImportOnceStatus;
  hash: string;
  rowCount: number;
  error?: string;
}

export type ImportSource = {
  /** Stable migration_state key (e.g. "server.json", "electron:openwork-workspaces.json"). */
  key: string;
  /** Absolute path of the file or directory. */
  path: string;
  /** "file" (hash file contents) or "dir" (hash dir listing). */
  kind: "file" | "dir";
  /** For "dir" kind, only files with this suffix are considered (e.g. ".jsonl"). */
  suffix?: string;
  /** Import the source into the DB. Only invoked when not already imported. */
  run: (db: DesktopDb, path: string) => Promise<ImportResult>;
};

async function sourceHash(source: ImportSource): Promise<string | null> {
  return source.kind === "dir" ? dirHash(source.path, source.suffix) : fileHash(source.path);
}

function recordState(
  db: DesktopDb,
  entry: { source: string; status: ImportOnceStatus; path: string; hash: string; rowCount: number },
) {
  const now = Date.now();
  db.insert(migrationStateTable)
    .values({ ...entry, importedAt: now })
    .onConflictDoUpdate({
      target: migrationStateTable.source,
      set: {
        status: entry.status,
        path: entry.path,
        hash: entry.hash,
        rowCount: entry.rowCount,
        importedAt: now,
      },
    })
    .run();
}

/** Run a set of sources through the once-ever gate. */
export async function runImportSourcesOnce(
  db: DesktopDb,
  sources: ImportSource[],
): Promise<Record<string, ImportOnceEntry>> {
  const report: Record<string, ImportOnceEntry> = {};

  for (const source of sources) {
    // Gate purely on "have we imported this source before?" — never re-import on change.
    const priorRows = await db
      .select()
      .from(migrationStateTable)
      .where(eq(migrationStateTable.source, source.key));
    const prior = priorRows[0];
    if (prior && prior.status === "imported") {
      report[source.key] = {
        source: source.key,
        status: "already-done",
        hash: prior.hash,
        rowCount: prior.rowCount,
      };
      continue;
    }

    const hash = await sourceHash(source);
    if (hash === null) {
      report[source.key] = { source: source.key, status: "missing", hash: "", rowCount: 0 };
      continue;
    }

    try {
      const result = await source.run(db, source.path);
      recordState(db, {
        source: source.key,
        status: "imported",
        path: source.path,
        hash,
        rowCount: result.count,
      });
      report[source.key] = { source: source.key, status: "imported", hash, rowCount: result.count };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordState(db, { source: source.key, status: "error", path: source.path, hash, rowCount: 0 });
      report[source.key] = { source: source.key, status: "error", hash, rowCount: 0, error: message };
    }
  }

  return report;
}
