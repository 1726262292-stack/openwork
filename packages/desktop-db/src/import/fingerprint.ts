import { readFile, readdir, stat } from "node:fs/promises";

/**
 * Fast, non-cryptographic content hash (FNV-1a, 32-bit, hex). Used only to record
 * "what we imported" for diagnostics — NOT for security. We never modify or copy the
 * source files; they stay exactly where they are so an older (pre-DB) app version can
 * still read them after a rollback.
 */
function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Content hash for a file, or null if it doesn't exist. Never mutates the file. */
export async function fileHash(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path);
    return fnv1a(new Uint8Array(buf));
  } catch {
    return null;
  }
}

/**
 * Combined content hash for a directory of files (used for the audit dir): sorted
 * "<name>=<hash>" pairs joined with "|". Returns null if the dir is absent/empty.
 */
export async function dirHash(dir: string, suffix = ""): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const parts: string[] = [];
  for (const name of names.sort()) {
    if (suffix && !name.endsWith(suffix)) continue;
    const h = await fileHash(`${dir}/${name}`);
    if (h) parts.push(`${name}=${h}`);
  }
  if (parts.length === 0) return null;
  return fnv1a(new TextEncoder().encode(parts.join("|")));
}

/** Whether a file exists (no read). */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
