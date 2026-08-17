import { PluginMcpAppInstallScreen } from "../../../../../_components/plugin-mcp-app-install-screen";

export default async function NewPluginMcpAppPage({
  params,
}: {
  params: Promise<{ pluginId: string }>;
}) {
  const { pluginId } = await params;
  return <PluginMcpAppInstallScreen pluginId={pluginId} />;
}
