import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "./client";
import { auditTable, tokenTable, workspaceTable, serverConfigTable } from "./schema/index";
import { createDesktopTypeId, isDesktopTypeId, normalizeDesktopTypeId } from "./typeid";
import { eq } from "drizzle-orm";
import { runPhase1Import } from "./import/index";

let tmp: string | null = null;

afterEach(() => {
  closeDb();
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

function freshDir(): string {
  tmp = mkdtempSync(join(tmpdir(), "owdb-"));
  return tmp;
}

describe("typeid", () => {
  test("generates and validates desktop type ids", () => {
    const id = createDesktopTypeId("workspaceMeta");
    expect(id.startsWith("wsmeta_")).toBe(true);
    expect(isDesktopTypeId("workspaceMeta", id)).toBe(true);
    expect(isDesktopTypeId("token", id)).toBe(false);
  });

  test("normalize rejects prefix mismatch", () => {
    const tokenId = createDesktopTypeId("token");
    expect(() => normalizeDesktopTypeId("audit", tokenId)).toThrow();
  });
});

describe("client", () => {
  test("opens, migrates, and round-trips a typeid column", async () => {
    const dir = freshDir();
    const db = await openDb({ path: join(dir, "test.db") });
    const id = createDesktopTypeId("token");
    const now = Date.now();
    db.insert(tokenTable).values({ id, hash: "abc", scope: "owner", createdAt: now }).run();
    const rows = db.select().from(tokenTable).where(eq(tokenTable.hash, "abc")).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(id);
    expect(rows[0]!.scope).toBe("owner");
  });
});

describe("phase 1 import", () => {
  test("imports server.json, tokens.json, and audit jsonl", async () => {
    const dir = freshDir();
    const serverJsonPath = join(dir, "server.json");
    const tokensJsonPath = join(dir, "tokens.json");
    const auditDir = join(dir, "audit");
    mkdirSync(auditDir, { recursive: true });

    writeFileSync(
      serverJsonPath,
      JSON.stringify({
        host: "127.0.0.1",
        port: 8787,
        token: "secret-token",
        approval: { mode: "auto", timeoutMs: 1000 },
        workspaces: [
          { id: "ws_aaa", path: "/tmp/a", name: "A", preset: "default" },
          { id: "ws_bbb", path: "/tmp/b", name: "B", workspaceType: "remote", remoteType: "openwork" },
        ],
        authorizedRoots: ["/tmp/a", "/tmp/b"],
      }),
    );
    writeFileSync(
      tokensJsonPath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: Date.now(),
        tokens: [
          { id: "uuid-1", hash: "hash-1", scope: "owner", createdAt: 1 },
          { id: "uuid-2", hash: "hash-2", scope: "viewer", createdAt: 2, label: "ci" },
        ],
      }),
    );
    writeFileSync(
      join(auditDir, "ws_aaa.jsonl"),
      [
        JSON.stringify({ id: "a1", workspaceId: "ws_aaa", actor: { type: "host" }, action: "workspace.create", target: "/tmp/a", summary: "created", timestamp: 10 }),
        JSON.stringify({ id: "a2", workspaceId: "ws_aaa", actor: { type: "remote", scope: "owner" }, action: "config.write", target: "opencode.json", summary: "wrote", timestamp: 20 }),
      ].join("\n") + "\n",
    );

    const db = await openDb({ path: join(dir, "test.db") });
    const report = await runPhase1Import(db, { serverJsonPath, tokensJsonPath, auditDir });

    expect(report.serverJson!.found).toBe(true);
    expect(report.tokensJson!.found).toBe(true);
    expect(report.audit!.found).toBe(true);

    const workspaces = db.select().from(workspaceTable).all();
    expect(workspaces.length).toBe(2);
    const wsA = workspaces.find((w) => w.id === "ws_aaa");
    expect(wsA?.sortOrder).toBe(0);
    expect(wsA?.name).toBe("A");

    const tokens = db.select().from(tokenTable).all();
    expect(tokens.length).toBe(2);

    const portRow = db
      .select()
      .from(serverConfigTable)
      .where(eq(serverConfigTable.key, "port"))
      .all();
    expect(portRow[0]!.value).toBe(8787);

    const audits = db.select().from(auditTable).all();
    expect(audits.length).toBe(2);
    expect(audits[0]!.sourceId).toBe("a1");

    // idempotent re-run
    const report2 = await runPhase1Import(db, { serverJsonPath, tokensJsonPath, auditDir });
    expect(report2.serverJson!.found).toBe(true);
    expect(db.select().from(workspaceTable).all().length).toBe(2);
    expect(db.select().from(tokenTable).all().length).toBe(2);
  });
});
