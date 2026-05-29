/**
 * Desktop preference sync.
 *
 * On the desktop (Electron) shell, the SQLite DB is the durable source of truth for
 * "real state" renderer preferences (connection topology, model prefs, drafts, shell
 * config, onboarding flags, etc.). localStorage stays the synchronous fast-path every
 * store/provider already uses; this module keeps the two in sync without rewriting any
 * consumer:
 *
 *  1. hydrate(): on boot, copy DB preferences -> localStorage (DB wins) BEFORE any store
 *     reads localStorage.
 *  2. installWriteThrough(): patch window.localStorage so writes/removes of MIRRORED
 *     keys are also pushed to the DB via the Electron `preferences` IPC.
 *
 * On the web (no Electron bridge) this is a no-op and localStorage behaves normally.
 *
 * Purely-ephemeral UI keys (scroll, sidebar widths, debug toggles) are intentionally
 * NOT mirrored — see MIRRORED_PREFERENCE_KEYS / _PREFIXES.
 */

// Keep in sync with packages/desktop-db/src/preferences.ts
const MIRRORED_PREFERENCE_KEYS: readonly string[] = [
  "openwork.server.list",
  "openwork.server.active",
  "openwork.server.remoteAccessEnabled",
  "openwork.react.workspaceOrder",
  "openwork.session-drafts.v1",
  "openwork.shell-config",
  "openwork.preferences",
  "openwork.defaultModel",
  "openwork.hiddenModels",
  "openwork.skills.hubRepos.v1",
  "openwork.acknowledgedProviders",
  "openwork.seenProviderIds",
  "openwork.orgOnboardingSeen",
];

const MIRRORED_PREFERENCE_PREFIXES: readonly string[] = [
  "openwork.sessionModels",
  "openwork.modelVariant",
  "openwork.extension.",
];

export function isMirroredPreferenceKey(key: string): boolean {
  if (MIRRORED_PREFERENCE_KEYS.includes(key)) return true;
  return MIRRORED_PREFERENCE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

type PreferencesBridge = {
  getAll?: () => Promise<Record<string, string>>;
  set?: (key: string, value: string) => Promise<unknown>;
  remove?: (key: string) => Promise<unknown>;
};

function getBridge(): PreferencesBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as {
    __OPENWORK_ELECTRON__?: { preferences?: PreferencesBridge };
  }).__OPENWORK_ELECTRON__;
  return bridge?.preferences ?? null;
}

let installed = false;

/**
 * Hydrate localStorage from the desktop DB (DB wins), then install the write-through
 * mirror. Safe to call once at boot; no-op on web. Never throws (best-effort).
 */
export async function initDesktopPreferenceSync(): Promise<void> {
  const bridge = getBridge();
  if (!bridge?.getAll) return;

  try {
    const prefs = await bridge.getAll();
    for (const [key, value] of Object.entries(prefs ?? {})) {
      if (typeof value !== "string") continue;
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // storage may be unavailable; skip.
      }
    }
  } catch {
    // DB unavailable; fall back to whatever is already in localStorage.
  }

  installWriteThrough();
}

/**
 * Patch localStorage.setItem/removeItem so mutations to mirrored keys also write the DB.
 * Idempotent. Exported separately for tests.
 */
export function installWriteThrough(): void {
  if (installed) return;
  const bridge = getBridge();
  if (!bridge?.set || !bridge?.remove) return;
  if (typeof window === "undefined" || !window.localStorage) return;

  const storage = window.localStorage;
  const originalSet = storage.setItem.bind(storage);
  const originalRemove = storage.removeItem.bind(storage);

  storage.setItem = (key: string, value: string) => {
    originalSet(key, value);
    if (isMirroredPreferenceKey(key)) {
      void bridge.set?.(key, value)?.catch?.(() => undefined);
    }
  };

  storage.removeItem = (key: string) => {
    originalRemove(key);
    if (isMirroredPreferenceKey(key)) {
      void bridge.remove?.(key)?.catch?.(() => undefined);
    }
  };

  installed = true;
}
