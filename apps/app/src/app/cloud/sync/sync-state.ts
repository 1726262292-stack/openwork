/**
 * Client-side record of the last successful cloud provider sync sweep, so
 * the UI can show "Synced Xs ago" and update immediately when a sweep
 * completes (the sweep itself lives in the provider-auth store).
 */

const CLOUD_PROVIDERS_SYNCED_AT_KEY = "openwork.den.providers.syncedAt";

export const cloudProvidersSyncedEvent = "openwork-cloud-providers-synced";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let storageOverrideForTest: StorageLike | null = null;

export function __setCloudSyncStateStorageForTest(storage: StorageLike | null) {
  storageOverrideForTest = storage;
}

function getStorage(): StorageLike | null {
  if (storageOverrideForTest) return storageOverrideForTest;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCloudProvidersSyncedAt(): number | null {
  try {
    const raw = getStorage()?.getItem(CLOUD_PROVIDERS_SYNCED_AT_KEY);
    if (!raw) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeCloudProvidersSyncedAt(at: number = Date.now()) {
  try {
    getStorage()?.setItem(CLOUD_PROVIDERS_SYNCED_AT_KEY, String(at));
  } catch {
    // Storage unavailable — the label simply stays empty.
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent(cloudProvidersSyncedEvent));
    } catch {
      // ignore
    }
  }
}

/** "Synced just now" / "Synced 42s ago" / "Synced 3m ago" / "Synced 2h ago". */
export function formatSyncedAgo(syncedAt: number, now: number = Date.now()): string {
  const elapsedMs = Math.max(0, now - syncedAt);
  if (elapsedMs < 10_000) return "Synced just now";
  if (elapsedMs < 60_000) return `Synced ${Math.floor(elapsedMs / 1000)}s ago`;
  if (elapsedMs < 60 * 60_000) return `Synced ${Math.floor(elapsedMs / 60_000)}m ago`;
  return `Synced ${Math.floor(elapsedMs / (60 * 60_000))}h ago`;
}
