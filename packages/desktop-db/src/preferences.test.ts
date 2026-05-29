import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "./client";
import {
  getAllMirroredPreferences,
  getPreference,
  isMirroredPreferenceKey,
  removePreference,
  setPreference,
} from "./preferences";

let tmp: string | null = null;

afterEach(() => {
  closeDb();
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

async function freshDb() {
  tmp = mkdtempSync(join(tmpdir(), "owpref-"));
  return openDb({ path: join(tmp, "test.db") });
}

describe("preference mirror", () => {
  test("classifies mirrored vs ephemeral keys", () => {
    expect(isMirroredPreferenceKey("openwork.defaultModel")).toBe(true);
    expect(isMirroredPreferenceKey("openwork.sessionModels.ws_a")).toBe(true);
    expect(isMirroredPreferenceKey("openwork.extension.enabled.foo")).toBe(true);
    expect(isMirroredPreferenceKey("openwork.modelVariant.ws_a")).toBe(true);
    // ephemeral / not tracked
    expect(isMirroredPreferenceKey("openwork:session-scroll:v1")).toBe(false);
    expect(isMirroredPreferenceKey("openwork.server.token")).toBe(false);
    expect(isMirroredPreferenceKey("openwork.ui")).toBe(false);
    expect(isMirroredPreferenceKey("openwork.debug.profiler")).toBe(false);
  });

  test("set/get/remove round-trip and getAll filters to mirrored keys", async () => {
    const db = await freshDb();
    await setPreference(db, "openwork.defaultModel", "anthropic/claude");
    await setPreference(db, "openwork.extension.enabled.foo", "1");
    // store a non-mirrored key directly via setPreference (raw store) — getAll must exclude it
    await setPreference(db, "openwork:session-scroll:v1", "x");

    expect(await getPreference(db, "openwork.defaultModel")).toBe("anthropic/claude");

    const all = await getAllMirroredPreferences(db);
    expect(all["openwork.defaultModel"]).toBe("anthropic/claude");
    expect(all["openwork.extension.enabled.foo"]).toBe("1");
    expect("openwork:session-scroll:v1" in all).toBe(false);

    await removePreference(db, "openwork.defaultModel");
    expect(await getPreference(db, "openwork.defaultModel")).toBeNull();
  });
});
