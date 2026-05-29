import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, openDb } from "./client";
import {
  workspaceTable,
  workspaceServerTokenTable,
  workspacePortTable,
  preferenceTable,
} from "./schema/index";
import {
  runDesktopImportOnce,
  DESKTOP_SELECTED_WORKSPACE_PREF,
  DESKTOP_PREFERRED_PORT_PREF,
} from "./import/index";

let tmp: string | null = null;

afterEach(() => {
  closeDb();
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

function setup() {
  tmp = mkdtempSync(join(tmpdir(), "owdesktop-"));
  const workspacesPath = join(tmp, "openwork-workspaces.json");
  const serverTokensPath = join(tmp, "openwork-server-tokens.json");
  const serverStatePath = join(tmp, "openwork-server-state.json");

  writeFileSync(
    workspacesPath,
    JSON.stringify({
      selectedId: "ws_a",
      watchedId: "ws_a",
      workspaces: [
        { id: "ws_a", name: "A", path: "/tmp/a", workspaceType: "local" },
        {
          id: "rem_x",
          name: "Remote",
          path: "/remote/x",
          workspaceType: "remote",
          remoteType: "openwork",
          baseUrl: "http://host",
          openworkClientToken: "ct",
          openworkHostToken: "ht",
          openworkWorkspaceId: "x",
        },
      ],
    }),
  );
  writeFileSync(
    serverTokensPath,
    JSON.stringify({
      version: 1,
      workspaces: {
        "/tmp/a": { clientToken: "c1", hostToken: "h1", ownerToken: "o1", updatedAt: 5 },
      },
    }),
  );
  writeFileSync(
    serverStatePath,
    JSON.stringify({ version: 3, workspacePorts: { "/tmp/a": 48123 }, preferredPort: null }),
  );

  return { workspacesPath, serverTokensPath, serverStatePath };
}

describe("runDesktopImportOnce", () => {
  test("imports workspaces, tokens, ports; snapshots; idempotent", async () => {
    const { workspacesPath, serverTokensPath, serverStatePath } = setup();
    const db = await openDb({ path: join(tmp!, "test.db") });

    const report = await runDesktopImportOnce(db, {
      workspacesPath,
      serverTokensPath,
      serverStatePath,
    });
    expect(report["electron:openwork-workspaces.json"]!.status).toBe("imported");
    expect(report["electron:openwork-server-tokens.json"]!.status).toBe("imported");
    expect(report["electron:openwork-server-state.json"]!.status).toBe("imported");

    expect(existsSync(`${workspacesPath}.pre-db.bak`)).toBe(true);

    const workspaces = db.select().from(workspaceTable).all();
    expect(workspaces.length).toBe(2);
    const remote = workspaces.find((w) => w.id === "rem_x");
    expect(remote?.openworkClientToken).toBe("ct");
    expect(remote?.openworkHostToken).toBe("ht");

    const tokens = db
      .select()
      .from(workspaceServerTokenTable)
      .where(eq(workspaceServerTokenTable.workspaceKey, "/tmp/a"))
      .all();
    expect(tokens[0]?.ownerToken).toBe("o1");

    const ports = db.select().from(workspacePortTable).all();
    expect(ports[0]?.port).toBe(48123);

    const selected = db
      .select()
      .from(preferenceTable)
      .where(eq(preferenceTable.key, DESKTOP_SELECTED_WORKSPACE_PREF))
      .all();
    expect(selected[0]?.value).toBe("ws_a");

    // Re-run: already-done, no duplicates.
    const second = await runDesktopImportOnce(db, {
      workspacesPath,
      serverTokensPath,
      serverStatePath,
    });
    expect(second["electron:openwork-workspaces.json"]!.status).toBe("already-done");
    expect(db.select().from(workspaceTable).all().length).toBe(2);
  });

  test("preferred port preference imported when set", async () => {
    tmp = mkdtempSync(join(tmpdir(), "owdesktop-"));
    const serverStatePath = join(tmp, "openwork-server-state.json");
    writeFileSync(serverStatePath, JSON.stringify({ version: 3, preferredPort: 49000 }));
    const db = await openDb({ path: join(tmp, "test.db") });
    await runDesktopImportOnce(db, {
      workspacesPath: join(tmp, "missing-workspaces.json"),
      serverTokensPath: join(tmp, "missing-tokens.json"),
      serverStatePath,
    });
    const pref = db
      .select()
      .from(preferenceTable)
      .where(eq(preferenceTable.key, DESKTOP_PREFERRED_PORT_PREF))
      .all();
    expect(pref[0]?.value).toBe(49000);
  });
});
