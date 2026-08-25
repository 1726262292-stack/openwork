import { describe, expect, test } from "bun:test";
import {
  filterConnectionsWithMcpApps,
  flattenConnectionMcpAppCatalog,
  type ConnectionMcpApp,
} from "../app/(den)/dashboard/_components/org-dashboards-data";

const app: ConnectionMcpApp = {
  serverName: "reports",
  connectionId: "connection_reports",
  toolName: "render_report",
  projectedToolName: "reports_render_report",
  resourceUri: "ui://reports/view.html",
  title: "Weekly report",
  description: "Shows the weekly report",
  requiresInput: false,
  requiresApproval: false,
};

describe("dashboard MCP App catalog", () => {
  test("flattens apps and omits connections that do not expose MCP Apps", () => {
    expect(flattenConnectionMcpAppCatalog(
      [
        { id: "connection_tools", name: "Tools only" },
        { id: "connection_reports", name: "Reports" },
      ],
      [[], [app]],
    )).toEqual([{ ...app, connectionName: "Reports" }]);

    expect(filterConnectionsWithMcpApps(
      [
        { id: "connection_tools", name: "Tools only" },
        { id: "connection_reports", name: "Reports" },
      ],
      [app],
    )).toEqual([{ id: "connection_reports", name: "Reports" }]);
  });
});
