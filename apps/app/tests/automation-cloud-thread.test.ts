import { describe, expect, test } from "bun:test"
import type { AutomationCloudThread } from "@openwork/types/automations"
import {
  automationCloudThreadRoute,
  automationExecutionIdentity,
} from "../src/react-app/domains/automations/automation-cloud-thread"

function cloudThread(engineKind: string): AutomationCloudThread {
  return {
    id: "ath_test",
    threadKind: "automation",
    executionLocation: "cloud",
    automationId: "aut_test",
    automationRunId: "arun_test",
    engineKind,
  }
}

describe("Automation cloud thread UI", () => {
  test("uses Den's persisted thread identity for receipt navigation", () => {
    expect(automationCloudThreadRoute(cloudThread("opencode-cloud"))).toBe(
      "/automations?automation=aut_test&run=arun_test&thread=ath_test",
    )
  })

  test("derives Cloud icon and label from executionLocation, never engineKind", () => {
    expect(automationExecutionIdentity(cloudThread("opencode-cloud"))).toEqual({ icon: "cloud", label: "Cloud" })
    expect(automationExecutionIdentity(cloudThread("future-replaceable-engine"))).toEqual({ icon: "cloud", label: "Cloud" })
  })
})
