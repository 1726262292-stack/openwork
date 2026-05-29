import type { ServerConfig, TokenScope } from "./types.js";
import { hashToken, shortId } from "./utils.js";
import { getDb } from "./db.js";
import { tokenTable, createDesktopTypeId, isDesktopTypeId, normalizeDesktopTypeId, drizzle } from "@openwork/desktop-db";

export type TokenRecord = {
  id: string;
  hash: string;
  scope: TokenScope;
  createdAt: number;
  label?: string;
};

function normalizeScope(value: unknown): TokenScope | null {
  if (value === "owner" || value === "collaborator" || value === "viewer") return value;
  return null;
}

/**
 * DB-backed scoped API tokens (replaces `tokens.json`).
 *
 * Same public interface as before; the original `tokens.json` is preserved on disk
 * (snapshotted to `.pre-db.bak`) and imported once into the `token` table.
 *
 * Only the SHA-256 hash is stored; the built-in `config.token` still resolves to
 * "collaborator" without a DB lookup.
 */
export class TokenService {
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  async list(): Promise<Array<Omit<TokenRecord, "hash">>> {
    const db = await getDb(this.config);
    const rows = await db
      .select()
      .from(tokenTable)
      .orderBy(drizzle.desc(tokenTable.createdAt));
    return rows.map((row) => ({
      id: row.id,
      scope: (normalizeScope(row.scope) ?? "viewer") as TokenScope,
      createdAt: row.createdAt,
      ...(row.label ? { label: row.label } : {}),
    }));
  }

  async create(
    scope: TokenScope,
    options?: { label?: string },
  ): Promise<{ id: string; token: string; scope: TokenScope; createdAt: number; label?: string }> {
    const db = await getDb(this.config);
    const id = createDesktopTypeId("token");
    const token = `owt_${shortId().replace(/-/g, "")}`;
    const createdAt = Date.now();
    const label = options?.label?.trim() || undefined;

    await db
      .insert(tokenTable)
      .values({ id, hash: hashToken(token), scope, label: label ?? null, createdAt })
      .run();

    return { id, token, scope, createdAt, label };
  }

  async revoke(id: string): Promise<boolean> {
    if (!isDesktopTypeId("token", id)) return false;
    const db = await getDb(this.config);
    const tokenId = normalizeDesktopTypeId("token", id);
    const existing = await db
      .select({ id: tokenTable.id })
      .from(tokenTable)
      .where(drizzle.eq(tokenTable.id, tokenId));
    if (existing.length === 0) return false;
    await db.delete(tokenTable).where(drizzle.eq(tokenTable.id, tokenId)).run();
    return true;
  }

  async scopeForToken(token: string): Promise<TokenScope | null> {
    const trimmed = token.trim();
    if (!trimmed) return null;
    if (trimmed === this.config.token) return "collaborator";
    const db = await getDb(this.config);
    const rows = await db
      .select()
      .from(tokenTable)
      .where(drizzle.eq(tokenTable.hash, hashToken(trimmed)));
    const found = rows[0];
    return found ? (normalizeScope(found.scope) ?? null) : null;
  }
}
