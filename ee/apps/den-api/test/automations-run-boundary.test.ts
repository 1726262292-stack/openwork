import { describe, expect, test } from "bun:test"
import { automationCloudThreadSchema } from "@openwork/types/automations"
import {
  filterAutomationRunCapabilities,
  isAutomationManagementPath,
  isAutomationRunCapabilityNameAllowed,
} from "../src/automations/run-capabilities.js"

describe("Automation run integration boundary", () => {
  test("allows only namespaced Connect integrations", () => {
    expect(isAutomationRunCapabilityNameAllowed("native:google-workspace:createGmailDraft")).toBe(true)
    expect(isAutomationRunCapabilityNameAllowed("mcp:slack-connection:post_message")).toBe(true)
    expect(isAutomationRunCapabilityNameAllowed("createAutomation")).toBe(false)
    expect(isAutomationRunCapabilityNameAllowed("native:missing-tool")).toBe(false)
    expect(isAutomationRunCapabilityNameAllowed("mcp::missing-connection")).toBe(false)
  })

  test("filters Den Automation management before returning search results", () => {
    const matches = filterAutomationRunCapabilities([
      { name: "native:google-workspace:listMessages", path: "/v1/capabilities/google-workspace/messages" },
      { name: "mcp:slack:post_message", path: "https://slack.example.test/mcp" },
      { name: "listAutomations", path: "/v1/automations" },
      { name: "cancelAutomationRun", path: "/v1/automation-runs/{id}/cancel" },
    ])

    expect(matches.map((match) => match.name)).toEqual([
      "native:google-workspace:listMessages",
      "mcp:slack:post_message",
    ])
    expect(isAutomationManagementPath("/v1/automations/aut_test/run")).toBe(true)
    expect(isAutomationManagementPath("/v1/automation-runs/run_test/cancel")).toBe(true)
  })

  test("validates the Den-assigned cloud identity without inferring placement from the engine", () => {
    expect(automationCloudThreadSchema.parse({
      id: "ath_test",
      threadKind: "automation",
      executionLocation: "cloud",
      automationId: "aut_test",
      automationRunId: "arun_test",
      engineKind: "opencode-cloud",
    })).toEqual({
      id: "ath_test",
      threadKind: "automation",
      executionLocation: "cloud",
      automationId: "aut_test",
      automationRunId: "arun_test",
      engineKind: "opencode-cloud",
    })
  })
})
