import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { DesktopDb } from "../client";
import { migrationStateTable } from "../schema/index";
import { importServerJson } from "./server-json";
import { importTokensJson } from "./tokens-json";
import { importAuditDir } from "./audit-jsonl";
import { dirFingerprint, fileFingerprint, snapshotOnce } from "./fingerprint";
import {
  resolveAuditDir,
  resolveServerJsonPath,
  resolveTokensJsonPath,
  type ImportOptions,
} from "./paths";

export type ImportOnceStatus = "imported" | "already-done" | "missing" | "error";

export interface ImportOnceEntry {
  source: string;
  status: ImportOnceStatus;
  fingerprint: string;
  rowCount: number;
  backupPath: string | null;
  error?: string;
}

export type ImportOnceReport = Record<string, ImportOnceEntry>;

async function getState(db: DesktopDb, source: string) {
  const rows = await db
    .select()
    .from(migrationStateTable)
    .where(eq(migrationStateTable.source, source));
  return rows[0] ?? null;
}

function recordState(
  db: DesktopDb,
  entry: { source: string; status: string; fingerprint: string; rowCount: number; backupPath: string | null },
) {
  const now = Date.now();
  db.insert(migrationStateTable)
    .values({ ...entry, importedAt: now })
    .onConflictDoUpdate({
      target: migrationStateTable.source,
      set: {
        status: entry.status,
        fingerprint: entry.fingerprint,
        rowCount: entry.rowCount,
        backupPath: entry.backupPath,
        importedAt: now,
      },
    })
    .run();
}

/**
 * Snapshot every `*.jsonl` in the audit dir into `<dir>/../audit-pre-db-bak/`.
 * Returns the backup dir path, or null if the audit dir is absent.
 */
async function snapshotAuditDir(auditDir: string): Promise<string | null> {
  let names: string[];
  try {
    names = (await readdir(auditDir)).filter((n) => n.endsWith(".jsonl"));
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  const backupDir = join(auditDir, "..", "audit-pre-db-bak");
  await mkdir(backupDir, { recursive: true });
  for (const name of names) {
    const dest = join(backupDir, name);
    const existing = await fileFingerprint(dest);
    if (!existing) await copyFile(join(auditDir, name), dest);
  }
  return backupDir;
}

type Source = {
  key: string;
  fingerprint: () => Promise<string | null>;
  run: () => Promise<{ count: number; found: boolean; backupPath: string | null }>;
};

/**
 * One-time Phase 1 import gated by the `migration_state` table.
 *
 * For each source (server.json, tokens.json, audit dir):
 * - if a `migration_state` row already exists AND the source fingerprint is unchanged,
 *   skip ("already-done");
 * - otherwise snapshot the source to a `.pre-db.bak` (never deleting the original),
 *   import it, and record the new fingerprint.
 *
 * Idempotent and cheap on subsequent starts (only stat()s the source files).
 * Source files are preserved so the migration can be reverted.
 */
export async function runPhase1ImportOnce(
  db: DesktopDb,
  options: ImportOptions = {},
): Promise<ImportOnceReport> {
  const serverJsonPath = options.serverJsonPath ?? resolveServerJsonPath();
  const tokensJsonPath = options.tokensJsonPath ?? resolveTokensJsonPath();
  const auditDir = options.auditDir ?? resolveAuditDir();

  const sources: Source[] = [
    {
      key: "server.json",
      fingerprint: () => fileFingerprint(serverJsonPath),
      run: async () => {
        const backupPath = await snapshotOnce(serverJsonPath);
        const result = await importServerJson(db, serverJsonPath);
        return { ...result, backupPath };
      },
    },
    {
      key: "tokens.json",
      fingerprint: () => fileFingerprint(tokensJsonPath),
      run: async () => {
        const backupPath = await snapshotOnce(tokensJsonPath);
        const result = await importTokensJson(db, tokensJsonPath);
        return { ...result, backupPath };
      },
    },
  ];

  if (!options.skipAudit) {
    sources.push({
      key: "audit",
      fingerprint: () => dirFingerprint(auditDir, ".jsonl"),
      run: async () => {
        const backupPath = await snapshotAuditDir(auditDir);
        const result = await importAuditDir(db, auditDir);
        return { ...result, backupPath };
      },
    });
  }

  const report: ImportOnceReport = {};

  for (const source of sources) {
    const fingerprint = await source.fingerprint();

    if (fingerprint === null) {
      report[source.key] = {
        source: source.key,
        status: "missing",
        fingerprint: "",
        rowCount: 0,
        backupPath: null,
      };
      continue;
    }

    const prior = await getState(db, source.key);
    if (prior && prior.status === "imported" && prior.fingerprint === fingerprint) {
      report[source.key] = {
        source: source.key,
        status: "already-done",
        fingerprint,
        rowCount: prior.rowCount,
        backupPath: prior.backupPath ?? null,
      };
      continue;
    }

    try {
      const { count, backupPath } = await source.run();
      recordState(db, {
        source: source.key,
        status: "imported",
        fingerprint,
        rowCount: count,
        backupPath,
      });
      report[source.key] = {
        source: source.key,
        status: "imported",
        fingerprint,
        rowCount: count,
        backupPath,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordState(db, {
        source: source.key,
        status: "error",
        fingerprint,
        rowCount: 0,
        backupPath: null,
      });
      report[source.key] = {
        source: source.key,
        status: "error",
        fingerprint,
        rowCount: 0,
        backupPath: null,
        error: message,
      };
    }
  }

  return report;
}
