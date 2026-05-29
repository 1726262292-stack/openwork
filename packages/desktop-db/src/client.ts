import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema/index";

/**
 * Runtime-adaptive SQLite client.
 *
 * - Under **Bun** (the server runs `bun src/cli.ts`): uses `bun:sqlite` +
 *   `drizzle-orm/bun-sqlite` (better-sqlite3 native bindings are NOT supported in Bun).
 * - Under **Node / Electron**: uses `better-sqlite3` + `drizzle-orm/better-sqlite3`.
 *
 * Both expose the same Drizzle SQLite query API, so `DesktopDb` is the shared base type.
 */
export type DesktopDb = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

export interface OpenDbOptions {
  /**
   * Path to the SQLite file. Defaults to `resolveDefaultDbPath()`.
   * Use `:memory:` for tests.
   */
  path?: string;
  /** Directory containing generated drizzle migrations. Defaults to the bundled `drizzle/` dir. */
  migrationsFolder?: string;
  /** Run migrations on open. Default true. */
  migrate?: boolean;
  /** Enable WAL journal mode. Default true (ignored for in-memory). */
  wal?: boolean;
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

/**
 * Resolve the default desktop DB path.
 *
 * Honors `OPENWORK_DB` (absolute or relative), then falls back to
 * `<config dir>/openwork.db` where the config dir matches `server.json`'s location:
 * - `OPENWORK_SERVER_CONFIG`'s dirname, if set
 * - Windows: `%APPDATA%/openwork`
 * - POSIX: `~/.config/openwork`
 */
export function resolveDefaultDbPath(): string {
  const override = process.env.OPENWORK_DB?.trim();
  if (override) return resolve(override);

  const serverConfig = process.env.OPENWORK_SERVER_CONFIG?.trim();
  if (serverConfig) return join(dirname(resolve(serverConfig)), "openwork.db");

  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming");
    return join(appData, "openwork", "openwork.db");
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg ? resolve(xdg) : join(homedir(), ".config");
  return join(base, "openwork", "openwork.db");
}

/**
 * Resolve the DB path that sits next to a given `server.json`. Use this from the
 * desktop/Electron shell so it opens the SAME DB the server uses
 * (`<dirname(serverConfigPath)>/openwork.db`). `OPENWORK_DB` still wins if set.
 */
export function resolveDbPathForServerConfig(serverConfigPath: string): string {
  const override = process.env.OPENWORK_DB?.trim();
  if (override) return resolve(override);
  return join(dirname(resolve(serverConfigPath)), "openwork.db");
}

/**
 * Locate the bundled migrations folder. When running from source the folder is
 * `<package>/drizzle`; when bundled it sits next to `dist/`.
 */
function defaultMigrationsFolder(): string {
  // import.meta.url points at src/client.ts (dev) or dist/client.js (built).
  const here = dirname(fileURLToPath(import.meta.url));
  // both src/ and dist/ are one level below the package root.
  return resolve(here, "..", "drizzle");
}

interface RawHandle {
  pragma(sql: string): void;
  close(): void;
}

let cached: { path: string; db: DesktopDb; raw: RawHandle } | null = null;

async function openWithBun(path: string, wal: boolean): Promise<{ db: DesktopDb; raw: RawHandle }> {
  const { Database } = await import("bun:sqlite");
  const { drizzle } = await import("drizzle-orm/bun-sqlite");
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:" && wal) sqlite.exec("PRAGMA journal_mode = WAL");
  const db = drizzle(sqlite, { schema }) as unknown as DesktopDb;
  const raw: RawHandle = {
    pragma: (sql) => sqlite.exec(`PRAGMA ${sql}`),
    close: () => sqlite.close(),
  };
  return { db, raw };
}

async function openWithBetterSqlite(
  path: string,
  wal: boolean,
): Promise<{ db: DesktopDb; raw: RawHandle }> {
  const { default: Database } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  if (path !== ":memory:" && wal) sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema }) as unknown as DesktopDb;
  const raw: RawHandle = {
    pragma: (sql) => {
      sqlite.pragma(sql);
    },
    close: () => sqlite.close(),
  };
  return { db, raw };
}

async function runMigrations(db: DesktopDb, migrationsFolder: string): Promise<void> {
  if (isBun) {
    const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
    migrate(db as never, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    migrate(db as never, { migrationsFolder });
  }
}

/**
 * Open (and migrate) the desktop SQLite DB. Returns a cached singleton per path so
 * server, electron, and frontend share one connection within a process.
 */
export async function openDb(options: OpenDbOptions = {}): Promise<DesktopDb> {
  const path = options.path ?? resolveDefaultDbPath();
  if (cached && cached.path === path) return cached.db;

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const wal = options.wal !== false;
  const { db, raw } = isBun
    ? await openWithBun(path, wal)
    : await openWithBetterSqlite(path, wal);

  if (options.migrate !== false) {
    await runMigrations(db, options.migrationsFolder ?? defaultMigrationsFolder());
  }

  cached = { path, db, raw };
  return db;
}

/** Close the cached connection (mainly for tests / clean shutdown). */
export function closeDb(): void {
  if (cached) {
    cached.raw.close();
    cached = null;
  }
}

export { schema };
