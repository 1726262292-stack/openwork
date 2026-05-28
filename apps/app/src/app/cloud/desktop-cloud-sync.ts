import {
  createDenClient,
  normalizeDenResourceSnapshot,
  readDenSettings,
  type DenResourceSnapshot,
} from "../lib/den";
import {
  readDesktopCloudSyncCache,
  writeDesktopCloudSyncCache,
} from "../lib/desktop";
import type { WorkspaceCloudImports } from "./import-state";

const CACHE_VERSION = 1;
const LOCAL_STORAGE_CACHE_KEY = "openwork.desktopCloudSync.v1";
let desktopCloudSyncQueue: Promise<void> = Promise.resolve();

export type DesktopCloudSyncChangeKind = "new" | "modified" | "removed";
export type DesktopCloudSyncResourceKind = "llmProvider" | "marketplace" | "plugin" | "configItem";

export type DesktopCloudSyncChange = {
  id: string;
  kind: DesktopCloudSyncChangeKind;
  resourceKind: DesktopCloudSyncResourceKind;
  marketplaceId?: string;
  pluginId?: string;
  previousLastUpdatedAt: string | null;
  nextLastUpdatedAt: string | null;
  queuedAt: number;
};

export type DesktopCloudSyncCacheEntry = {
  apiBaseUrl: string | null;
  baseUrl: string;
  contextKey: string;
  fetchedAt: number;
  organizationId: string;
  orgMemberId: string;
  pendingChanges: DesktopCloudSyncChange[];
  snapshot: DenResourceSnapshot;
  teamIds: string[];
};

export type DesktopCloudSyncCacheStore = {
  entries: Record<string, DesktopCloudSyncCacheEntry>;
  updatedAt: number;
  version: typeof CACHE_VERSION;
};

type SyncEntry = {
  id: string;
  lastUpdatedAt: string;
  marketplaceId?: string;
  pluginId?: string;
  resourceKind: DesktopCloudSyncResourceKind;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function readChange(value: unknown): DesktopCloudSyncChange | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const kind = value.kind === "new" || value.kind === "modified" || value.kind === "removed"
    ? value.kind
    : null;
  const resourceKind = value.resourceKind === "llmProvider" ||
    value.resourceKind === "marketplace" ||
    value.resourceKind === "plugin" ||
    value.resourceKind === "configItem"
    ? value.resourceKind
    : null;
  const queuedAt = typeof value.queuedAt === "number" && Number.isFinite(value.queuedAt)
    ? value.queuedAt
    : Date.now();
  if (!id || !kind || !resourceKind) return null;

  return {
    id,
    kind,
    resourceKind,
    marketplaceId: typeof value.marketplaceId === "string" ? value.marketplaceId.trim() || undefined : undefined,
    pluginId: typeof value.pluginId === "string" ? value.pluginId.trim() || undefined : undefined,
    previousLastUpdatedAt: typeof value.previousLastUpdatedAt === "string" ? value.previousLastUpdatedAt : null,
    nextLastUpdatedAt: typeof value.nextLastUpdatedAt === "string" ? value.nextLastUpdatedAt : null,
    queuedAt,
  };
}

function readCacheEntry(contextKey: string, value: unknown): DesktopCloudSyncCacheEntry | null {
  if (!isRecord(value)) return null;
  const snapshot = normalizeDenResourceSnapshot(value.snapshot);
  if (!snapshot) return null;

  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
  const organizationId = typeof value.organizationId === "string"
    ? value.organizationId.trim()
    : snapshot.organizationId;
  const orgMemberId = typeof value.orgMemberId === "string" ? value.orgMemberId.trim() : snapshot.orgMemberId;
  const fetchedAt = typeof value.fetchedAt === "number" && Number.isFinite(value.fetchedAt)
    ? value.fetchedAt
    : 0;
  if (!baseUrl || !organizationId || !orgMemberId) return null;

  return {
    apiBaseUrl: typeof value.apiBaseUrl === "string" ? value.apiBaseUrl.trim() || null : null,
    baseUrl,
    contextKey,
    fetchedAt,
    organizationId,
    orgMemberId,
    pendingChanges: Array.isArray(value.pendingChanges)
      ? value.pendingChanges.flatMap((entry) => {
          const change = readChange(entry);
          return change ? [change] : [];
        })
      : [],
    snapshot,
    teamIds: readStringArray(value.teamIds),
  };
}

