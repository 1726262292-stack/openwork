import { eq, inArray } from "drizzle-orm";
import type { DesktopDb } from "./client";
import { preferenceTable } from "./schema/index";

/**
 * Renderer preference keys that the desktop mirrors into the DB `preference` table
 * (write-through + boot hydration). These are DEVICE-DURABLE or account/workspace
 * "real state" keys — NOT purely-ephemeral UI (scroll, sidebar widths, debug toggles),
 * which stay in localStorage only.
 *
 * Exact keys are mirrored as-is; prefixes mirror any key starting with the prefix
 * (e.g. per-extension flags, per-workspace session models).
 *
 * The stored value is the raw localStorage string (so the renderer can hydrate
 * localStorage verbatim without reinterpreting types).
 */
export const MIRRORED_PREFERENCE_KEYS: readonly string[] = [
  // DEVICE-DURABLE: connection topology/policy + UX ordering + drafts + shell config
  "openwork.server.list",
  "openwork.server.active",
  "openwork.server.remoteAccessEnabled",
  "openwork.react.workspaceOrder",
  "openwork.session-drafts.v1",
  "openwork.shell-config",
  // SERVER-group "real state" (account/workspace scoped) — stored locally for now
  "openwork.preferences",
  "openwork.defaultModel",
  "openwork.hiddenModels",
  "openwork.skills.hubRepos.v1",
  "openwork.acknowledgedProviders",
  "openwork.seenProviderIds",
  "openwork.orgOnboardingSeen",
] as const;

export const MIRRORED_PREFERENCE_PREFIXES: readonly string[] = [
  // per-workspace model / variant overrides: openwork.sessionModels.<ws>, openwork.modelVariant.<ws>
  "openwork.sessionModels",
  "openwork.modelVariant",
  // per-extension flags: openwork.extension.enabled/disabled/hidden.<id>
  "openwork.extension.",
] as const;

/** Whether a localStorage key should be mirrored into the DB preference table. */
export function isMirroredPreferenceKey(key: string): boolean {
  if (MIRRORED_PREFERENCE_KEYS.includes(key)) return true;
  return MIRRORED_PREFERENCE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Read a single preference value (raw string), or null. */
export async function getPreference(db: DesktopDb, key: string): Promise<string | null> {
  const rows = await db.select().from(preferenceTable).where(eq(preferenceTable.key, key));
  const value = rows[0]?.value;
  return typeof value === "string" ? value : value == null ? null : JSON.stringify(value);
}

/** Read all mirrored preferences as a `key -> rawString` map (for boot hydration). */
export async function getAllMirroredPreferences(db: DesktopDb): Promise<Record<string, string>> {
  const rows = await db.select().from(preferenceTable);
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!isMirroredPreferenceKey(row.key)) continue;
    out[row.key] = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
  }
  return out;
}

/** Upsert a single preference (raw string value). */
export async function setPreference(db: DesktopDb, key: string, value: string): Promise<void> {
  const now = Date.now();
  await db
    .insert(preferenceTable)
    .values({ key, value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: preferenceTable.key, set: { value, updatedAt: now } })
    .run();
}

/** Remove a preference. */
export async function removePreference(db: DesktopDb, key: string): Promise<void> {
  await db.delete(preferenceTable).where(eq(preferenceTable.key, key)).run();
}

/** Remove several preferences. */
export async function removePreferences(db: DesktopDb, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.delete(preferenceTable).where(inArray(preferenceTable.key, keys)).run();
}
