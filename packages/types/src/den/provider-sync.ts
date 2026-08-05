export const ORG_PROVIDER_SYNC_CAPABILITY = "orgProviderSync";

export const PROVIDER_SYNC_TOKEN_USE = "provider-sync";
export const INFERENCE_TOKEN_USE = "inference";

export const PROVIDER_SYNC_TOKEN_AUDIENCE = "openwork-provider-sync";
export const INFERENCE_TOKEN_AUDIENCE = "openwork-inference";

export const PROVIDER_SYNC_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const INFERENCE_TOKEN_TTL_SECONDS = 15 * 60;

export type ProviderSyncTokenResponse = {
  token: string;
  expiresAt: string;
};

export type InferenceTokenResponse = {
  token: string;
  expiresAt: string;
};

export type SyncedProviderModel = {
  modelId: string;
  name: string | null;
  modelConfig: Record<string, unknown> | null;
};

export type SyncedProvider = {
  id: string;
  /**
   * The Den provider id verbatim. It is already `lpr_`-prefixed and is the
   * opencode provider key used by the desktop. This must stay consistent with
   * `getCloudManagedProviderId` so synced and manually imported providers
   * collapse to the same key.
   */
  localProviderId: string;
  name: string;
  source: "models_dev" | "custom" | "openwork";
  providerId: string | null;
  updatedAt: string;
  baseUrl: string;
  npm: string;
  models: SyncedProviderModel[];
};

export type SyncedProvidersResponse = {
  providers: SyncedProvider[];
  etag: string;
};

export type ProviderSyncServerState = {
  enabled: boolean;
  token: string | null;
  expiresAt: string | null;
  denBaseUrl: string | null;
  orgId: string | null;
};

export const PROVIDER_SYNC_TOKEN_PATH = "/v1/provider-sync/token";
export const PROVIDER_SYNC_INFERENCE_TOKEN_PATH =
  "/v1/provider-sync/inference-token";
export const PROVIDER_SYNC_PROVIDERS_PATH = "/v1/provider-sync/providers";
export const INFERENCE_BYO_PATH_PREFIX = "/api/v1/byo";
