import { organizationHasCapability } from "../organization-capabilities.js"

type MetadataInput = Record<string, unknown> | string | null | undefined

/**
 * Plugin-installed URL MCP Apps are a separate unit of value from native MCP
 * Apps served by regular connected MCP servers. They require their own
 * operator deployment opt-in (`DEN_PLUGIN_MCP_APPS_ENABLED`) and their own
 * per-organization opt-in (`pluginMcpApps`). Either gate failing closed keeps
 * installation, discovery, launch tools, and `ui://` resources absent while
 * stored records stay retained and inactive.
 *
 * This gate is intentionally independent from `remoteMcpAppsEnabled`, which
 * governs native MCP Apps from regular Connect servers.
 */
export function pluginInstalledMcpAppsEnabled(
  metadata: MetadataInput,
  options: { deploymentEnabled: boolean },
): boolean {
  return options.deploymentEnabled && organizationHasCapability(metadata, "pluginMcpApps")
}
