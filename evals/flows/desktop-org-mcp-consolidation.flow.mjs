import demo from "./desktop-org-mcp-demo.flow.mjs";

export default {
  ...demo,
  id: "desktop-org-mcp-consolidation",
  title: "Desktop app: member discovers and connects an org MCP connection through the Extensions Marketplace",
  // Alias of desktop-org-mcp-demo: keep it out of that flow's suite so the
  // journey does not run the same coverage twice.
  suite: undefined,
  suiteOrder: undefined,
};
