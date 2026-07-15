import { describe, expect, test } from "bun:test";

import {
  getConnectionStatusFromToolPart,
  isCloudCapabilityToolName,
  parseConnectionStatusPayload,
} from "../src/react-app/domains/connections/connection-status-payload";

/** Field-shaped fixture: a real search_capabilities result for a connector
 * whose OAuth refresh was rejected (actor assigned to the provider admin). */
const providerAdminSearchResult = {
  matches: [
    {
      name: "mcp:emc_01xxxxxxxxxxxxxxxxxxxxxxxx:*",
      method: "MCP",
      score: 7,
      summary: "[Granola] This connection is set up but returned an error.",
      kind: "connection_status",
      status: "error",
      connectionStatus: {
        layer: "mcp_connection",
        connectionId: "emc_01xxxxxxxxxxxxxxxxxxxxxxxx",
        connectionName: "Granola",
        authType: "oauth",
        credentialMode: "per_member",
        state: "reauth_required",
        errorCode: "unauthorized",
        message: "The authorization server rejected the code or token refresh exchange.",
        actor: "provider_admin",
        action: {
          type: "fix_provider",
          surface: "provider_admin_console",
          label: "Inspect provider and proxy logs for the failing HTTP request.",
          retry: "search_capabilities",
        },
        diagnostic: {
          referenceId: "a0b58150-7bad-4a37-ba36-c4260f444a8d",
          category: "http_failure",
          code: "MCP_HTTP_400",
        },
      },
    },
    { name: "getMe", method: "GET", path: "/v1/me", score: 3 },
  ],
};

const memberReconnectResult = {
  matches: [
    {
      kind: "connection_status",
      status: "error",
      connectionStatus: {
        connectionId: "emc_01yyyyyyyyyyyyyyyyyyyyyyyy",
        connectionName: "Slack",
        credentialMode: "per_member",
        state: "reauth_required",
        errorCode: "unauthorized",
        message: "Your Slack sign-in expired.",
        actor: "member",
      },
    },
  ],
};

const healthySearchResult = {
  matches: [
    { name: "getCapabilitiesGoogleWorkspaceGmailMessages", method: "GET", score: 16 },
  ],
};

describe("parseConnectionStatusPayload", () => {
  test("extracts a provider_admin failure from a search result and disables self-serve reconnect", () => {
    const payload = parseConnectionStatusPayload(providerAdminSearchResult);
    expect(payload).not.toBeNull();
    expect(payload?.connectionName).toBe("Granola");
    expect(payload?.state).toBe("reauth_required");
    expect(payload?.credentialMode).toBe("per_member");
    expect(payload?.actor).toBe("provider_admin");
    expect(payload?.actionLabel).toBe("Inspect provider and proxy logs for the failing HTTP request.");
    expect(payload?.diagnosticReferenceId).toBe("a0b58150-7bad-4a37-ba36-c4260f444a8d");
    expect(payload?.canReconnect).toBe(false);
  });

  test("offers reconnect for member-actionable per-member reauth", () => {
    const payload = parseConnectionStatusPayload(memberReconnectResult);
    expect(payload?.connectionName).toBe("Slack");
    expect(payload?.canReconnect).toBe(true);
  });

  test("parses string tool output (MCP text content)", () => {
    const payload = parseConnectionStatusPayload(JSON.stringify(providerAdminSearchResult));
    expect(payload?.connectionName).toBe("Granola");
  });

  test("parses a top-level connectionStatus object (execute_capability shape)", () => {
    const payload = parseConnectionStatusPayload({
      error: "connection_unavailable",
      connectionStatus: {
        connectionName: "Notion",
        credentialMode: "per_member",
        state: "reauth_required",
      },
    });
    expect(payload?.connectionName).toBe("Notion");
    expect(payload?.canReconnect).toBe(true);
  });

  test("returns null for healthy results, healthy states, and non-JSON text", () => {
    expect(parseConnectionStatusPayload(healthySearchResult)).toBeNull();
    expect(
      parseConnectionStatusPayload({
        connectionStatus: { connectionName: "Slack", state: "connected" },
      }),
    ).toBeNull();
    expect(parseConnectionStatusPayload("no json here")).toBeNull();
    expect(parseConnectionStatusPayload(undefined)).toBeNull();
  });
});

describe("getConnectionStatusFromToolPart", () => {
  const basePart = {
    type: "dynamic-tool" as const,
    toolCallId: "call-1",
    input: { query: "meeting notes" },
  };

  test("matches cloud capability tool names only", () => {
    expect(isCloudCapabilityToolName("openwork-cloud_search_capabilities")).toBe(true);
    expect(isCloudCapabilityToolName("openwork-cloud_execute_capability")).toBe(true);
    expect(isCloudCapabilityToolName("bash")).toBe(false);
    expect(isCloudCapabilityToolName("websearch")).toBe(false);
  });

  test("reads completed output", () => {
    const payload = getConnectionStatusFromToolPart({
      ...basePart,
      toolName: "openwork-cloud_search_capabilities",
      state: "output-available",
      output: JSON.stringify(providerAdminSearchResult),
    });
    expect(payload?.connectionName).toBe("Granola");
  });

  test("reads errored output text", () => {
    const payload = getConnectionStatusFromToolPart({
      ...basePart,
      toolName: "openwork-cloud_execute_capability",
      state: "output-error",
      errorText: JSON.stringify({
        connectionStatus: {
          connectionName: "Granola",
          credentialMode: "per_member",
          state: "reauth_required",
        },
      }),
    });
    expect(payload?.connectionName).toBe("Granola");
  });

  test("ignores other tools and in-flight parts", () => {
    expect(
      getConnectionStatusFromToolPart({
        ...basePart,
        toolName: "bash",
        state: "output-available",
        output: JSON.stringify(providerAdminSearchResult),
      }),
    ).toBeNull();
    expect(
      getConnectionStatusFromToolPart({
        ...basePart,
        toolName: "openwork-cloud_search_capabilities",
        state: "input-streaming",
      }),
    ).toBeNull();
  });
});
