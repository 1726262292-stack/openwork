import assert from "node:assert/strict"
import test from "node:test"
import {
  artifactDigest,
  artifactFreshness,
  canonicalArtifactJson,
  renderSavedScriptMarkdown,
} from "../src/saved-script-artifacts.js"

test("canonical JSON and digests are stable across object key order", () => {
  assert.equal(canonicalArtifactJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}')
  assert.equal(artifactDigest({ b: 2, a: 1 }), artifactDigest({ a: 1, b: 2 }))
})

test("Markdown rendering is deterministic and never emits raw HTML", () => {
  assert.equal(renderSavedScriptMarkdown("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;")
  assert.equal(renderSavedScriptMarkdown({ b: true, a: "<strong>x</strong>" }), [
    "| Key | Value |",
    "| --- | --- |",
    "| a | &lt;strong&gt;x&lt;/strong&gt; |",
    "| b | true |",
  ].join("\n"))
  assert.equal(renderSavedScriptMarkdown([{ b: 2, a: 1 }, { a: 3, b: 4 }]), [
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
    "| 3 | 4 |",
  ].join("\n"))
  assert.equal(renderSavedScriptMarkdown({ nested: { value: 1 } }), '```json\n{"nested":{"value":1}}\n```')
})

test("freshness preserves last-good state after failures", () => {
  const now = new Date("2026-08-10T12:00:00.000Z")
  assert.deepEqual(artifactFreshness({
    latestFinishedAt: null,
    latestStatus: null,
    latestSuccessfulFinishedAt: null,
    latestSuccessfulReceiptId: null,
    maxAgeMs: 60_000,
    now,
  }), { state: "never_run" })
  assert.deepEqual(artifactFreshness({
    latestFinishedAt: new Date("2026-08-10T11:59:30.000Z"),
    latestStatus: "failed",
    latestSuccessfulFinishedAt: new Date("2026-08-10T11:58:00.000Z"),
    latestSuccessfulReceiptId: "cmr_last_good",
    maxAgeMs: 60_000,
    now,
    failureReason: "Provider access was revoked.",
  }), {
    state: "needs_attention",
    ageMs: 120_000,
    lastSuccessfulReceiptId: "cmr_last_good",
    reason: "Provider access was revoked.",
  })
})
