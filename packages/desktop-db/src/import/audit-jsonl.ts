import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { DesktopDb } from "../client";
import { auditTable } from "../schema/index";
import { createDesktopTypeId } from "../typeid";
import { type ImportResult, readLines } from "./helpers";

/**
 * Import audit JSONL files into the `audit` table.
 *
 * Source layout: `<dataDir>/audit/<workspaceId>.jsonl` (one JSON object per line).
 * The original `id` (randomUUID) is preserved as `sourceId`; the row gets a TypeID.
 * Dedupe is by `sourceId` so re-running doesn't duplicate.
 *
 * `auditDir` should be the `audit/` directory (e.g. `~/.openwork/openwork-server/audit`).
 */

interface AuditJsonlEntry {
  id?: string;
  workspaceId?: string;
  actor?: {
    type?: "remote" | "host";
    clientId?: string;
    tokenHash?: string;
    scope?: "owner" | "collaborator" | "viewer";
  };
  action?: string;
  target?: string;
  summary?: string;
  timestamp?: number;
}

export async function importAuditDir(db: DesktopDb, auditDir: string): Promise<ImportResult> {
  let files: string[];
  try {
    files = (await readdir(auditDir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return { count: 0, found: false };
  }
  if (files.length === 0) return { count: 0, found: true };

  let count = 0;

  for (const file of files) {
    const lines = await readLines(join(auditDir, file));
    const entries: AuditJsonlEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as AuditJsonlEntry);
      } catch {
        // skip malformed lines
      }
    }
    if (entries.length === 0) continue;

    db.transaction((tx) => {
      for (const entry of entries) {
        const actor = {
          type: entry.actor?.type ?? "remote",
          clientId: entry.actor?.clientId,
          tokenHash: entry.actor?.tokenHash,
          scope: entry.actor?.scope,
        } as const;
        tx.insert(auditTable)
          .values({
            id: createDesktopTypeId("audit"),
            sourceId: entry.id ?? null,
            workspaceId: entry.workspaceId ?? "",
            actor,
            action: entry.action ?? "",
            target: entry.target ?? "",
            summary: entry.summary ?? "",
            timestamp: entry.timestamp ?? Date.now(),
          })
          .run();
        count += 1;
      }
    });
  }

  return { count, found: true };
}
