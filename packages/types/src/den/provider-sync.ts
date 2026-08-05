export const ORG_PROVIDER_SYNC_CAPABILITY = "orgProviderSync";

export const PROVIDER_SYNC_TOKEN_USE = "provider-sync";

export const PROVIDER_SYNC_TOKEN_AUDIENCE = "openwork-provider-sync";

export const PROVIDER_SYNC_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export type ProviderSyncTokenResponse = {
  token: string;
  expiresAt: string;
};

export type SyncedProviderModel = {
  modelId: string;
  name: string | null;
  modelConfig: Record<string, unknown> | null;
};

/**
 * Secret-bearing provider materialization payload. This contract is only for
 * Den-to-openwork-server requests and must never be exposed to a renderer.
 */
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
  env: string[];
  apiKey: string | null;
  apiKeys: Record<string, string> | null;
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
export const PROVIDER_SYNC_PROVIDERS_PATH = "/v1/provider-sync/providers";
