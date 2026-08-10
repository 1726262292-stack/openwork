import { describe, expect, test } from "bun:test"
import { createAutomationSchema } from "@openwork/types/automations"
import { automationRevisionDigest } from "./contracts"

const schedule = { kind: "daily" as const, timezone: "UTC", hour: 9, minute: 0 }

describe("saved Script Automations", () => {
  test("accepts only cloud placement for a pinned saved Script", () => {
    const definition = {
      name: "Launch briefing",
      schedule,
      action: {
        kind: "saved_script" as const,
        script: {
          pluginId: "plugin_1",
          configObjectId: "script_1",
          configObjectVersionId: "version_1",
        },
        input: { topic: "launch" },
      },
      executionTarget: "cloud" as const,
    }
    expect(createAutomationSchema.safeParse(definition).success).toBe(true)
    expect(createAutomationSchema.safeParse({ ...definition, executionTarget: "desktop" }).success).toBe(false)
  })

  test("keeps legacy agent creation compatible and versions exact script identities", () => {
    expect(createAutomationSchema.safeParse({
      name: "Legacy",
      instructions: "Prepare a briefing",
      schedule,
      model: { providerId: "openwork", modelId: "model" },
    }).success).toBe(true)

    const common = {
      instructions: "Execute the pinned saved Code Mode script.",
      schedule,
      model: { providerId: "opencode", modelId: "big-pickle" },
      maximumRuntimeMs: 60_000,
      executionTarget: "cloud" as const,
    }
    const action = {
      kind: "saved_script" as const,
      script: { pluginId: "plugin_1", configObjectId: "script_1", configObjectVersionId: "version_1" },
      input: { topic: "launch" },
    }
    expect(automationRevisionDigest({ ...common, action }))
      .not.toBe(automationRevisionDigest({
        ...common,
        action: { ...action, script: { ...action.script, configObjectVersionId: "version_2" } },
      }))
  })
})
