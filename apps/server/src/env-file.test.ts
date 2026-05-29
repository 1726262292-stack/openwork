import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EnvService, InvalidEnvKeyError, isReservedEnvKey, isValidEnvKey } from "./env-file.js";
import { closeDb, readEnvForInjection, openDb } from "@openwork/desktop-db";

describe("env-file (DB-backed)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openwork-env-"));
    dbPath = join(dir, "env.db");
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  test("isValidEnvKey accepts POSIX names, rejects garbage", () => {
    expect(isValidEnvKey("ANTHROPIC_API_KEY")).toBe(true);
    expect(isValidEnvKey("_x")).toBe(true);
    expect(isValidEnvKey("GCLOUD_PROJECT")).toBe(true);
    expect(isValidEnvKey("1BAD")).toBe(false);
    expect(isValidEnvKey("has space")).toBe(false);
    expect(isValidEnvKey("has-dash")).toBe(false);
    expect(isValidEnvKey("")).toBe(false);
  });

  test("isReservedEnvKey blocks OPENWORK_ / OPENCODE_ prefixes", () => {
    expect(isReservedEnvKey("OPENWORK_TOKEN")).toBe(true);
    expect(isReservedEnvKey("OPENCODE_SERVER_PASSWORD")).toBe(true);
    expect(isReservedEnvKey("ANTHROPIC_API_KEY")).toBe(false);
    expect(isReservedEnvKey("GCLOUD_PROJECT")).toBe(false);
  });

  test("upsertMany + list round-trips with sorted keys", async () => {
    const svc = new EnvService({ path: dbPath });
    await svc.upsertMany([
      { key: "ZED", value: "z" },
      { key: "ANTHROPIC_API_KEY", value: "sk-ant-abc123" },
    ]);
    const items = await svc.list();
    expect(items.map((e) => e.key)).toEqual(["ANTHROPIC_API_KEY", "ZED"]);
    expect(items.find((e) => e.key === "ANTHROPIC_API_KEY")?.value).toBe("sk-ant-abc123");
  });

  test("upsertMany updates existing keys in place", async () => {
    const svc = new EnvService({ path: dbPath });
    await svc.upsertMany([{ key: "FOO", value: "1" }]);
    await svc.upsertMany([{ key: "FOO", value: "2" }]);
    const items = await svc.list();
    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe("2");
  });

  test("upsertMany rejects invalid and reserved keys", async () => {
    const svc = new EnvService({ path: dbPath });
    await expect(svc.upsertMany([{ key: "1BAD", value: "x" }])).rejects.toBeInstanceOf(
      InvalidEnvKeyError,
    );
    await expect(
      svc.upsertMany([{ key: "OPENWORK_TOKEN", value: "x" }]),
    ).rejects.toBeInstanceOf(InvalidEnvKeyError);
    expect(await svc.list()).toHaveLength(0);
  });

  test("delete removes a key and reports whether it existed", async () => {
    const svc = new EnvService({ path: dbPath });
    await svc.upsertMany([{ key: "FOO", value: "1" }]);
    expect(await svc.delete("FOO")).toBe(true);
    expect(await svc.delete("FOO")).toBe(false);
    expect(await svc.list()).toHaveLength(0);
  });

  test("readEnvForInjection strips reserved keys", async () => {
    const db = await openDb({ path: dbPath });
    const svc = new EnvService({ path: dbPath });
    await svc.upsertMany([{ key: "ANTHROPIC_API_KEY", value: "sk" }]);
    const injected = await readEnvForInjection(db);
    expect(injected.ANTHROPIC_API_KEY).toBe("sk");
    expect(injected.OPENWORK_TOKEN).toBeUndefined();
  });
});
