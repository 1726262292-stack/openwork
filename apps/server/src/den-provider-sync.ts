import {
  INFERENCE_TOKEN_TTL_SECONDS,
  PROVIDER_SYNC_INFERENCE_TOKEN_PATH,
  PROVIDER_SYNC_PROVIDERS_PATH,
  type InferenceTokenResponse,
  type SyncedProvider,
  type SyncedProvidersResponse,
} from "@openwork/types/den/provider-sync";
import { z } from "zod";

import { createEngineProviderAuthDelivery } from "./engine-provider-auth.js";
import { readActivatedEnterpriseDenOrigin } from "./enterprise-den-origin.js";
import { writeOpenworkRuntimeConfigFile } from "./openwork-runtime-config.js";
import {
  readProviderSyncState,
  updateProviderSyncState,
  type PersistedProviderSyncState,
} from "./provider-sync-state.js";
import {
  mergeRuntimeProviderUpdate,
  writeGlobalRuntimeOpencodeConfig,
} from "./runtime-opencode-config-store.js";
import { externalFetch } from "./server-fetch.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { findManagedEngineWorkspace } from "./workspaces.js";

const DEFAULT_PROVIDER_SYNC_INTERVAL_MS = 5_000;
const MIN_PROVIDER_SYNC_INTERVAL_MS = 1_000;
const INFERENCE_REFRESH_WINDOW_MS = Math.min(
  5 * 60_000,
  Math.floor(INFERENCE_TOKEN_TTL_SECONDS * 1_000 / 3),
);
const AUTHORIZATION_ERROR_PREFIX = "provider_sync_authorization_failed:";

type ProviderSyncEnv = Record<string, string | undefined>;
type ProviderSyncFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type DenProviderSyncLogger = {
  log: (level: "info" | "warn" | "error", message: string, attributes?: Record<string, unknown>) => void;
};

export type DenProviderSyncHandle = {
  stop: () => void;
  kick: () => Promise<void>;
};

export type StartDenProviderSyncInput = {
  config: ServerConfig;
  env?: ProviderSyncEnv;
  logger?: DenProviderSyncLogger;
  fetchImpl?: ProviderSyncFetch;
  engineFetchImpl?: ProviderSyncFetch;
  now?: () => number;
  readEnterpriseOrigin?: () => Promise<string | null>;
  reloadOpencodeEngine: (workspace: WorkspaceInfo) => Promise<void>;
};

const syncedProviderModelSchema = z.object({
  modelId: z.string().min(1),
  name: z.string().nullable(),
  modelConfig: z.record(z.string(), z.unknown()).nullable(),
}).strict();

const syncedProviderSchema = z.object({
  id: z.string().min(1),
  localProviderId: z.string().regex(/^lpr_[A-Za-z0-9_-]+$/),
  name: z.string().min(1),
  source: z.enum(["models_dev", "custom", "openwork"]),
  providerId: z.string().nullable(),
  updatedAt: z.string().min(1),
  baseUrl: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Provider base URL must not contain credentials"),
  npm: z.string().min(1),
  models: z.array(syncedProviderModelSchema),
}).strict();

const syncedProvidersResponseSchema = z.object({
  providers: z.array(syncedProviderSchema),
  etag: z.string().min(1),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  const localProviderIds = new Set<string>();
  for (const provider of value.providers) {
    if (ids.has(provider.id)) {
      context.addIssue({ code: "custom", message: `Duplicate provider id: ${provider.id}` });
    }
    if (localProviderIds.has(provider.localProviderId)) {
      context.addIssue({ code: "custom", message: `Duplicate local provider id: ${provider.localProviderId}` });
    }
    ids.add(provider.id);
    localProviderIds.add(provider.localProviderId);
  }
});

const inferenceTokenResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

function resolveIntervalMs(env: ProviderSyncEnv): number {
  const parsed = Number(env.OPENWORK_PROVIDER_SYNC_INTERVAL_MS?.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PROVIDER_SYNC_INTERVAL_MS;
  return Math.max(MIN_PROVIDER_SYNC_INTERVAL_MS, Math.round(parsed));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAuthorizationError(lastError: string | null): boolean {
  return lastError?.startsWith(AUTHORIZATION_ERROR_PREFIX) === true;
}

function isExpired(timestamp: string | null, now: number): boolean {
  if (!timestamp) return true;
  const expiresAt = Date.parse(timestamp);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function inferenceTokenNeedsRefresh(timestamp: string | null, now: number): boolean {
  if (!timestamp) return true;
  const expiresAt = Date.parse(timestamp);
  return !Number.isFinite(expiresAt) || expiresAt - now <= INFERENCE_REFRESH_WINDOW_MS;
}

async function allowedDenBaseUrl(
  denBaseUrl: string,
  readEnterpriseOrigin: () => Promise<string | null>,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(denBaseUrl);
  } catch {
    return null;
  }
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || (url.protocol !== "http:" && url.protocol !== "https:")
  ) return null;
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    return denBaseUrl.replace(/\/+$/, "");
  }
  if (
    url.protocol === "https:"
    && (url.origin === "https://app.openworklabs.com" || url.origin === "https://api.openworklabs.com")
  ) {
    return denBaseUrl.replace(/\/+$/, "");
  }
  const enterpriseOrigin = await readEnterpriseOrigin();
  return enterpriseOrigin === url.origin ? denBaseUrl.replace(/\/+$/, "") : null;
}

