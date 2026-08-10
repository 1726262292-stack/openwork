import type { ExternalMcpToolPolicy } from "@openwork-ee/den-db"
import { describe, expect, test } from "bun:test"
import {
  evaluateToolPolicy,
  isToolApprovedForUnattendedCloud,
  isToolDisabled,
} from "../src/capability-sources/external-mcp-tool-policy.js"
import { externalMcpToolDefinitionDigest } from "../src/mcp/external-mcp-tool-arguments.js"

const policy: ExternalMcpToolPolicy = {
  version: 1,
  allDisabled: false,
  disabledTools: ["delete_issue"],
  updatedByName: "Workspace Admin",
  updatedAt: "2026-08-04T12:00:00.000Z",
}

describe("external MCP tool policy", () => {
  test("allows tools when no policy exists", () => {
    expect(evaluateToolPolicy(null, "delete_issue")).toEqual({ blocked: false })
    expect(isToolDisabled(undefined, "delete_issue")).toBe(false)
  })

  test("blocks an individually disabled tool with attribution", () => {
    expect(evaluateToolPolicy(policy, "delete_issue")).toEqual({
      blocked: true,
      reason: "tool_disabled",
      disabledBy: "Workspace Admin",
      disabledAt: "2026-08-04T12:00:00.000Z",
    })
    expect(isToolDisabled(policy, "delete_issue")).toBe(true)
    expect(isToolDisabled(policy, "read_issue")).toBe(false)
  })

  test("allDisabled blocks every tool", () => {
    expect(evaluateToolPolicy({ ...policy, allDisabled: true }, "read_issue")).toMatchObject({
      blocked: true,
      reason: "all_disabled",
    })
  })

  test("unattended approval is revoked when the advertised tool definition changes", () => {
    const tool = {
      name: "read_issue",
      inputSchema: { type: "object" as const, properties: { id: { type: "string" } } },
      annotations: { readOnlyHint: true },
    }
    const approvedPolicy: ExternalMcpToolPolicy = {
      ...policy,
      unattendedApprovedTools: [tool.name],
      unattendedApprovedToolDigests: {
        [tool.name]: externalMcpToolDefinitionDigest(tool),
      },
    }

    expect(isToolApprovedForUnattendedCloud(approvedPolicy, tool)).toBe(true)
    expect(isToolApprovedForUnattendedCloud(approvedPolicy, {
      ...tool,
      annotations: { readOnlyHint: true, destructiveHint: true },
    })).toBe(false)
    expect(isToolApprovedForUnattendedCloud({
      ...approvedPolicy,
      unattendedApprovedToolDigests: undefined,
    }, tool)).toBe(false)
  })
})
