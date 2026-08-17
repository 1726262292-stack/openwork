import { PluginMcpAppDetailScreen } from "../../../../../_components/plugin-mcp-app-detail-screen";

export default async function PluginMcpAppPage({
  params,
}: {
  params: Promise<{ pluginId: string; appId: string }>;
}) {
  const { pluginId, appId } = await params;
  return <PluginMcpAppDetailScreen pluginId={pluginId} appId={appId} />;
}
