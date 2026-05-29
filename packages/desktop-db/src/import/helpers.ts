import { readFile } from "node:fs/promises";

/** Read + JSON.parse a file, returning `null` if it doesn't exist or is invalid. */
export async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Read a file's lines, returning [] if it doesn't exist. */
export async function readLines(path: string): Promise<string[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split("\n").filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

export interface ImportResult {
  /** Number of rows inserted/updated for this source. */
  count: number;
  /** Whether the source file existed. */
  found: boolean;
}

export type ImportReport = Record<string, ImportResult>;
