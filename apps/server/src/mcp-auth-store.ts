/**
 * Direct access to the opencode engine's MCP auth store (mcp-auth.json).
 *
 * The engine owns this file (Global.Path.data/mcp-auth.json) and exposes
 * DELETE /mcp/:name/auth, which is the preferred path. This module is the
 * recovery fallback for when the engine is unreachable or refuses: stale
 * entries (tokens + clientInfo from a broken OAuth flow, e.g. PostHog's
 * "Unable to determine region") can permanently block re-auth, and stuck
 * users need a way out that doesn't involve hand-editing JSON.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Mirrors opencode's Global.Path.data resolution (xdg-basedir), aligned with
// opencodeDataDirs() in opencode-db.ts.
function opencodeDataDirs(): string[] {
  const dirs: string[] = [];
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) dirs.push(join(xdg, "opencode"));
  dirs.push(join(homedir(), ".local", "share", "opencode"));
  if (process.platform === "darwin") dirs.push(join(homedir(), "Library", "Application Support", "opencode"));
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    if (appData) dirs.push(join(appData, "opencode"));
  }
  return Array.from(new Set(dirs));
}

/** First existing mcp-auth.json, or the default location when none exists. */
export function resolveMcpAuthStorePath(): string {
  const candidates = opencodeDataDirs().map((dir) => join(dir, "mcp-auth.json"));
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
    ?? join(homedir(), ".local", "share", "opencode", "mcp-auth.json");
}

/**
 * Remove an MCP's entry from the auth store file directly. Returns true when
 * the entry is gone afterwards (deleted, or never existed — idempotent), and
 * false only when the store could not be read or written.
 */
export async function removeMcpAuthEntryFromStore(name: string): Promise<boolean> {
  const path = resolveMcpAuthStorePath();
  if (!existsSync(path)) return true;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed)) return false;
    if (!(name in parsed)) return true;
    const next = { ...parsed };
    delete next[name];
    await writeFile(path, JSON.stringify(next, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
