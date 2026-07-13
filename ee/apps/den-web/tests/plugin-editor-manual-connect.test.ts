import { describe, expect, test } from "bun:test";

import {
  buildComponentBody,
  buildSkillMarkdown,
  validateManualPluginMcpUrl,
  type DraftComponent,
} from "../app/(den)/dashboard/_components/plugin-editor-screen";
import { resolvePluginMcpPresentation } from "../app/(den)/dashboard/_components/plugin-data";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

describe("manual plugin editor Connect payloads", () => {
  test("declares URL-only MCPs as shared no-auth remote connections", () => {
    const component: DraftComponent = {
      key: 1,
      kind: "mcp",
      name: "Employee Directory",
      description: "",
      suggestedPrompt: "",
      content: "https://directory.example.com/mcp",
    };

    const body = buildComponentBody(component);
    const input = isRecord(body.input) ? body.input : {};
    const metadata = isRecord(input.metadata) ? input.metadata : {};
    const payload = isRecord(input.normalizedPayloadJson) ? input.normalizedPayloadJson : {};
    const servers = isRecord(payload.mcpServers) ? payload.mcpServers : {};
    const server = isRecord(servers["employee-directory"]) ? servers["employee-directory"] : {};

    expect(metadata.authType).toBe("none");
    expect(metadata.credentialMode).toBe("shared");
    expect(server.authType).toBe("none");
    expect(server.credentialMode).toBe("shared");
    expect(server.type).toBe("remote");
    expect(server.url).toBe("https://directory.example.com/mcp");
  });

  test("keeps skill instructions and suggested prompt in the submitted bundle", () => {
    const component: DraftComponent = {
      key: 1,
      kind: "skill",
      name: "Inactive Account Check",
      description: "Find employees whose accounts should be reviewed",
      suggestedPrompt: "Check inactive accounts in the employee directory",
      content: "Use the Employee Directory MCP and report inactive accounts.",
    };

    expect(buildSkillMarkdown(component)).toContain("suggested_prompt: Check inactive accounts in the employee directory");
    const body = buildComponentBody(component);
    const input = isRecord(body.input) ? body.input : {};
    const metadata = isRecord(input.metadata) ? input.metadata : {};
    expect(metadata.suggestedPrompt).toBe("Check inactive accounts in the employee directory");
  });

  test("rejects non-HTTPS or credential-bearing manual MCP URLs", () => {
    expect(validateManualPluginMcpUrl("http://directory.example.com/mcp")).toContain("https://");
    expect(validateManualPluginMcpUrl("https://token@directory.example.com/mcp")).toContain("credentials");
    expect(validateManualPluginMcpUrl("https://directory.example.com/mcp")).toBeNull();
  });

  test("presents a materialized remote MCP as an OpenWork Connect HTTP connection", () => {
    expect(resolvePluginMcpPresentation({
      externalMcpConnectionId: "mcp_connection_123",
      mcpServers: {
        employee_directory: { type: "remote", url: "https://directory.example.com/mcp" },
      },
    })).toEqual({ connectionBacked: true, transport: "http" });
  });
});
