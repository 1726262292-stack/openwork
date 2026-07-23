import assert from "node:assert/strict"
import test from "node:test"
import {
  UI_ARTIFACT_KINDS,
  UI_ARTIFACT_USE_CAPABILITY,
  uiArtifactActionSchema,
  uiArtifactCalendarDaySchema,
  uiArtifactRenderInputSchema,
  uiArtifactRenderResultSchema,
} from "@openwork/types/ui-artifact"
import {
  CALENDAR_DAY_EXAMPLE,
  COMMUNICATION_THREAD_EXAMPLE,
  UiArtifactMockStore,
  resolveRenderArtifactInput,
  searchArtifacts,
  searchArtifactsInputSchema,
  renderUiArtifact,
} from "../src/index.js"

test("calendar tool metadata ranks the calendar artifact first", () => {
  const input = searchArtifactsInputSchema.parse({
    query: "show me the day",
    signal: {
      toolName: "google_calendar_list_events",
      toolTitle: "List calendar events",
      arguments: { date: "2026-07-23" },
    },
  })

  const result = searchArtifacts(input)
  assert.deepEqual(searchArtifacts(input), result)
  assert.equal(result.matches[0]?.artifactId, "calendar.day")
  assert.equal(result.matches[0]?.toolDefinition.name, "use_artifact")
  assert.equal(result.matches[0]?.toolDefinition.artifactVersion, "1")
  assert.equal(
    result.matches[0]?.toolDefinition.schemaDigest,
    "sha256:b042a7d37df336c833c096e44ae8919ae6e96861850fb1c28b5fdf9e7fc28c4c",
  )
  assert.deepEqual(result.matches[0]?.toolDefinition.invocation, {
    toolName: "use_artifact",
    argumentsField: "artifact",
  })
  assert.equal(
    uiArtifactRenderInputSchema.safeParse(result.matches[0]?.toolDefinition.exampleArguments).success,
    true,
  )
})

test("enabled artifact filtering is deterministic", () => {
  const input = searchArtifactsInputSchema.parse({
    query: "show email and slack messages",
    enabledArtifactIds: ["mail.inbox"],
    limit: 5,
  })

  const result = searchArtifacts(input)
  assert.deepEqual(result.matches.map((match) => match.artifactId), ["mail.inbox"])
})

test("capability transport returns an execute_capability use definition", () => {
  const input = searchArtifactsInputSchema.parse({
    query: "calendar events today",
    limit: 1,
  })
  const result = searchArtifacts(input, { transport: "execute_capability" })
  assert.equal(result.matches[0]?.toolDefinition.name, "execute_capability")
  assert.deepEqual(result.matches[0]?.toolDefinition.invocation, {
    toolName: "execute_capability",
    capability: UI_ARTIFACT_USE_CAPABILITY,
    argumentsField: "body",
  })
})

test("every catalog kind can be enabled without an unknown value", () => {
  assert.deepEqual([...UI_ARTIFACT_KINDS].sort(), [
    "calendar.day",
    "communication.thread",
    "mail.inbox",
    "metrics.glance",
    "work.approvals",
    "work.attention",
    "work.progress",
    "workspace.brief",
  ])
})

test("stateful approval decisions are revision-safe and update later actions", () => {
  const search = searchArtifacts(searchArtifactsInputSchema.parse({
    query: "approvals awaiting my decision",
    limit: 1,
  }))
  const input = search.matches[0]?.toolDefinition.exampleArguments
  assert.ok(input)
  assert.equal(input.artifactId, "work.approvals")

  const store = new UiArtifactMockStore({
    clock: () => "2026-07-23T11:00:00.000Z",
  })
  const initial = store.use(input)
  assert.equal(initial.ok, true)
  if (!initial.ok) return
  assert.equal(initial.result.artifact.artifactId, "work.approvals")

  const decided = store.use({
    operation: "decide",
    artifactId: "work.approvals",
    instanceId: initial.result.artifact.instanceId,
    itemId: "expense-lisbon",
    decision: "approve",
    expectedRevision: 1,
  })
  assert.equal(decided.ok, true)
  if (!decided.ok || decided.result.artifact.artifactId !== "work.approvals") return
  assert.equal(decided.result.artifact.revision, 2)
  assert.equal(decided.result.artifact.operation, "replace")
  assert.equal(decided.result.artifact.data.items[0]?.status, "approved")
  assert.equal(decided.result.artifact.data.items[1]?.actions?.[0]?.expectedRevision, 2)
  assert.deepEqual(decided.result.interaction, {
    type: "decision",
    itemId: "expense-lisbon",
    decision: "approve",
    previousRevision: 1,
    revision: 2,
  })

  const stale = store.use({
    operation: "decide",
    artifactId: "work.approvals",
    instanceId: initial.result.artifact.instanceId,
    itemId: "access-production",
    decision: "reject",
    expectedRevision: 1,
  })
  assert.equal(stale.ok, false)
  if (!stale.ok) assert.equal(stale.code, "revision_conflict")
})

