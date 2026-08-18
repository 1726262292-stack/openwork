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

test("the soft spec-impact snapshot identifies uncovered and covered contract changes", ({ evidence }) => {
  const uncovered = run("ee/apps/den-api/src/codemode-runs.ts")
  expect(uncovered).toContain("Needs attention")
  expect(uncovered).toContain("den.codemode-receipts")
  expect(uncovered).toContain("::warning title=Spec impact snapshot::")

  const covered = run(
    "ee/apps/den-api/src/codemode-runs.ts",
    "evals/specs/generated-artifact-views.slow.test.ts",
  )
  expect(covered).toContain("Covered by a changed spec")
  expect(covered).not.toContain("::warning title=Spec impact snapshot::")

  evidence.fact(
    "Implementation changes map to their proof specs",
    "The advisory report warned without a mapped spec change and cleared when the generated Artifact view spec changed.",
    true,
  )
})