function providerEntry(provider: SyncedProvider): Record<string, unknown> {
  return {
    name: provider.name,
    npm: provider.npm,
    options: { baseURL: provider.baseUrl },
    models: Object.fromEntries(provider.models.map((model) => [
      model.modelId,
      { ...(model.name ? { name: model.name } : {}) },
    ])),
  };
}

function providerPatch(
  providers: SyncedProvider[],
  applied: PersistedProviderSyncState["applied"]["providers"],
): { patch: Record<string, unknown>; changed: boolean } {
  const patch: Record<string, unknown> = {};
  const currentIds = new Set<string>();
  for (const provider of providers) {
    currentIds.add(provider.localProviderId);
    const previous = applied[provider.localProviderId];
    if (previous?.denProviderId === provider.id && previous.updatedAt === provider.updatedAt) continue;
    patch[provider.localProviderId] = providerEntry(provider);
  }
  for (const localProviderId of Object.keys(applied)) {
    if (!currentIds.has(localProviderId)) patch[localProviderId] = null;
  }
  return { patch, changed: Object.keys(patch).length > 0 };
}

function appliedProviders(providers: SyncedProvider[]): PersistedProviderSyncState["applied"]["providers"] {
  return Object.fromEntries(providers.map((provider) => [
    provider.localProviderId,
    { denProviderId: provider.id, updatedAt: provider.updatedAt },
  ]));
}

function resolveEngineWorkspace(config: ServerConfig): WorkspaceInfo {
  const workspace = findManagedEngineWorkspace(config.workspaces) ?? config.workspaces[0];
  if (!workspace) throw new Error("provider_sync_workspace_missing");
  return workspace;
}

async function applyProviderPatch(
  input: StartDenProviderSyncInput,
  patch: Record<string, unknown>,
): Promise<void> {
  const workspace = resolveEngineWorkspace(input.config);
  const result = await writeGlobalRuntimeOpencodeConfig(input.config, (current) => ({
    ...current,
    provider: mergeRuntimeProviderUpdate(current.provider, patch),
  }));
  const fileResult = await writeOpenworkRuntimeConfigFile(input.config, workspace.id);
  if (result.changed || fileResult.changed) {
    await input.reloadOpencodeEngine(workspace);
  }
}

async function parseProvidersResponse(response: Response): Promise<SyncedProvidersResponse> {
  const parsed = syncedProvidersResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("provider_sync_invalid_providers_response");
  return parsed.data;
}

async function mintInferenceToken(
  fetchImpl: ProviderSyncFetch,
  denBaseUrl: string,
  providerSyncToken: string,
): Promise<InferenceTokenResponse> {
  const response = await fetchImpl(`${denBaseUrl}${PROVIDER_SYNC_INFERENCE_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${providerSyncToken}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${AUTHORIZATION_ERROR_PREFIX}${response.status}`);
  }
  if (!response.ok) throw new Error(`provider_sync_inference_token_failed:${response.status}`);
  const parsed = inferenceTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("provider_sync_invalid_inference_token_response");
  return parsed.data;
}

async function persistTickResult(input: {
  config: ServerConfig;
  expectedUpdatedAt: number;
  applied: PersistedProviderSyncState["applied"];
  lastSyncAt: string | null;
  lastError: string | null;
}): Promise<void> {
  await updateProviderSyncState(input.config, (current) => current.updatedAt === input.expectedUpdatedAt
    ? {
        ...current,
        applied: input.applied,
        lastSyncAt: input.lastSyncAt,
        lastError: input.lastError,
      }
    : current);
}

