import { organizationHasCapability } from "../organization-capabilities.js"

type MetadataInput = Record<string, unknown> | string | null | undefined

/**
 * Native and imported MCP Apps require both an operator deployment opt-in and
 * an explicit per-organization opt-in. Either gate can fail the rollout closed.
 */
export function remoteMcpAppsEnabled(
  metadata: MetadataInput,
  options: { deploymentEnabled: boolean },
): boolean {
  return options.deploymentEnabled && organizationHasCapability(metadata, "remoteMcpApps")
}