test("render result validates the shared contract and narrates visible data", () => {
  const result = renderUiArtifact(CALENDAR_DAY_EXAMPLE)
  assert.equal(uiArtifactRenderResultSchema.safeParse(result).success, true)
  assert.match(result.narration.summary, /4 calendar events/)
  assert.equal(result.artifact.instanceId, "demo-calendar-2026-07-23")
})

test("narration facts stay inside the compact contract for long valid messages", () => {
  const artifact = {
    ...COMMUNICATION_THREAD_EXAMPLE,
    data: {
      ...COMMUNICATION_THREAD_EXAMPLE.data,
      messages: [{
        ...COMMUNICATION_THREAD_EXAMPLE.data.messages[0],
        body: "x".repeat(2_000),
      }],
    },
  }
  const result = renderUiArtifact(artifact)
  assert.equal(uiArtifactRenderResultSchema.safeParse(result).success, true)
  assert.equal(result.narration.visibleFacts.every((fact) => fact.length <= 160), true)
})

test("artifact actions accept only credential-free https URLs", () => {
  const base = { id: "open", label: "Open", type: "open_url" as const }
  assert.equal(uiArtifactActionSchema.safeParse({ ...base, url: "https://example.com" }).success, true)
  assert.equal(uiArtifactActionSchema.safeParse({ ...base, url: "http://example.com" }).success, false)
  assert.equal(uiArtifactActionSchema.safeParse({ ...base, url: "javascript:alert(1)" }).success, false)
  assert.equal(uiArtifactActionSchema.safeParse({ ...base, url: "file:///tmp/private" }).success, false)
  assert.equal(uiArtifactActionSchema.safeParse({ ...base, url: "https://user:secret@example.com" }).success, false)
})

test("render input is bound to the searched schema and mock alpha capabilities", () => {
  const search = searchArtifacts(searchArtifactsInputSchema.parse({
    query: "calendar today",
    limit: 1,
  }))
  const input = search.matches[0]?.toolDefinition.exampleArguments
  assert.ok(input)
  assert.equal(resolveRenderArtifactInput(input).ok, true)

  const wrongDigest = {
    ...input,
    schemaDigest: `sha256:${"0".repeat(64)}`,
  }
  const digestResult = resolveRenderArtifactInput(wrongDigest)
  assert.equal(digestResult.ok, false)
  if (!digestResult.ok) assert.equal(digestResult.code, "schema_digest_mismatch")

  const artifact = uiArtifactCalendarDaySchema.parse(input.artifact)
  const replaceResult = resolveRenderArtifactInput({
    ...input,
    artifact: { ...artifact, operation: "replace" },
  })
  assert.equal(replaceResult.ok, false)
  if (!replaceResult.ok) assert.equal(replaceResult.code, "operation_unsupported")

  const panelResult = resolveRenderArtifactInput({
    ...input,
    artifact: {
      ...artifact,
      presentation: { ...artifact.presentation, placement: "panel" },
    },
  })
  assert.equal(panelResult.ok, false)
  if (!panelResult.ok) assert.equal(panelResult.code, "renderer_unsupported")

  const providerResult = resolveRenderArtifactInput({
    ...input,
    artifact: {
      ...artifact,
      source: { ...artifact.source, type: "provider" },
    },
  })
  assert.equal(providerResult.ok, false)
  if (!providerResult.ok) assert.equal(providerResult.code, "source_receipt_required")

  const unsafeActionResult = resolveRenderArtifactInput({
    ...input,
    artifact: {
      ...artifact,
      data: {
        ...artifact.data,
        events: [{
          ...artifact.data.events[0],
          action: {
            id: "unsafe",
            label: "Open",
            type: "open_url",
            url: "https://untrusted.example/path",
          },
        }],
      },
    },
  })
  assert.equal(unsafeActionResult.ok, false)
  if (!unsafeActionResult.ok) assert.equal(unsafeActionResult.code, "unsafe_action")
})