function readCacheStore(value: unknown): DesktopCloudSyncCacheStore {
  if (!isRecord(value)) {
    return { entries: {}, updatedAt: 0, version: CACHE_VERSION };
  }

  const rawEntries = isRecord(value.entries) ? value.entries : {};
  const entries: Record<string, DesktopCloudSyncCacheEntry> = {};
  for (const [key, entry] of Object.entries(rawEntries)) {
    const contextKey = key.trim();
    const parsed = contextKey ? readCacheEntry(contextKey, entry) : null;
    if (parsed) {
      entries[contextKey] = parsed;
    }
  }

  return {
    entries,
    updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    version: CACHE_VERSION,
  };
}

async function readPersistentCache(): Promise<DesktopCloudSyncCacheStore> {
  try {
    return readCacheStore(await readDesktopCloudSyncCache());
  } catch {
    if (typeof window === "undefined") {
      return { entries: {}, updatedAt: 0, version: CACHE_VERSION };
    }
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_CACHE_KEY);
      return readCacheStore(raw ? JSON.parse(raw) : null);
    } catch {
      return { entries: {}, updatedAt: 0, version: CACHE_VERSION };
    }
  }
}

async function writePersistentCache(store: DesktopCloudSyncCacheStore): Promise<void> {
  try {
    await writeDesktopCloudSyncCache(store);
    return;
  } catch {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_STORAGE_CACHE_KEY, JSON.stringify(store));
    } catch {
      // Cache persistence is best-effort; the next refresh will rebuild it.
    }
  }
}

function resourceContextKey(input: {
  apiBaseUrl?: string | null;
  baseUrl: string;
  organizationId: string;
  orgMemberId: string;
}) {
  return [input.baseUrl, input.apiBaseUrl ?? "", input.organizationId, input.orgMemberId].join("::");
}

function changeKey(change: Pick<DesktopCloudSyncChange, "id" | "marketplaceId" | "pluginId" | "resourceKind">) {
  return [change.resourceKind, change.marketplaceId ?? "", change.pluginId ?? "", change.id].join("::");
}

function mergePendingChanges(
  previous: DesktopCloudSyncChange[],
  next: DesktopCloudSyncChange[],
) {
  if (next.length === 0) return previous;
  const nextKeys = new Set(next.map(changeKey));
  return [
    ...previous.filter((change) => !nextKeys.has(changeKey(change))),
    ...next,
  ];
}

function findRemotePlugin(snapshot: DenResourceSnapshot, input: { marketplaceId?: string | null; pluginId: string }) {
  const preferredMarketplaceId = input.marketplaceId?.trim() ?? "";
  if (preferredMarketplaceId) {
    const marketplace = snapshot.resources.marketplaces[preferredMarketplaceId];
    const plugin = marketplace?.plugins.find((entry) => entry.pluginId === input.pluginId) ?? null;
    if (plugin) {
      return { marketplaceId: preferredMarketplaceId, plugin };
    }
  }

  for (const [marketplaceId, marketplace] of Object.entries(snapshot.resources.marketplaces)) {
    const plugin = marketplace.plugins.find((entry) => entry.pluginId === input.pluginId) ?? null;
    if (plugin) {
      return { marketplaceId, plugin };
    }
  }
  return null;
}

