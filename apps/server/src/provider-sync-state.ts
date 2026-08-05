import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderSyncServerState } from "@openwork/types/den/provider-sync";
import { z } from "zod";

import { readBoundedRegularTextFile } from "./jsonc.js";
import { runtimeStorageDir } from "./runtime-db.js";
import type { ServerConfig } from "./types.js";

const PROVIDER_SYNC_STATE_FILE = "provider-sync-state.json";
const PROVIDER_SYNC_STATE_MAX_BYTES = 128 * 1024;

const nullableTimestampSchema = z.string().datetime({ offset: true }).nullable();

export const providerSyncServerStateSchema = z.object({
  enabled: z.boolean(),
  token: z.string().trim().min(1).max(64 * 1024).nullable(),
  expiresAt: nullableTimestampSchema,
  denBaseUrl: z.string().trim().url().max(2 * 1024).nullable(),
  orgId: z.string().trim().min(1).max(512).nullable(),
}).strict();

const appliedProviderSchema = z.object({
  denProviderId: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict();

const localProviderIdSchema = z.string().regex(/^lpr_[A-Za-z0-9_-]+$/);

const appliedStateSchema = z.object({
  etag: z.string().nullable(),
  providers: z.record(localProviderIdSchema, appliedProviderSchema),
  inferenceTokenExpiresAt: nullableTimestampSchema,
}).strict();

const persistedProviderSyncStateSchema = z.object({
  enabled: z.boolean(),
  token: z.string().min(1).nullable(),
  tokenExpiresAt: nullableTimestampSchema,
  denBaseUrl: z.string().url().nullable(),
  orgId: z.string().min(1).nullable(),
  updatedAt: z.number().finite().nonnegative(),
  applied: appliedStateSchema,
  lastSyncAt: nullableTimestampSchema,
  lastError: z.string().max(4 * 1024).nullable(),
}).strict();

export type PersistedProviderSyncState = z.infer<typeof persistedProviderSyncStateSchema>;
export type ProviderSyncStateInspectionStatus = "available" | "missing" | "invalid" | "unreadable";
export type ProviderSyncStateInspection = {
  status: ProviderSyncStateInspectionStatus;
  state: PersistedProviderSyncState;
};

export type ProviderSyncStatus = {
  enabled: boolean;
  hasToken: boolean;
  tokenExpiresAt: string | null;
  orgId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  appliedProviderIds: string[];
};

function defaultProviderSyncState(): PersistedProviderSyncState {
  return {
    enabled: false,
    token: null,
    tokenExpiresAt: null,
    denBaseUrl: null,
    orgId: null,
    updatedAt: 0,
    applied: {
      etag: null,
      providers: {},
      inferenceTokenExpiresAt: null,
    },
    lastSyncAt: null,
    lastError: null,
  };
}

function providerSyncStatePath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), PROVIDER_SYNC_STATE_FILE);
}

export function parseProviderSyncServerState(value: unknown): ProviderSyncServerState | null {
  const parsed = providerSyncServerStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function inspectProviderSyncState(config: ServerConfig): Promise<ProviderSyncStateInspection> {
  try {
    const raw = await readBoundedRegularTextFile(providerSyncStatePath(config), {
      maxBytes: PROVIDER_SYNC_STATE_MAX_BYTES,
    });
    const parsed = persistedProviderSyncStateSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { status: "available", state: parsed.data }
      : { status: "invalid", state: defaultProviderSyncState() };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { status: "missing", state: defaultProviderSyncState() };
    }
    if (error instanceof SyntaxError) {
      return { status: "invalid", state: defaultProviderSyncState() };
    }
    return { status: "unreadable", state: defaultProviderSyncState() };
  }
}

export async function readProviderSyncState(config: ServerConfig): Promise<PersistedProviderSyncState> {
  return (await inspectProviderSyncState(config)).state;
}

async function persistProviderSyncState(
  config: ServerConfig,
  state: PersistedProviderSyncState,
): Promise<PersistedProviderSyncState> {
  const parsed = persistedProviderSyncStateSchema.parse(state);
  const target = providerSyncStatePath(config);
  await mkdir(runtimeStorageDir(config), { recursive: true, mode: 0o700 });
  await writeFile(target, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (process.platform !== "win32") await chmod(target, 0o600);
  return parsed;
}

const mutationQueues = new WeakMap<ServerConfig, Promise<void>>();

export async function updateProviderSyncState(
  config: ServerConfig,
  update: (current: PersistedProviderSyncState) => PersistedProviderSyncState,
): Promise<PersistedProviderSyncState> {
  const previous = mutationQueues.get(config) ?? Promise.resolve();
  let result = defaultProviderSyncState();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      result = await persistProviderSyncState(config, update(await readProviderSyncState(config)));
    });
  mutationQueues.set(config, operation);
  await operation;
  if (mutationQueues.get(config) === operation) mutationQueues.delete(config);
  return result;
}

export async function writeProviderSyncState(
  config: ServerConfig,
  next: ProviderSyncServerState,
): Promise<PersistedProviderSyncState> {
  return updateProviderSyncState(config, (current) => {
    const targetChanged = current.denBaseUrl !== next.denBaseUrl || current.orgId !== next.orgId;
    return {
      ...current,
      enabled: next.enabled,
      token: next.token,
      tokenExpiresAt: next.expiresAt,
      denBaseUrl: next.denBaseUrl,
      orgId: next.orgId,
      updatedAt: Date.now(),
      applied: targetChanged
        ? { ...current.applied, etag: null, inferenceTokenExpiresAt: null }
        : current.applied,
      lastError: null,
    };
  });
}

export async function readProviderSyncStatus(config: ServerConfig): Promise<ProviderSyncStatus> {
  const state = await readProviderSyncState(config);
  return {
    enabled: state.enabled,
    hasToken: state.token !== null,
    tokenExpiresAt: state.tokenExpiresAt,
    orgId: state.orgId,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError,
    appliedProviderIds: Object.keys(state.applied.providers).sort(),
  };
}
