import { expect } from "vitest";
import { test } from "@openwork/testkit";
import {
  connectionCanListMcpApps,
  mcpAppCatalogIsLoading,
} from "../../ee/apps/den-web/app/(den)/dashboard/_components/dashboard-mcp-app-catalog";

test("dashboard MCP Apps render progressively without probing unavailable connections", ({ evidence }) => {
  const availableAppsRenderWhileAnotherMcpLoads = !mcpAppCatalogIsLoading(1, true);
  const unavailableConnectionsAreSkipped = [
    connectionCanListMcpApps({ connectedForMe: false }),
    connectionCanListMcpApps({ connectedForMe: true, needsReconnect: true }),
    connectionCanListMcpApps({ connectedForMe: true, credentialHealth: "reconnect_required" }),
    connectionCanListMcpApps({ connectedForMe: true, setupRequired: true }),
  ].every((value) => value === false);

  expect(availableAppsRenderWhileAnotherMcpLoads).toBe(true);
  expect(unavailableConnectionsAreSkipped).toBe(true);
  evidence.recordAssertionEvidence(
    "Discovered MCP Apps render without waiting for unrelated MCP discovery",
    "one App is available while another MCP request remains pending",
    availableAppsRenderWhileAnotherMcpLoads,
  );
  evidence.recordAssertionEvidence(
    "Unavailable MCP connections are not probed for Apps",
    "disconnected, reconnect-required, unhealthy, and setup-required connections are excluded",
    unavailableConnectionsAreSkipped,
  );
});
