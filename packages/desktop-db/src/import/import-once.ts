import type { DesktopDb } from "../client";
import { importServerJson } from "./server-json";
import { importTokensJson } from "./tokens-json";
import { importAuditDir } from "./audit-jsonl";
import {
  runImportSourcesOnce,
  type ImportOnceEntry,
  type ImportOnceStatus,
  type ImportSource,
} from "./gate";
import {
  resolveAuditDir,
  resolveServerJsonPath,
  resolveTokensJsonPath,
  type ImportOptions,
} from "./paths";

export type { ImportOnceStatus, ImportOnceEntry } from "./gate";
export type ImportOnceReport = Record<string, ImportOnceEntry>;

/**
 * One-time Phase 1 import gated by `migration_state`.
 *
 * Sources (server.json, tokens.json, audit dir) are imported AT MOST ONCE. Source files
 * are never modified, copied, or deleted — they stay in place so an older (pre-DB) app
 * version still works after a rollback. Cheap on subsequent starts (a single DB lookup
 * per source before any file I/O).
 */
export async function runPhase1ImportOnce(
  db: DesktopDb,
  options: ImportOptions = {},
): Promise<ImportOnceReport> {
  const serverJsonPath = options.serverJsonPath ?? resolveServerJsonPath();
  const tokensJsonPath = options.tokensJsonPath ?? resolveTokensJsonPath();
  const auditDir = options.auditDir ?? resolveAuditDir();

  const sources: ImportSource[] = [
    { key: "server.json", path: serverJsonPath, kind: "file", run: importServerJson },
    { key: "tokens.json", path: tokensJsonPath, kind: "file", run: importTokensJson },
  ];

  if (!options.skipAudit) {
    sources.push({ key: "audit", path: auditDir, kind: "dir", suffix: ".jsonl", run: importAuditDir });
  }

  return runImportSourcesOnce(db, sources);
}
