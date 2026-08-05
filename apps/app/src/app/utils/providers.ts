import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import { isCloudManagedProviderKey } from "../../react-app/domains/connections/provider-auth/cloud-provider-config";

const PINNED_PROVIDER_ORDER = ["opencode", "openai", "anthropic"] as const;

export const providerPriorityRank = (id: string) => {
  const normalized = id.trim().toLowerCase();
  const index = PINNED_PROVIDER_ORDER.indexOf(
    normalized as (typeof PINNED_PROVIDER_ORDER)[number],
  );
  return index === -1 ? PINNED_PROVIDER_ORDER.length : index;
};

export const compareProviders = (
  a: { id: string; name?: string },
  b: { id: string; name?: string },
) => {
  const rankDiff = providerPriorityRank(a.id) - providerPriorityRank(b.id);
  if (rankDiff !== 0) return rankDiff;

  const aName = (a.name ?? a.id).trim();
  const bName = (b.name ?? b.id).trim();
  return aName.localeCompare(bName);
};

function providerTier(id: string, hasOnlyManagedFallback: boolean) {
  const normalized = id.trim().toLowerCase();
  if (hasOnlyManagedFallback && normalized === "openwork") return 0;
  if (normalized === "openwork") return 2;
  if (isCloudManagedProviderKey(normalized)) return 0;
  if (normalized !== "opencode") return 1;
  return 3;
}

/** Organization-shared, local/custom, OpenWork Models, then built-in fallback. */
export const compareProviderTiers = (
  a: { id: string; name?: string },
  b: { id: string; name?: string },
  options: { hasOnlyManagedFallback: boolean },
) => {
  const tierDiff = providerTier(a.id, options.hasOnlyManagedFallback) -
    providerTier(b.id, options.hasOnlyManagedFallback);
  if (tierDiff !== 0) return tierDiff;
  return (a.name ?? a.id).trim().localeCompare((b.name ?? b.id).trim());
};

export const filterProviderList = (
  value: ProviderListResponse,
  disabledProviders: string[],
): ProviderListResponse => {
  const disabled = new Set(disabledProviders.flatMap((id) => {
    const trimmed = id.trim();
    return trimmed ? [trimmed] : [];
  }));
  if (!disabled.size) return value;
  return {
    all: value.all.filter((provider) => !disabled.has(provider.id)),
    connected: value.connected.filter((id) => !disabled.has(id)),
    default: Object.fromEntries(
      Object.entries(value.default).filter(([id]) => !disabled.has(id)),
    ),
  };
};
