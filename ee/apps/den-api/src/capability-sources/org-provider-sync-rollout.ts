/**
 * Rollout gate for organization provider sync.
 *
 * Provider sync is default-off for every organization. Platform admins can
 * explicitly enable it with `metadata.capabilities.orgProviderSync: true`.
 * DEN_ORG_PROVIDER_SYNC_DEFAULT=1 changes only the fallback for organizations
 * without an explicit boolean override.
 */

type MetadataInput = Record<string, unknown> | string | null | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseMetadata(input: MetadataInput): Record<string, unknown> {
  if (!input) {
    return {}
  }

  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input)
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  return isRecord(input) ? input : {}
}

export function organizationOrgProviderSyncEnabled(
  metadata: MetadataInput,
  options: { defaultEnabled: boolean },
): boolean {
  const parsed = parseMetadata(metadata)
  const capabilities = isRecord(parsed.capabilities) ? parsed.capabilities : {}

  if (capabilities.orgProviderSync === true) {
    return true
  }
  if (capabilities.orgProviderSync === false) {
    return false
  }
  return options.defaultEnabled
}
