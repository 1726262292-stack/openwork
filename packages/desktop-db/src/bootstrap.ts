import { eq } from "drizzle-orm";
import type { DesktopDb } from "./client";
import { preferenceTable } from "./schema/index";

/**
 * Desktop "bootstrap" config (cloud / Den connection) — replaces desktop-bootstrap.json.
 * Stored as preference rows so it's shared with the server (which exposes baseUrl /
 * apiBaseUrl in its config) and read by Electron + the renderer.
 */

export const BOOTSTRAP_BASE_URL_PREF = "desktop.bootstrap.baseUrl";
export const BOOTSTRAP_API_BASE_URL_PREF = "desktop.bootstrap.apiBaseUrl";
export const BOOTSTRAP_REQUIRE_SIGNIN_PREF = "desktop.bootstrap.requireSignin";

export type DesktopBootstrapConfig = {
  baseUrl: string | null;
  apiBaseUrl: string | null;
  requireSignin: boolean;
};

async function readPrefString(db: DesktopDb, key: string): Promise<string | null> {
  const rows = await db.select().from(preferenceTable).where(eq(preferenceTable.key, key));
  const value = rows[0]?.value;
  // Empty string is stored to represent "unset" (the JSON column is NOT NULL).
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function readPrefBool(db: DesktopDb, key: string): Promise<boolean | null> {
  const rows = await db.select().from(preferenceTable).where(eq(preferenceTable.key, key));
  const value = rows[0]?.value;
  return typeof value === "boolean" ? value : null;
}

function writePref(db: DesktopDb, key: string, value: unknown, now: number) {
  db.insert(preferenceTable)
    .values({ key, value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: preferenceTable.key, set: { value, updatedAt: now } })
    .run();
}

/** Read the bootstrap config from the DB. Returns nulls when unset. */
export async function getDesktopBootstrapConfig(db: DesktopDb): Promise<DesktopBootstrapConfig> {
  return {
    baseUrl: await readPrefString(db, BOOTSTRAP_BASE_URL_PREF),
    apiBaseUrl: await readPrefString(db, BOOTSTRAP_API_BASE_URL_PREF),
    requireSignin: (await readPrefBool(db, BOOTSTRAP_REQUIRE_SIGNIN_PREF)) ?? false,
  };
}

/** Persist the bootstrap config to the DB. */
export async function setDesktopBootstrapConfig(
  db: DesktopDb,
  config: DesktopBootstrapConfig,
): Promise<void> {
  const now = Date.now();
  // The preference.value column is NOT NULL JSON; store "" for unset URLs.
  db.transaction((tx) => {
    writePref(tx as unknown as DesktopDb, BOOTSTRAP_BASE_URL_PREF, config.baseUrl ?? "", now);
    writePref(tx as unknown as DesktopDb, BOOTSTRAP_API_BASE_URL_PREF, config.apiBaseUrl ?? "", now);
    writePref(tx as unknown as DesktopDb, BOOTSTRAP_REQUIRE_SIGNIN_PREF, config.requireSignin === true, now);
  });
}
