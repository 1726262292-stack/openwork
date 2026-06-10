import { MarketplacesScreen } from "../../_components/marketplaces-screen";

const DEFAULT_API_BASE = "https://api.openworklabs.com";

export default function MarketplacesPage() {
  const apiOrigin = (process.env.DEN_API_BASE ?? DEFAULT_API_BASE).trim().replace(/\/+$/, "");
  return <MarketplacesScreen mcpUrl={apiOrigin ? `${apiOrigin}/mcp` : null} />;
}
