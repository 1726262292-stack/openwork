import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "./client";
import { migrationStateTable, tokenTable, workspaceTable } from "./schema/index";
import { runPhase1ImportOnce } from "./import/index";

let tmp: string | null = null;

afterEach(() => {
  closeDb();
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

function setup() {
  tmp = mkdtempSync(join(tmpdir(), "owimport-"));
  const serverJsonPath = join(tmp, "server.json");
  const tokensJsonPath = join(tmp, "tokens.json");
  const auditDir = join(tmp, "audit");
  mkdirSync(auditDir, { recursive: true });
  writeFileSync(
    serverJsonPath,
    JSON.stringify({
      port: 8787,
      workspaces: [{ id: "ws_a", path: "/tmp/a", name: "A" }],
      authorizedRoots: ["/tmp/a"],
    }),
  );
  writeFileSync(
    tokensJsonPath,
    JSON.stringify({ schemaVersion: 1, tokens: [{ id: "u1", hash: "h1", scope: "owner" }] }),
  );
  writeFileSync(
    join(auditDir, "ws_a.jsonl"),
    JSON.stringify({ id: "a1", workspaceId: "ws_a", action: "x", target: "y", summary: "z", timestamp: 1 }) + "\n",
  );
  return { serverJsonPath, tokensJsonPath, auditDir };
}

describe("runPhase1ImportOnce", () => {
  test("imports once, never touches the source files, and skips on re-run", async () => {
    const { serverJsonPath, tokensJsonPath, auditDir } = setup();
    const serverJsonBefore = readFileSync(serverJsonPath, "utf8");
    const db = await openDb({ path: join(tmp!, "test.db") });

    const first = await runPhase1ImportOnce(db, { serverJsonPath, tokensJsonPath, auditDir });
    expect(first["server.json"]!.status).toBe("imported");
    expect(first["tokens.json"]!.status).toBe("imported");
    expect(first.audit!.status).toBe("imported");

    // Source files are left EXACTLY in place: unchanged content, no .bak/.tmp siblings.
    expect(existsSync(serverJsonPath)).toBe(true);
    expect(readFileSync(serverJsonPath, "utf8")).toBe(serverJsonBefore);
    expect(existsSync(`${serverJsonPath}.pre-db.bak`)).toBe(false);
    expect(existsSync(`${tokensJsonPath}.pre-db.bak`)).toBe(false);
    expect(existsSync(join(auditDir, "..", "audit-pre-db-bak"))).toBe(false);

    expect(db.select().from(workspaceTable).all().length).toBe(1);
    expect(db.select().from(tokenTable).all().length).toBe(1);

    // migration_state records path + hash.
    const state = db.select().from(migrationStateTable).all();
    const serverRow = state.find((s) => s.source === "server.json");
    expect(serverRow?.status).toBe("imported");
    expect(serverRow?.path).toBe(serverJsonPath);
    expect(serverRow?.hash.length).toBeGreaterThan(0);

    // Re-run with unchanged sources -> already-done, no duplicate rows.
    const second = await runPhase1ImportOnce(db, { serverJsonPath, tokensJsonPath, auditDir });
    expect(second["server.json"]!.status).toBe("already-done");
    expect(second.audit!.status).toBe("already-done");
    expect(db.select().from(workspaceTable).all().length).toBe(1);
    expect(db.select().from(tokenTable).all().length).toBe(1);
  });

  test("imports ONCE EVER: later source edits are ignored", async () => {
    const { serverJsonPath, tokensJsonPath, auditDir } = setup();
    const db = await openDb({ path: join(tmp!, "test.db") });

    await runPhase1ImportOnce(db, { serverJsonPath, tokensJsonPath, auditDir });
    expect(db.select().from(workspaceTable).all().length).toBe(1);

    // Simulate an older app version editing the original file after import.
    writeFileSync(
      serverJsonPath,
      JSON.stringify({
        port: 8787,
        workspaces: [
          { id: "ws_a", path: "/tmp/a", name: "A" },
          { id: "ws_b", path: "/tmp/b", name: "B" },
        ],
        authorizedRoots: ["/tmp/a", "/tmp/b"],
      }),
    );

    const second = await runPhase1ImportOnce(db, { serverJsonPath, tokensJsonPath, auditDir });
    // Already imported once -> skipped despite the new content.
    expect(second["server.json"]!.status).toBe("already-done");
    expect(db.select().from(workspaceTable).all().length).toBe(1);
  });

  test("reports missing sources without error", async () => {
    tmp = mkdtempSync(join(tmpdir(), "owimport-"));
    const db = await openDb({ path: join(tmp, "test.db") });
    const report = await runPhase1ImportOnce(db, {
      serverJsonPath: join(tmp, "nope.json"),
      tokensJsonPath: join(tmp, "nope-tokens.json"),
      auditDir: join(tmp, "no-audit"),
    });
    expect(report["server.json"]!.status).toBe("missing");
    expect(report["tokens.json"]!.status).toBe("missing");
    expect(report.audit!.status).toBe("missing");
  });
});