function queueInstalledChange(input: {
  changes: DesktopCloudSyncChange[];
  id: string;
  installedLastUpdatedAt: string | null;
  marketplaceId?: string;
  pluginId?: string;
  queuedAt: number;
  remoteLastUpdatedAt: string | null;
  resourceKind: DesktopCloudSyncResourceKind;
}) {
  if (!input.remoteLastUpdatedAt) {
    input.changes.push({
      id: input.id,
      kind: "removed",
      resourceKind: input.resourceKind,
      marketplaceId: input.marketplaceId,
      pluginId: input.pluginId,
      previousLastUpdatedAt: input.installedLastUpdatedAt,
      nextLastUpdatedAt: null,
      queuedAt: input.queuedAt,
    });
    return;
  }

  if (!input.installedLastUpdatedAt) {
    input.changes.push({
      id: input.id,
      kind: "new",
      resourceKind: input.resourceKind,
      marketplaceId: input.marketplaceId,
      pluginId: input.pluginId,
      previousLastUpdatedAt: null,
      nextLastUpdatedAt: input.remoteLastUpdatedAt,
      queuedAt: input.queuedAt,
    });
    return;
  }

  if (input.installedLastUpdatedAt !== input.remoteLastUpdatedAt) {
    input.changes.push({
      id: input.id,
      kind: "modified",
      resourceKind: input.resourceKind,
      marketplaceId: input.marketplaceId,
      pluginId: input.pluginId,
      previousLastUpdatedAt: input.installedLastUpdatedAt,
      nextLastUpdatedAt: input.remoteLastUpdatedAt,
      queuedAt: input.queuedAt,
    });
  }
}

export function flattenDesktopCloudSyncSnapshot(snapshot: DenResourceSnapshot): Record<string, SyncEntry> {
  const entries: Record<string, SyncEntry> = {};

  for (const [providerId, lastUpdatedAt] of Object.entries(snapshot.resources.llmProviders)) {
    entries[`llmProvider:${providerId}`] = {
      id: providerId,
      lastUpdatedAt,
      resourceKind: "llmProvider",
    };
  }

  for (const [marketplaceId, marketplace] of Object.entries(snapshot.resources.marketplaces)) {
    entries[`marketplace:${marketplaceId}`] = {
      id: marketplaceId,
      lastUpdatedAt: marketplace.lastUpdatedAt,
      resourceKind: "marketplace",
    };

    for (const plugin of marketplace.plugins) {
      entries[`marketplace:${marketplaceId}:plugin:${plugin.pluginId}`] = {
        id: plugin.pluginId,
        lastUpdatedAt: plugin.lastUpdatedAt,
        marketplaceId,
        resourceKind: "plugin",
      };

      for (const configItem of plugin.configItems) {
        entries[`marketplace:${marketplaceId}:plugin:${plugin.pluginId}:configItem:${configItem.configItemId}`] = {
          id: configItem.configItemId,
          lastUpdatedAt: configItem.lastUpdatedAt,
          marketplaceId,
          pluginId: plugin.pluginId,
          resourceKind: "configItem",
        };
      }
    }
  }

  return entries;
}