export function startDenProviderSync(input: StartDenProviderSyncInput): DenProviderSyncHandle {
  const fetchImpl = input.fetchImpl ?? externalFetch;
  const now = input.now ?? Date.now;
  const readEnterpriseOrigin = input.readEnterpriseOrigin ?? (() => readActivatedEnterpriseDenOrigin());
  const authDelivery = createEngineProviderAuthDelivery();
  let currentInferenceToken: string | null = null;
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const runTick = async (): Promise<void> => {
    const state = await readProviderSyncState(input.config);
    const tickNow = now();

    if (!state.enabled) {
      currentInferenceToken = null;
      const appliedIds = Object.keys(state.applied.providers);
      if (appliedIds.length > 0) {
        await applyProviderPatch(input, Object.fromEntries(appliedIds.map((id) => [id, null])));
      }
      const authResult = await authDelivery.sync({
        config: input.config,
        retainedProviderIds: new Set(),
        credentials: new Map(),
        fetchImpl: input.engineFetchImpl,
        logger: input.logger ? { error: (message, attributes) => input.logger?.log("error", message, attributes) } : undefined,
      });
      if (authResult.failed.length > 0) throw new Error("provider_sync_engine_auth_purge_failed");
      if (appliedIds.length === 0) return;
      await persistTickResult({
        config: input.config,
        expectedUpdatedAt: state.updatedAt,
        applied: { etag: null, providers: {}, inferenceTokenExpiresAt: null },
        lastSyncAt: new Date(tickNow).toISOString(),
        lastError: null,
      });
      return;
    }

    if (state.token === null) return;
    if (isExpired(state.tokenExpiresAt, tickNow) || isAuthorizationError(state.lastError)) return;
    if (!state.denBaseUrl || !state.orgId) return;
    const denBaseUrl = await allowedDenBaseUrl(state.denBaseUrl, readEnterpriseOrigin);
    if (!denBaseUrl) {
      await persistTickResult({
        config: input.config,
        expectedUpdatedAt: state.updatedAt,
        applied: state.applied,
        lastSyncAt: state.lastSyncAt,
        lastError: "provider_sync_den_origin_not_allowed",
      });
      return;
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${state.token}`,
    };
    if (state.applied.etag) headers["If-None-Match"] = state.applied.etag;
    const response = await fetchImpl(`${denBaseUrl}${PROVIDER_SYNC_PROVIDERS_PATH}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) {
      await persistTickResult({
        config: input.config,
        expectedUpdatedAt: state.updatedAt,
        applied: state.applied,
        lastSyncAt: state.lastSyncAt,
        lastError: `${AUTHORIZATION_ERROR_PREFIX}${response.status}`,
      });
      return;
    }
    if (response.status !== 304 && !response.ok) {
      throw new Error(`provider_sync_providers_failed:${response.status}`);
    }

    let nextApplied = state.applied;
    let providersChanged = false;
    let pendingProviderPatch: Record<string, unknown> | null = null;
    if (response.status !== 304) {
      const payload = await parseProvidersResponse(response);
      const diff = providerPatch(payload.providers, state.applied.providers);
      providersChanged = diff.changed;
      if (providersChanged) pendingProviderPatch = diff.patch;
      nextApplied = {
        ...nextApplied,
        etag: payload.etag,
        providers: appliedProviders(payload.providers),
      };
    }

    const currentProviderIds = Object.keys(nextApplied.providers);
    const shouldRefreshInferenceToken = currentProviderIds.length > 0
      && (
        !currentInferenceToken
        || providersChanged
        || inferenceTokenNeedsRefresh(nextApplied.inferenceTokenExpiresAt, tickNow)
      );
    if (shouldRefreshInferenceToken) {
      const inference = await mintInferenceToken(fetchImpl, denBaseUrl, state.token);
      currentInferenceToken = inference.token;
      nextApplied = { ...nextApplied, inferenceTokenExpiresAt: inference.expiresAt };
    }
    if (currentInferenceToken || providersChanged) {
      const credentials = new Map<string, string>();
      if (currentInferenceToken) {
        for (const providerId of currentProviderIds) {
          credentials.set(providerId, currentInferenceToken);
        }
      }
      const authResult = await authDelivery.sync({
        config: input.config,
        retainedProviderIds: new Set(currentProviderIds),
        credentials,
        force: true,
        fetchImpl: input.engineFetchImpl,
        logger: input.logger ? { error: (message, attributes) => input.logger?.log("error", message, attributes) } : undefined,
      });
      if (authResult.failed.length > 0) throw new Error("provider_sync_engine_auth_delivery_failed");
    }
    if (pendingProviderPatch) await applyProviderPatch(input, pendingProviderPatch);

    await persistTickResult({
      config: input.config,
      expectedUpdatedAt: state.updatedAt,
      applied: nextApplied,
      lastSyncAt: new Date(tickNow).toISOString(),
      lastError: null,
    });
  };

  const kick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    const operation = runTick()
      .catch(async (error) => {
        const state = await readProviderSyncState(input.config);
        const message = errorMessage(error);
        await persistTickResult({
          config: input.config,
          expectedUpdatedAt: state.updatedAt,
          applied: state.applied,
          lastSyncAt: state.lastSyncAt,
          lastError: message,
        });
        input.logger?.log("warn", "Den provider sync tick failed", { error: message });
      })
      .finally(() => {
        if (inFlight === operation) inFlight = null;
      });
    inFlight = operation;
    return operation;
  };

  void kick();
  const interval = setInterval(() => void kick(), resolveIntervalMs(input.env ?? process.env));
  return {
    kick,
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}
