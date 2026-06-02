import { describe, expect, test } from "bun:test"
import { isMcpOperationAllowed, requiredScopeForMethod } from "../src/mcp/policy.js"

describe("MCP worker background jobs", () => {
  test("allows Workers-tagged background job operations through Cloud MCP", () => {
    expect(isMcpOperationAllowed({
      method: "POST",
      path: "/v1/workers/{id}/background-jobs",
      operation: {
        operationId: "postV1WorkersByIdBackgroundJobs",
        tags: ["Workers"],
      },
    })).toBe(true)
    expect(requiredScopeForMethod("POST")).toBe("mcp:write")
  })
})
