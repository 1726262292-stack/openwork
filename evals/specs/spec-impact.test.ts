import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect } from "vitest"
import { test } from "@openwork/testkit"

const script = fileURLToPath(new URL("../scripts/spec-impact.mjs", import.meta.url))

function run(...changedFiles: string[]): string {
  return execFileSync(process.execPath, [script, ...changedFiles.flatMap((file) => ["--changed-file", file])], {
    encoding: "utf8",
  })
}

function runMatched(...changedFiles: string[]): string {
  return execFileSync(process.execPath, [script, "--matched-specs", ...changedFiles.flatMap((file) => ["--changed-file", file])], {
    encoding: "utf8",
  })
}

test("the soft spec-impact snapshot identifies uncovered and covered contract changes", ({ evidence }) => {
  const uncovered = run("ee/apps/den-api/src/codemode-runs.ts")
  expect(uncovered).toContain("Needs attention")
  expect(uncovered).toContain("den.codemode-receipts")
  expect(uncovered).toContain("::warning title=Spec impact snapshot::")
  expect(uncovered).toContain("Matched slow specs:")

  const covered = run(
    "ee/apps/den-api/src/codemode-runs.ts",
    "evals/specs/generated-artifact-views.slow.test.ts",
  )
  expect(covered).toContain("Covered by a changed spec")
  expect(covered).not.toContain("::warning title=Spec impact snapshot::")

  const matched = JSON.parse(runMatched("ee/apps/den-api/src/codemode-runs.ts"))
  expect(matched).toContain("evals/specs/codemode-scripts.slow.test.ts")
  expect(matched).toContain("evals/specs/generated-artifact-views.slow.test.ts")

  evidence.fact(
    "Implementation changes map to their proof specs",
    "The advisory report warned without a mapped spec change and cleared when the generated Artifact view spec changed.",
    true,
  )
})

test("the spec-impact report suggests a slow spec for unmapped changes", ({ evidence }) => {
  const report = run("apps/app/src/react-app/unmapped-feature.ts")
  expect(report).toContain("Warden suggestion: add or update an `evals/specs/<feature>.slow.test.ts`")
  evidence.fact(
    "Unmapped app changes receive a slow-spec suggestion",
    "Warden reports an actionable slow-test suggestion when no contract matches.",
    true,
  )
})

test("the spec-impact matcher always selects changed slow specs", ({ evidence }) => {
  const matched = JSON.parse(runMatched("evals/specs/new-unmapped-feature.slow.test.ts"))
  expect(matched).toEqual(["evals/specs/new-unmapped-feature.slow.test.ts"])
  evidence.fact(
    "New slow specs enter the PR sweep without a contract mapping",
    "The matcher selected a changed unmapped slow spec directly.",
    true,
  )
})
