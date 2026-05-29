import { copyFile, readdir, stat } from "node:fs/promises";

/** "<mtimeMs>:<size>" for a file, or null if it doesn't exist. */
export async function fileFingerprint(path: string): Promise<string | null> {
  try {
    const s = await stat(path);
    return `${Math.round(s.mtimeMs)}:${s.size}`;
  } catch {
    return null;
  }
}

/**
 * A combined fingerprint for a directory of files (used for the audit dir): sorted
 * "<name>=<mtimeMs>:<size>" pairs joined with "|". Returns null if the dir is absent.
 */
export async function dirFingerprint(dir: string, suffix = ""): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const parts: string[] = [];
  for (const name of names.sort()) {
    if (suffix && !name.endsWith(suffix)) continue;
    const fp = await fileFingerprint(`${dir}/${name}`);
    if (fp) parts.push(`${name}=${fp}`);
  }
  return parts.join("|");
}

/**
 * Write a one-time `<path>.pre-db.bak` snapshot of a source file (only if the source
 * exists and the backup doesn't already exist). Returns the backup path, or null if
 * the source is missing. Never deletes or modifies the source.
 */
export async function snapshotOnce(path: string): Promise<string | null> {
  const fp = await fileFingerprint(path);
  if (!fp) return null;
  const backup = `${path}.pre-db.bak`;
  const existing = await fileFingerprint(backup);
  if (!existing) {
    await copyFile(path, backup);
  }
  return backup;
}
