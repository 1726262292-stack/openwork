import { eq } from "drizzle-orm";
import type { DesktopDb } from "./client";
import { envVarTable } from "./schema/index";

/**
 * DB-backed user environment variables (replaces env.json).
 *
 * Scope: user/machine, not workspace. Values are service credentials (API keys).
 * Reserved prefixes are refused on write and stripped on read-for-injection so a
 * tampered store can never shadow OpenWork/OpenCode runtime wiring.
 *
 * Stored plaintext for now (parity with the prior 0600 env.json). At-rest encryption
 * is a separate follow-up.
 */

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_PREFIXES = ["OPENWORK_", "OPENCODE_"] as const;

export type EnvRecord = { key: string; value: string; updatedAt: number };
export type EnvEntry = { key: string; value: string };

export function isValidEnvKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key);
}

export function isReservedEnvKey(key: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export async function listEnvVars(db: DesktopDb): Promise<EnvRecord[]> {
  const rows = await db.select().from(envVarTable);
  return rows
    .filter((row) => isValidEnvKey(row.key))
    .map((row) => ({ key: row.key, value: row.value, updatedAt: row.updatedAt }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function getEnvVar(db: DesktopDb, key: string): Promise<EnvRecord | null> {
  const rows = await db.select().from(envVarTable).where(eq(envVarTable.key, key));
  const row = rows[0];
  return row ? { key: row.key, value: row.value, updatedAt: row.updatedAt } : null;
}

/** Upsert several env vars. Throws on invalid/reserved keys (caller maps to HTTP codes). */
export async function upsertEnvVars(db: DesktopDb, entries: EnvEntry[]): Promise<void> {
  const now = Date.now();
  for (const entry of entries) {
    if (!isValidEnvKey(entry.key)) throw new InvalidEnvKeyError(entry.key, "invalid_env_key");
    if (isReservedEnvKey(entry.key)) throw new InvalidEnvKeyError(entry.key, "reserved_env_key");
  }
  db.transaction((tx) => {
    for (const entry of entries) {
      tx.insert(envVarTable)
        .values({ key: entry.key, value: entry.value, updatedAt: now })
        .onConflictDoUpdate({
          target: envVarTable.key,
          set: { value: entry.value, updatedAt: now },
        })
        .run();
    }
  });
}

export async function deleteEnvVar(db: DesktopDb, key: string): Promise<boolean> {
  const existing = await getEnvVar(db, key);
  if (!existing) return false;
  await db.delete(envVarTable).where(eq(envVarTable.key, key)).run();
  return true;
}

/**
 * Flat `key -> value` map for injecting into spawned children / process.env. Reserved
 * keys are stripped. Never throws.
 */
export async function readEnvForInjection(db: DesktopDb): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const rows = await db.select().from(envVarTable);
    for (const row of rows) {
      if (!isValidEnvKey(row.key) || isReservedEnvKey(row.key)) continue;
      out[row.key] = row.value;
    }
  } catch {
    // tolerate a missing/locked DB at spawn time.
  }
  return out;
}

export class InvalidEnvKeyError extends Error {
  readonly code: "invalid_env_key" | "reserved_env_key";
  constructor(key: string, code: "invalid_env_key" | "reserved_env_key") {
    super(
      code === "reserved_env_key"
        ? `Environment variable name is reserved for OpenWork internals: ${key}`
        : `Invalid environment variable name: ${key}`,
    );
    this.code = code;
  }
}
