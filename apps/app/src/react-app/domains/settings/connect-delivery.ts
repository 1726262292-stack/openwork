export type MarketplaceDeliveryActionKind = "install" | "cloud_active" | "cloud_active_local_copy";

export function shouldShowExtensionsMarketplacePane(connectEnabled?: boolean) {
  return connectEnabled !== true;
}

export function resolveMarketplaceDeliveryAction(input: {
  connectEnabled?: boolean;
  importedLocally: boolean;
}): MarketplaceDeliveryActionKind {
  if (input.connectEnabled !== true) return "install";
  return input.importedLocally ? "cloud_active_local_copy" : "cloud_active";
}
