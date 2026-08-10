import { expect, test } from "bun:test"
import {
  externalMcpToolDefinitionDigest,
  externalMcpToolSchemaDigest,
  validateExternalMcpToolArguments,
} from "../src/mcp/external-mcp-tool-arguments.js"

test("schema digests are stable across object key order", () => {
  const first = externalMcpToolSchemaDigest({
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
    },
    required: ["query"],
  })
  const second = externalMcpToolSchemaDigest({
    required: ["query"],
    properties: {
      limit: { type: "number" },
      query: { type: "string" },
    },
    type: "object",
  })

  expect(first).toBe(second)
  expect(first).toMatch(/^sha256:[a-f0-9]{64}$/)
})

test("tool definition approvals are stable but invalidate on provider catalog drift", () => {
  const tool = {
    name: "read_report",
    description: "Read a report",
    inputSchema: { type: "object" as const, properties: { id: { type: "string" } } },
    annotations: { readOnlyHint: true },
  }
  const approved = externalMcpToolDefinitionDigest(tool)

  expect(externalMcpToolDefinitionDigest({
    ...tool,
    inputSchema: { properties: { id: { type: "string" } }, type: "object" as const },
  })).toBe(approved)
  expect(externalMcpToolDefinitionDigest({
    ...tool,
    annotations: { readOnlyHint: true, destructiveHint: true },
  })).not.toBe(approved)
  expect(externalMcpToolDefinitionDigest({
    ...tool,
    inputSchema: { type: "object" as const, properties: { reportId: { type: "string" } } },
  })).not.toBe(approved)
})

test("invalid remote MCP arguments return corrective schema details", () => {
  const result = validateExternalMcpToolArguments({
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
    additionalProperties: false,
  }, {})

  expect(result).toMatchObject({
    ok: false,
    error: "invalid_arguments",
    issues: [{
      path: "/",
      keyword: "schema_validation",
    }],
  })
  if (!result.ok && result.error === "invalid_arguments") {
    expect(result.issues[0]?.message).toContain("query")
  }
})

test("remote MCP arguments must be an object before schema validation", () => {
  const result = validateExternalMcpToolArguments({ type: "object" }, ["not", "an", "object"])

  expect(result).toEqual({
    ok: false,
    error: "invalid_arguments",
    issues: [{
      path: "/",
      keyword: "type",
      message: "Remote MCP capability arguments must be a JSON object.",
    }],
  })
})
