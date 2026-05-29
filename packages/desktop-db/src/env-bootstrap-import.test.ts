import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "./client";
import { listEnvVars } from "./env-store";
import { getDesktopBootstrapConfig } from "./bootstrap";
import { runDesktopImportOnce } from "./import/index";

let tmp: string | null = null;

afterEach(() => {
  closeDb();
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

describe("env + bootstrap import", () => {
  test("imports env.json (skipping reserved/invalid) and desktop-bootstrap.json", async () => {
    tmp = mkdtempSync(join(tmpdir(), "owenv-"));
    const envPath = join(tmp, "env.json");
    const bootstrapPath = join(tmp, "desktop-bootstrap.json");
    writeFileSync(
      envPath,
      JSON.stringify({
        schemaVersion: 1,
        variables: [
          { key: "ANTHROPIC_API_KEY", value: "sk", updatedAt: 1 },
          { key: "OPENWORK_TOKEN", value: "nope", updatedAt: 1 }, // reserved -> skipped
          { key: "1BAD", value: "x", updatedAt: 1 }, // invalid -> skipped
        ],
      }),
    );
    writeFileSync(
      bootstrapPath,
      JSON.stringify({ baseUrl: "https://app.example.com", apiBaseUrl: "https://api.example.com", requireSignin: true }),
    );

    const db = await openDb({ path: join(tmp, "test.db") });
    const report = await runDesktopImportOnce(db, {
      workspacesPath: join(tmp, "missing-ws.json"),
      serverTokensPath: join(tmp, "missing-tok.json"),
      serverStatePath: join(tmp, "missing-state.json"),
      envPath,
      bootstrapPath,
    });

    expect(report["env.json"]!.status).toBe("imported");
    expect(report["desktop-bootstrap.json"]!.status).toBe("imported");
    // Source file left untouched (no .bak snapshot).
    expect(existsSync(envPath)).toBe(true);
    expect(existsSync(`${envPath}.pre-db.bak`)).toBe(false);

    const envVars = await listEnvVars(db);
    expect(envVars.map((v) => v.key)).toEqual(["ANTHROPIC_API_KEY"]);

    const bootstrap = await getDesktopBootstrapConfig(db);
    expect(bootstrap.baseUrl).toBe("https://app.example.com");
    expect(bootstrap.apiBaseUrl).toBe("https://api.example.com");
    expect(bootstrap.requireSignin).toBe(true);

    // idempotent
    const second = await runDesktopImportOnce(db, {
      workspacesPath: join(tmp, "missing-ws.json"),
      serverTokensPath: join(tmp, "missing-tok.json"),
      serverStatePath: join(tmp, "missing-state.json"),
      envPath,
      bootstrapPath,
    });
    expect(second["env.json"]!.status).toBe("already-done");
    expect((await listEnvVars(db)).length).toBe(1);
  });
});
