import { describe, expect, test } from "bun:test"

import {
  APP_PERMISSION_CONSENT,
  APP_PERMISSION_IDS,
  APP_PERMISSION_LABEL,
  APP_PERMISSION_RISK,
  diffPermissions,
  permissionKey,
  requiresUserGesture,
  type AppPermission,
} from "../src/permissions.js"
import {
  CAPABILITY_NAMES,
  CAPABILITY_PERMISSION,
  CAPABILITY_REQUIRES_GESTURE,
  capabilityRequestSchema,
} from "../src/capabilities.js"

const connect = (scopes: AppPermission extends never ? never : string[]): AppPermission => ({
  id: "openwork.connect.read",
  reason: "research",
  scopes: scopes as never,
})

const network = (hosts: string[]): AppPermission => ({
  id: "network.host",
  reason: "reach the model",
  hosts,
})

describe("vocabulary completeness", () => {
  test("every permission id has a risk band, consent stage, and label", () => {
    for (const id of APP_PERMISSION_IDS) {
      expect(APP_PERMISSION_RISK[id]).toBeDefined()
      expect(APP_PERMISSION_CONSENT[id]).toBeDefined()
      expect(APP_PERMISSION_LABEL[id]).toBeDefined()
    }
  })

  test("every capability maps to a permission entry and a gesture rule", () => {
    for (const capability of CAPABILITY_NAMES) {
      expect(capability in CAPABILITY_PERMISSION).toBe(true)
      expect(capability in CAPABILITY_REQUIRES_GESTURE).toBe(true)
      const permission = CAPABILITY_PERMISSION[capability]
      if (permission !== null) expect(APP_PERMISSION_IDS).toContain(permission)
    }
  })

  test("thread and attachment creation are the use-time permissions", () => {
    const gesture = APP_PERMISSION_IDS.filter(requiresUserGesture)
    expect(gesture.sort()).toEqual(["openwork.attachments.create", "openwork.threads.start"])
  })

  test("the gesture-bearing capabilities are exactly the use-time ones", () => {
    const gestureCapabilities = CAPABILITY_NAMES.filter(
      (capability) => CAPABILITY_REQUIRES_GESTURE[capability],
    )
    expect([...gestureCapabilities].sort()).toEqual(["attachments.create", "threads.start"])
  })

  test("there is no vocabulary for shell, filesystem, or raw secret access", () => {
    const forbidden = ["shell", "fs.", "filesystem", "node", "secret", "credential", "mcp", "ipc"]
    for (const id of APP_PERMISSION_IDS) {
      for (const term of forbidden) expect(id.toLowerCase()).not.toContain(term)
    }
    for (const capability of CAPABILITY_NAMES) {
      for (const term of forbidden) expect(capability.toLowerCase()).not.toContain(term)
    }
  })
})

describe("permission delta", () => {
  test("an unchanged set needs no review", () => {
    const granted = [connect(["slack.search"]), network(["api.openai.com"])]
    const delta = diffPermissions(granted, [network(["api.openai.com"]), connect(["slack.search"])])
    expect(delta.entries).toEqual([])
    expect(delta.requiresReview).toBe(false)
  })

  test("a new permission requires review", () => {
    const delta = diffPermissions([], [{ id: "audio.microphone", reason: "listen" }])
    expect(delta.requiresReview).toBe(true)
    expect(delta.entries[0]?.change).toBe("added")
  })

  test("an added Connect scope requires review", () => {
    const delta = diffPermissions([connect(["slack.search"])], [connect(["slack.search", "gmail.search"])])
    expect(delta.requiresReview).toBe(true)
    expect(delta.entries[0]?.change).toBe("widened")
  })

  test("a removed Connect scope does not require review", () => {
    const delta = diffPermissions([connect(["slack.search", "gmail.search"])], [connect(["slack.search"])])
    expect(delta.requiresReview).toBe(false)
    expect(delta.entries[0]?.change).toBe("narrowed")
  })

  test("swapping one host for another requires review", () => {
    const delta = diffPermissions([network(["api.openai.com"])], [network(["evil.example.com"])])
    expect(delta.requiresReview).toBe(true)
    expect(delta.entries[0]?.change).toBe("widened")
  })

  test("dropping a permission entirely does not require review", () => {
    const delta = diffPermissions([network(["api.openai.com"])], [])
    expect(delta.requiresReview).toBe(false)
    expect(delta.entries[0]?.change).toBe("removed")
  })

  test("raising a storage quota requires review but lowering it does not", () => {
    const small: AppPermission = { id: "storage.app", reason: "cache", quota_bytes: 1000 }
    const large: AppPermission = { id: "storage.app", reason: "cache", quota_bytes: 5000 }
    expect(diffPermissions([small], [large]).requiresReview).toBe(true)
    expect(diffPermissions([large], [small]).requiresReview).toBe(false)
  })

  test("turning on always-on-top requires review", () => {
    const off: AppPermission = { id: "desktop.floatingSurface", reason: "island", always_on_top: false }
    const on: AppPermission = { id: "desktop.floatingSurface", reason: "island", always_on_top: true }
    expect(diffPermissions([off], [on]).requiresReview).toBe(true)
    expect(diffPermissions([on], [off]).requiresReview).toBe(false)
  })

  test("a changed reason alone does not require review", () => {
    const before: AppPermission = { id: "audio.microphone", reason: "listen" }
    const after: AppPermission = { id: "audio.microphone", reason: "listen for opportunities" }
    expect(permissionKey(before)).toBe(permissionKey(after))
    expect(diffPermissions([before], [after]).requiresReview).toBe(false)
  })

  test("scope order does not affect the key", () => {
    expect(permissionKey(connect(["gmail.search", "slack.search"]))).toBe(
      permissionKey(connect(["slack.search", "gmail.search"])),
    )
  })
})

describe("capability requests", () => {
  test("thread creation without a gesture token is rejected", () => {
    const result = capabilityRequestSchema.safeParse({
      capability: "threads.start",
      title: "Prepare the Berlin trip",
      goal: "Check the calendar conflict",
      summary: "…",
    })
    expect(result.success).toBe(false)
  })

  test("a well-formed thread request parses", () => {
    const result = capabilityRequestSchema.safeParse({
      capability: "threads.start",
      gesture_token: "g".repeat(24),
      title: "Prepare the Berlin trip",
      goal: "Check the calendar conflict",
      summary: "Two events overlap on Thursday.",
      provenance: [{ scope: "calendar.events.read", title: "Design review" }],
    })
    expect(result.success).toBe(true)
  })

  test("an unknown capability is rejected", () => {
    expect(
      capabilityRequestSchema.safeParse({ capability: "shell.exec", command: "rm -rf /" }).success,
    ).toBe(false)
  })

  test("an unknown field on a capability request is rejected", () => {
    expect(
      capabilityRequestSchema.safeParse({
        capability: "connect.query",
        scope: "slack.search",
        query: "berlin",
        raw_provider_call: true,
      }).success,
    ).toBe(false)
  })

  test("an out-of-vocabulary Connect scope is rejected", () => {
    expect(
      capabilityRequestSchema.safeParse({
        capability: "connect.query",
        scope: "slack.post_message",
        query: "hello",
      }).success,
    ).toBe(false)
  })

  test("an attachment filename cannot traverse", () => {
    expect(
      capabilityRequestSchema.safeParse({
        capability: "attachments.create",
        gesture_token: "g".repeat(24),
        filename: "../../.ssh/authorized_keys",
        content_type: "text/plain",
        content: "x",
      }).success,
    ).toBe(false)
  })
})
