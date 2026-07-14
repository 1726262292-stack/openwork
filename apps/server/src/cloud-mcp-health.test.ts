import { describe, expect, test } from "bun:test";
import {
  CloudMcpDeliveryStateStore,
  calculateCloudMcpDesiredRevision,
  OPENWORK_CLOUD_EXPECTED_TOOLS,
} from "./cloud-mcp-health.js";
import { sanitizeDiagnosticValue } from "./diagnostic-sanitizer.js";
import { diagnoseMcpToolDeniesFromConfigs } from "./mcp.js";
import type { WorkspaceInfo } from "./types.js";

const workspace: WorkspaceInfo = {
  id: "ws_1",
  name: "Workspace",
  path: "/tmp/workspace",
  preset: "starter",
  workspaceType: "local",
};

describe("cloud MCP health foundation", () => {
  test("sanitizes nested diagnostics and never returns raw authorization tokens", () => {
    const sanitized = sanitizeDiagnosticValue({
      Authorization: "Bearer owt_secret_client_token",
      nested: {
        token: "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123456789",
        message: "failed with Bearer abc.def.ghi and request_id=req_123 reference_id=ref_456",
      },
      cookie: "session=secret",
    });

    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("owt_secret_client_token");
    expect(text).not.toContain("eyJhbGci");
    expect(text).not.toContain("abc.def.ghi");
    expect(text).not.toContain("session=secret");
    expect(text).toContain("[REDACTED]");
  });

  test("desired revisions detect token metadata change without embedding raw tokens", () => {
    const config = {
      type: "remote",
      url: "https://api.openworklabs.com/mcp/agent",
      headers: { Authorization: "Bearer owt_super_secret" },
      oauth: false,
    };
    const first = calculateCloudMcpDesiredRevision(config, {
      token: { present: true, metadata: { expiresAt: "2026-07-13T00:00:00.000Z" } },
      connectCatalogEnabled: true,
      updatedAt: 1,
    });
    const second = calculateCloudMcpDesiredRevision(config, {
      token: { present: true, metadata: { expiresAt: "2026-07-14T00:00:00.000Z" } },
      connectCatalogEnabled: true,
      updatedAt: 1,
    });

    expect(first).not.toBe(second);
    expect(first).not.toContain("owt_super_secret");
  });

  test("delivery state does not claim applied after revision changes", () => {
    const store = new CloudMcpDeliveryStateStore();
    const metadata = {
      token: { present: true, metadata: { authorizationHash: "hash_1" } },
      connectCatalogEnabled: true,
      updatedAt: 1,
    };

    store.markDesired(workspace, workspace.path, "rev_1", metadata);
    store.markReady(workspace, workspace.path, "rev_1");

    expect(store.snapshot(workspace, workspace.path, "rev_1").appliedRevision).toBe("rev_1");
    const changed = store.snapshot(workspace, workspace.path, "rev_2");
    expect(changed.state).toBe("pending");
    expect(changed.appliedRevision).toBeNull();
  });

  test("diagnoses project and global OpenCode tool denies for exact Cloud IDs", () => {
    const denies = diagnoseMcpToolDeniesFromConfigs({
      name: "openwork-cloud",
      toolIds: [...OPENWORK_CLOUD_EXPECTED_TOOLS],
      projectConfig: {
        tools: {
          "openwork-cloud_search_capabilities": false,
        },
      },
      globalConfig: {
        permission: [
          { permission: "tool", pattern: "openwork-cloud_execute_capability", action: "deny" },
        ],
      },
    });

    expect(denies.map((deny) => deny.source).sort()).toEqual(["config.global", "config.project"]);
    expect(denies.map((deny) => deny.matched).sort()).toEqual([
      "openwork-cloud_execute_capability",
      "openwork-cloud_search_capabilities",
    ]);
  });

  test("project tool allows override global denies for matching Cloud tool IDs", () => {
    const denies = diagnoseMcpToolDeniesFromConfigs({
      name: "openwork-cloud",
      toolIds: [...OPENWORK_CLOUD_EXPECTED_TOOLS],
      projectConfig: {
        tools: {
          "openwork-cloud_search_capabilities": true,
        },
      },
      globalConfig: {
        tools: { deny: ["openwork-cloud_*"] },
      },
    });

    expect(denies).toHaveLength(1);
    expect(denies[0]).toMatchObject({
      source: "config.global",
      pattern: "openwork-cloud_*",
      matched: "openwork-cloud_execute_capability",
    });
  });

  test("plugin canary denies are not reported as Cloud tool denies", () => {
    const denies = diagnoseMcpToolDeniesFromConfigs({
      name: "openwork-cloud",
      toolIds: [...OPENWORK_CLOUD_EXPECTED_TOOLS],
      projectConfig: {
        tools: {
          openwork_extension_list_actions: false,
        },
      },
      globalConfig: {},
    });

    expect(denies).toEqual([]);
  });
});
