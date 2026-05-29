import type { DesktopDb } from "../client";
import { tokenTable } from "../schema/index";
import { createDesktopTypeId } from "../typeid";
import { type ImportResult, readJsonFile } from "./helpers";

/**
 * Import `tokens.json` into the `token` table.
 *
 * Schema (tokens.ts): { schemaVersion, updatedAt, tokens: [{ id, hash, scope,
 * createdAt, label? }] }. Only the SHA-256 `hash` is stored (raw tokens never persist).
 * The original `id` (randomUUID) is mapped to a new TypeID row id; dedupe is by `hash`.
 *
 * Idempotent: re-running upserts by hash.
 */

interface TokenRecord {
  id?: string;
  hash: string;
  scope: string;
  createdAt?: number;
  label?: string;
}

interface TokensJson {
  schemaVersion?: number;
  updatedAt?: number;
  tokens?: TokenRecord[];
}

export async function importTokensJson(db: DesktopDb, path: string): Promise<ImportResult> {
  const parsed = await readJsonFile<TokensJson>(path);
  if (!parsed) return { count: 0, found: false };

  const now = Date.now();
  let count = 0;

  db.transaction((tx) => {
    for (const record of parsed.tokens ?? []) {
      if (!record.hash || !record.scope) continue;
      tx.insert(tokenTable)
        .values({
          id: createDesktopTypeId("token"),
          hash: record.hash,
          scope: record.scope,
          label: record.label ?? null,
          createdAt: record.createdAt ?? now,
        })
        .onConflictDoUpdate({
          target: tokenTable.hash,
          set: {
            scope: record.scope,
            label: record.label ?? null,
          },
        })
        .run();
      count += 1;
    }
  });

  return { count, found: true };
}
