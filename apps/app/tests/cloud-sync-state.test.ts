import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import {
  __setCloudSyncStateStorageForTest,
  formatSyncedAgo,
  readCloudProvidersSyncedAt,
  writeCloudProvidersSyncedAt,
} from "../src/app/cloud/sync/sync-state";

function installStorageStub() {
  const backing = new Map<string, string>();
  __setCloudSyncStateStorageForTest({
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
  return backing;
}

afterAll(() => {
  __setCloudSyncStateStorageForTest(null);
});

describe("cloud providers synced-at record", () => {
  beforeEach(() => {
    installStorageStub();
  });

  test("round-trips a timestamp", () => {
    expect(readCloudProvidersSyncedAt()).toBeNull();
    writeCloudProvidersSyncedAt(1_700_000_000_000);
    expect(readCloudProvidersSyncedAt()).toBe(1_700_000_000_000);
  });

  test("ignores corrupt values", () => {
    const backing = installStorageStub();
    backing.set("openwork.den.providers.syncedAt", "banana");
    expect(readCloudProvidersSyncedAt()).toBeNull();
  });
});

describe("formatSyncedAgo", () => {
  const now = 1_700_000_000_000;

  test("buckets by elapsed time", () => {
    expect(formatSyncedAgo(now - 3_000, now)).toBe("Synced just now");
    expect(formatSyncedAgo(now - 42_000, now)).toBe("Synced 42s ago");
    expect(formatSyncedAgo(now - 3 * 60_000, now)).toBe("Synced 3m ago");
    expect(formatSyncedAgo(now - 2 * 60 * 60_000, now)).toBe("Synced 2h ago");
  });

  test("clamps future timestamps to just now", () => {
    expect(formatSyncedAgo(now + 60_000, now)).toBe("Synced just now");
  });
});
