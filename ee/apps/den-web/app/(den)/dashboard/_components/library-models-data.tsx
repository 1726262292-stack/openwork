"use client";

import { INFERENCE_MODEL_ALIASES } from "@openwork/types/den/inference";
import {
  type DenLlmProvider,
  type DenLlmProviderSource,
  getProviderDocUrl,
  getProviderIconSlug,
  useOrgLlmProviders,
} from "./llm-provider-data";

/** Bundled so a blocked icon CDN never leaves the OpenWork tiles as a monogram. */
const OPENWORK_ICON_URL = "/openwork-mark.svg";
const OPENWORK_DISPLAY_PREFIX = "OpenWork: ";

export type LibraryModelTile = {
  /** Stable key: one provider can contribute many tiles. */
  key: string;
  /** Overlaid on the provider icon. */
  label: string;
  providerName: string;
  source: DenLlmProviderSource;
  iconUrl?: string;
  simpleIconSlug?: string;
  serviceUrl: string | null;
};

/**
 * OpenWork Inference never materialises model rows, so the lineup comes from the
 * shared alias table the inference proxy actually serves. The card names models,
 * not the provider, so the shared "OpenWork: " prefix is redundant here.
 */
const OPENWORK_MODELS = Object.entries(INFERENCE_MODEL_ALIASES)
  .filter(([, alias]) => alias.enabled)
  .map(([aliasId, alias]) => ({
    aliasId,
    label: alias.displayName.startsWith(OPENWORK_DISPLAY_PREFIX)
      ? alias.displayName.slice(OPENWORK_DISPLAY_PREFIX.length)
      : alias.displayName,
  }));

export const OPENWORK_MODEL_LABELS: readonly string[] = OPENWORK_MODELS.map((model) => model.label);

function openWorkTiles(provider: DenLlmProvider): LibraryModelTile[] {
  return OPENWORK_MODELS.map((model) => ({
    key: `${provider.id}:${model.aliasId}`,
    label: model.label,
    providerName: provider.name,
    source: provider.source,
    iconUrl: OPENWORK_ICON_URL,
    serviceUrl: null,
  }));
}

function providerTiles(provider: DenLlmProvider): LibraryModelTile[] {
  if (provider.source === "openwork") return openWorkTiles(provider);

  const simpleIconSlug = getProviderIconSlug(provider.providerId);
  const serviceUrl = getProviderDocUrl(provider.providerConfig);

  // A custom provider is opaque — its configured name is the only honest label.
  if (provider.source === "custom") {
    return [{
      key: provider.id,
      label: provider.name,
      providerName: provider.name,
      source: provider.source,
      simpleIconSlug,
      serviceUrl,
    }];
  }

  // Listed providers carry an explicit model allowlist, so each enabled model
  // earns its own tile. There is no "all models" state to represent.
  return provider.models.map((model) => ({
    key: `${provider.id}:${model.id}`,
    label: model.name,
    providerName: provider.name,
    source: provider.source,
    simpleIconSlug,
    serviceUrl,
  }));
}

/** OpenWork's own models lead; everything else keeps the order the API returned. */
export function buildLibraryModelTiles(providers: DenLlmProvider[]): LibraryModelTile[] {
  const openWork = providers.filter((provider) => provider.source === "openwork");
  const rest = providers.filter((provider) => provider.source !== "openwork");
  return [...openWork, ...rest].flatMap(providerTiles);
}

export function useLibraryModels(orgId: string | null) {
  const { llmProviders, busy, error } = useOrgLlmProviders(orgId, { scope: "usable" });
  return {
    tiles: buildLibraryModelTiles(llmProviders),
    isLoading: busy,
    error,
  };
}
