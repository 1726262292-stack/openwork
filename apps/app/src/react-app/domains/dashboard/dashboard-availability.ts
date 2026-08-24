export const MCP_APPS_DASHBOARD_FLAG_KEY = "openwork.mcpAppsDashboard";

/**
 * Local opt-in flag for the MCP Apps dashboard. The dashboard, its sidebar
 * entry, and its route stay hidden unless this flag is explicitly enabled,
 * mirroring the `openwork.developerMode` local-flag pattern.
 */
export function isMcpAppsDashboardEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MCP_APPS_DASHBOARD_FLAG_KEY) === "1";
}
