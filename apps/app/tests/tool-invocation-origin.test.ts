import { describe, expect, test } from "bun:test";

import { toolInvocationOrigin } from "../src/lib/tool-invocation-origin";

describe("toolInvocationOrigin", () => {
  test("parses direct MCP tool names with a known server prefix", () => {
    expect(
      toolInvocationOrigin("servicenow-direct_lookup_incident_records", undefined, [
        { name: "servicenow-direct" },
      ]),
    ).toEqual({
      connectionName: "ServiceNow Direct",
      displayTool: "lookup_incident_records",
    });
  });

  test("parses direct MCP tool names from their flat prefix when no server list is loaded", () => {
    expect(toolInvocationOrigin("servicenow_lookup_incident_records")).toEqual({
      connectionName: "ServiceNow",
      displayTool: "lookup_incident_records",
    });
  });

  test("parses OpenWork Cloud execute_capability MCP target names", () => {
    expect(
      toolInvocationOrigin("openwork-cloud_execute_capability", { name: "mcp:conn_123:lookup_incident_records" }, [
        { id: "conn_123", name: "ServiceNow Shared" },
      ]),
    ).toEqual({
      connectionName: "OpenWork Cloud → ServiceNow Shared",
      displayTool: "lookup_incident_records",
    });
  });

  test("includes the Cloud connection id when no connection name is known", () => {
    expect(
      toolInvocationOrigin("openwork-cloud_execute_capability", { name: "mcp:conn_456:lookup_records" }),
    ).toEqual({
      connectionName: "OpenWork Cloud → conn_456",
      displayTool: "lookup_records",
    });
  });

  test("leaves built-in tools without an origin badge", () => {
    const result = toolInvocationOrigin("bash", { command: "pwd" }, [{ name: "servicenow-direct" }]);
    expect(result.connectionName).toBeUndefined();
    expect(result.displayTool).toBe("bash");

    const envVarResult = toolInvocationOrigin("env_var_request", { key: "OPENAI_API_KEY" });
    expect(envVarResult.connectionName).toBeUndefined();
    expect(envVarResult.displayTool).toBe("env_var_request");
  });

  test("falls back to the direct Cloud tool when args are malformed", () => {
    expect(toolInvocationOrigin("openwork-cloud_execute_capability", { name: "not-an-mcp-capability" })).toEqual({
      connectionName: "OpenWork Cloud",
      displayTool: "execute_capability",
    });
    expect(toolInvocationOrigin("openwork-cloud_execute_capability", "bad args")).toEqual({
      connectionName: "OpenWork Cloud",
      displayTool: "execute_capability",
    });
  });
});