export function diffInstalledDesktopCloudResources(
  cloudImports: WorkspaceCloudImports,
  snapshot: DenResourceSnapshot,
  queuedAt = Date.now(),
): DesktopCloudSyncChange[] {
  const changes: DesktopCloudSyncChange[] = [];

  for (const provider of Object.values(cloudImports.providers)) {
    queueInstalledChange({
      changes,
      id: provider.cloudProviderId,
      installedLastUpdatedAt: provider.updatedAt,
      queuedAt,
      remoteLastUpdatedAt: snapshot.resources.llmProviders[provider.cloudProviderId] ?? null,
      resourceKind: "llmProvider",
    });
  }

  for (const marketplace of Object.values(cloudImports.marketplaces)) {
    queueInstalledChange({
      changes,
      id: marketplace.marketplaceId,
      installedLastUpdatedAt: marketplace.updatedAt,
      queuedAt,
      remoteLastUpdatedAt: snapshot.resources.marketplaces[marketplace.marketplaceId]?.lastUpdatedAt ?? null,
      resourceKind: "marketplace",
    });
  }

  for (const plugin of Object.values(cloudImports.plugins)) {
    const remote = findRemotePlugin(snapshot, {
      marketplaceId: plugin.marketplaceId,
      pluginId: plugin.pluginId,
    });
    queueInstalledChange({
      changes,
      id: plugin.pluginId,
      installedLastUpdatedAt: plugin.updatedAt,
      marketplaceId: remote?.marketplaceId ?? plugin.marketplaceId ?? undefined,
      queuedAt,
      remoteLastUpdatedAt: remote?.plugin.lastUpdatedAt ?? null,
      resourceKind: "plugin",
    });

    for (const file of plugin.files) {
      const remoteConfigItem = remote?.plugin.configItems.find((entry) => entry.configItemId === file.configObjectId) ?? null;
      queueInstalledChange({
        changes,
        id: file.configObjectId,
        installedLastUpdatedAt: file.updatedAt,
        marketplaceId: remote?.marketplaceId ?? plugin.marketplaceId ?? undefined,
        pluginId: plugin.pluginId,
        queuedAt,
        remoteLastUpdatedAt: remoteConfigItem?.lastUpdatedAt ?? null,
        resourceKind: "configItem",
      });
    }
  }

  return changes;
}

async function runDesktopCloudSyncRefresh(options?: {
  cloudImports?: WorkspaceCloudImports | null;
}): Promise<{
  cacheEntry: DesktopCloudSyncCacheEntry;
  changes: DesktopCloudSyncChange[];
} | null> {
  const settings = readDenSettings();
  const token = settings.authToken?.trim() ?? "";
  const activeOrgId = settings.activeOrgId?.trim() ?? "";
  if (!token || !activeOrgId) return null;

  const snapshot = await createDenClient({
    baseUrl: settings.baseUrl,
    apiBaseUrl: settings.apiBaseUrl,
    token,
  }).getResourceSnapshot(activeOrgId);
  const now = Date.now();
  const contextKey = resourceContextKey({
    apiBaseUrl: settings.apiBaseUrl,
    baseUrl: settings.baseUrl,
    organizationId: snapshot.organizationId,
    orgMemberId: snapshot.orgMemberId,
  });
  const store = await readPersistentCache();
  const previousEntry = store.entries[contextKey] ?? null;
  const changes = options?.cloudImports
    ? diffInstalledDesktopCloudResources(options.cloudImports, snapshot, now)
    : [];
  const cacheEntry: DesktopCloudSyncCacheEntry = {
    apiBaseUrl: settings.apiBaseUrl ?? null,
    baseUrl: settings.baseUrl,
    contextKey,
    fetchedAt: now,
    organizationId: snapshot.organizationId,
    orgMemberId: snapshot.orgMemberId,
    pendingChanges: mergePendingChanges(previousEntry?.pendingChanges ?? [], changes),
    snapshot,
    teamIds: snapshot.teamIds,
  };

  await writePersistentCache({
    entries: {
      ...store.entries,
      [contextKey]: cacheEntry,
    },
    updatedAt: now,
    version: CACHE_VERSION,
  });

  return { cacheEntry, changes };
}

export function refreshDesktopCloudSync(options?: {
  cloudImports?: WorkspaceCloudImports | null;
}): Promise<{
  cacheEntry: DesktopCloudSyncCacheEntry;
  changes: DesktopCloudSyncChange[];
} | null> {
  const run = desktopCloudSyncQueue.then(() => runDesktopCloudSyncRefresh(options));
  desktopCloudSyncQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function readDesktopCloudSyncState(): Promise<DesktopCloudSyncCacheStore> {
  return readPersistentCache();
}
