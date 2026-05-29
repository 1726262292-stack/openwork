import type { DesktopDb } from "../client";
import type { ImportReport } from "./helpers";
import { importServerJson } from "./server-json";
import { importTokensJson } from "./tokens-json";
import { importAuditDir } from "./audit-jsonl";
import {
  resolveAuditDir,
  resolveServerJsonPath,
  resolveTokensJsonPath,
  type ImportOptions,
} from "./paths";

export { importServerJson } from "./server-json";
export { importTokensJson } from "./tokens-json";
export { importAuditDir } from "./audit-jsonl";
export type { ImportReport, ImportResult } from "./helpers";
export {
  resolveAuditDir,
  resolveServerJsonPath,
  resolveTokensJsonPath,
  type ImportOptions,
} from "./paths";
export { fileHash, dirHash, fileExists } from "./fingerprint";
export {
  runPhase1ImportOnce,
  type ImportOnceReport,
  type ImportOnceEntry,
  type ImportOnceStatus,
} from "./import-once";
export {
  importElectronWorkspaces,
  importElectronServerTokens,
  importElectronServerState,
  importEnvJson,
  importDesktopBootstrap,
  runDesktopImportOnce,
  DESKTOP_SELECTED_WORKSPACE_PREF,
  DESKTOP_WATCHED_WORKSPACE_PREF,
  DESKTOP_PREFERRED_PORT_PREF,
  type DesktopImportOptions,
  type DesktopImportReport,
  type DesktopImportEntry,
  type DesktopImportStatus,
} from "./desktop";

/**
 * Phase 1 import WITHOUT the one-time guard (always runs). Idempotent (upserts by
 * natural key / dedupes by sourceId). Useful for tests; production should prefer
 * `runPhase1ImportOnce`.
 */
export async function runPhase1Import(
  db: DesktopDb,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const report: ImportReport = {};

  report.serverJson = await importServerJson(
    db,
    options.serverJsonPath ?? resolveServerJsonPath(),
  );
  report.tokensJson = await importTokensJson(
    db,
    options.tokensJsonPath ?? resolveTokensJsonPath(),
  );
  if (!options.skipAudit) {
    report.audit = await importAuditDir(db, options.auditDir ?? resolveAuditDir());
  }

  return report;
}
