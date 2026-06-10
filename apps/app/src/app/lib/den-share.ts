import type { McpServerConfig } from "../types";
import { createDenClient, readDenSettings } from "./den";

/**
 * Strip secret values from an MCP config before publishing: environment
 * variable KEYS are kept so teammates know what to provide, but values are
 * replaced with empty strings.
 */
export function sanitizeMcpConfigForSharing(config: McpServerConfig): McpServerConfig {
  const environment = config.environment;
  if (!environment || Object.keys(environment).length === 0) return config;
  return {
    ...config,
    environment: Object.fromEntries(Object.keys(environment).map((key) => [key, ""])),
  };
}

/**
 * Publish a locally configured MCP server to the org's Den cloud as a plugin
 * (bundle) with one "mcp" config object, then add the plugin to a marketplace
 * so teammates can install it from the Marketplace tab.
 *
 * The normalized payload uses `{ mcp: { [mcpName]: config } }`, which is the
 * shape the cloud plugin install path reads back (pluginMcpConfigsFromPayload
 * in apps/server/src/cloud-plugins.ts and extensions-store).
 *
 * v1 has no rollback: if a later step fails, earlier resources (config object,
 * plugin) remain in the org and can be cleaned up from the cloud dashboard.
 */
export async function shareMcpServerToOrg(input: {
  name: string;
  description?: string | null;
  mcpName: string;
  mcpConfig: McpServerConfig;
  marketplaceId: string;
}): Promise<{ pluginId: string; orgName: string }> {
  const settings = readDenSettings();
  const token = settings.authToken?.trim() ?? "";
  const orgId = settings.activeOrgId?.trim() ?? "";
  if (!token || !orgId) {
    throw new Error("Sign in to OpenWork Cloud in Settings to share with your team.");
  }
  const orgName = settings.activeOrgName?.trim() || "your organization";

  const client = createDenClient({ baseUrl: settings.baseUrl, apiBaseUrl: settings.apiBaseUrl, token });
  const name = input.name.trim() || input.mcpName;
  const description = input.description?.trim() ?? "";
  const sanitizedConfig = sanitizeMcpConfigForSharing(input.mcpConfig);

  const configObject = await client.createOrgConfigObject(orgId, {
    type: "mcp",
    sourceMode: "cloud",
    input: {
      normalizedPayloadJson: {
        name,
        ...(description ? { description } : {}),
        mcp: { [input.mcpName]: sanitizedConfig },
      },
      metadata: {
        name,
        ...(description ? { description } : {}),
      },
    },
  });

  const plugin = await client.createOrgPlugin(orgId, {
    name,
    description: description || null,
  });

  try {
    await client.addConfigObjectToPlugin(orgId, plugin.id, configObject.id);
    await client.addPluginToMarketplace(orgId, input.marketplaceId, plugin.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`The extension was created but publishing did not finish: ${message}`);
  }

  return { pluginId: plugin.id, orgName };
}
