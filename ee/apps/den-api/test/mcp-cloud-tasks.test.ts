import { describe, expect, test } from "bun:test"
import { isMcpOperationAllowed, requiredScopeForMethod } from "../src/mcp/policy.js"

describe("MCP cloud tasks", () => {
  test("allows Cloud Tasks create and run operations through Cloud MCP", () => {
    expect(isMcpOperationAllowed({
      method: "POST",
      path: "/v1/cloud-tasks",
      operation: {
        operationId: "postCloudTasks",
        tags: ["Cloud Tasks"],
      },
    })).toBe(true)

    expect(isMcpOperationAllowed({
      method: "POST",
      path: "/v1/cloud-tasks/{id}/runs",
      operation: {
        operationId: "postCloudTasksByIdRuns",
        tags: ["Cloud Tasks"],
      },
    })).toBe(true)

    expect(requiredScopeForMethod("POST")).toBe("mcp:write")
  })

  test("blocks the stale worker-bound background job operation", () => {
    expect(isMcpOperationAllowed({
      method: "POST",
      path: "/v1/workers/{id}/background-jobs",
      operation: {
        operationId: "postWorkersByIdBackgroundJobs",
        tags: ["Workers"],
      },
    })).toBe(false)
  })
})
