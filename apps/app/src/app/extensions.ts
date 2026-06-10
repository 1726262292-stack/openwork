import type {
  EnablementCondition,
  OpenWorkExtensionContribution,
  OpenWorkExtensionContributionType,
  OpenWorkExtensionManifest,
  OpenWorkExtensionResource,
  OpenWorkExtensionResourceType,
} from "@openwork/types/extension-manifest";

export type {
  EnablementCondition,
  EnablementConditionType,
  OpenWorkExtensionContribution,
  OpenWorkExtensionContributionType,
  OpenWorkExtensionLifecycle,
  OpenWorkExtensionManifest,
  OpenWorkExtensionResource,
  OpenWorkExtensionResourceType,
  OpenWorkExtensionSetup,
  OpenWorkExtensionSource,
  OpenWorkExtensionSourceFormat,
} from "@openwork/types/extension-manifest";

export { BUILT_IN_OPENWORK_EXTENSION_MANIFESTS } from "@openwork/types/extension-manifest-builtins";

/** Result of evaluating a single enablement condition at runtime. */
export type EnablementResult = {
  condition: EnablementCondition;
  met: boolean;
};

export function extensionContribution(
  manifest: OpenWorkExtensionManifest | undefined,
  type: OpenWorkExtensionContributionType,
): OpenWorkExtensionContribution | undefined {
  return manifest?.contributions?.find((contribution) => contribution.type === type);
}

export function extensionResource(
  manifest: OpenWorkExtensionManifest | undefined,
  type: OpenWorkExtensionResourceType,
): OpenWorkExtensionResource | undefined {
  return manifest?.resources.find((resource) => resource.type === type);
}

export function isTrustedBuiltInExtension(manifest: OpenWorkExtensionManifest | undefined): boolean {
  return manifest?.source.origin === "builtin" && manifest.source.trusted;
}
