import { createEngineProviderAuthDelivery } from "./engine-provider-auth.js";
import { readGlobalRuntimeOpencodeConfig, runtimeProviderMap } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

/**
 * Deliver server-managed provider credentials to the engine.
 *
 * Cloud provider materialization writes two things: the provider entry into the
 * engine-global runtime config (which only *names* its credential env vars via
 * `env: [...]`), and the credential value into this server's env store. Nothing
 * bridged the two: the engine process is spawned with a fixed env allowlist and
 * never receives store values, so every run failed with "API key is missing"
 * while the provider still appeared in the picker.
 *
 * The desktop app has always delivered credentials by calling the engine's auth
 * API directly. This module does the same thing server-side, so cloud
 * credentials never need to reach a browser.
 */

type ManagedProviderAuthLogger = {
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

type EnvReader = { list: () => Promise<Array<{ key: string; value: string }>> };

export type ManagedProviderAuthInput = {
  config: ServerConfig;
  env: EnvReader;
  fetchImpl?: typeof globalThis.fetch;
  logger?: ManagedProviderAuthLogger;
};

export type ManagedProviderAuthResult = {
  delivered: string[];
  unchanged: string[];
  removed: string[];
  skipped: Array<{ providerId: string; reason: "no_env_names" | "no_stored_credential" }>;
  failed: Array<{ providerId: string; status: number | null }>;
};

const managedProviderAuthDelivery = createEngineProviderAuthDelivery();

function readEnvNames(entry: Record<string, unknown>): string[] {
  if (!Array.isArray(entry.env)) return [];
  return entry.env.filter((name): name is string => typeof name === "string" && name.trim().length > 0);
}

/**
 * Forget what we believe the engine holds. Call this when the engine process is
 * replaced: opencode persists auth outside the process, but a fresh engine may
 * have been started against a different store, and re-delivery is cheap.
 */
export function resetManagedProviderAuthCache(): void {
  managedProviderAuthDelivery.reset();
}

export async function syncManagedProviderAuth(input: ManagedProviderAuthInput): Promise<ManagedProviderAuthResult> {
  const result: ManagedProviderAuthResult = {
    delivered: [],
    unchanged: [],
    removed: [],
    skipped: [],
    failed: [],
  };

  const runtimeConfig = await readGlobalRuntimeOpencodeConfig(input.config);
  const providers = runtimeProviderMap(runtimeConfig);

  const storedValues = new Map<string, string>();
  for (const record of await input.env.list()) {
    if (typeof record.value === "string" && record.value.trim().length > 0) {
      storedValues.set(record.key, record.value);
    }
  }

  const managedIds = new Set(Object.keys(providers));
  const credentials = new Map<string, string>();

  for (const [providerId, entry] of Object.entries(providers)) {
    const envNames = readEnvNames(entry);
    if (envNames.length === 0) {
      result.skipped.push({ providerId, reason: "no_env_names" });
      continue;
    }

    const credentialName = envNames.find((name) => storedValues.has(name));
    if (!credentialName) {
      result.skipped.push({ providerId, reason: "no_stored_credential" });
      input.logger?.warn("managed provider credential missing from env store", {
        provider_id: providerId,
        env_names: envNames,
      });
      continue;
    }

    credentials.set(providerId, storedValues.get(credentialName) ?? "");
  }

  const authResult = await managedProviderAuthDelivery.sync({
    config: input.config,
    retainedProviderIds: managedIds,
    credentials,
    fetchImpl: input.fetchImpl,
    logger: input.logger,
  });
  result.delivered.push(...authResult.delivered);
  result.unchanged.push(...authResult.unchanged);
  result.removed.push(...authResult.removed);
  result.failed.push(...authResult.failed
    .filter((failure) => failure.operation === "put")
    .map(({ providerId, status }) => ({ providerId, status })));

  return result;
}
