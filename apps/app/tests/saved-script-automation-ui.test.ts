import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (relative: string) => readFileSync(join(import.meta.dir, "..", relative), "utf8")

describe("saved Code Mode script journey", () => {
  test("runs or automates the exact saved version from Library", () => {
    const library = read("src/react-app/domains/settings/pages/mcp-view.tsx")

    expect(library).toContain('file.objectType === "script" && file.versionId')
    expect(library).toContain("Run now")
    expect(library).toContain("runSavedCodemodeScript")
    expect(library).toContain("Validated result")
    expect(library).toContain("Reusable Code Mode programs saved in OpenWork Cloud")
    expect(library).toContain("visibleScripts.map((script)")
    expect(library).toContain("scriptVersionId=")
  })

  test("models scripts as pinned cloud Automation actions", () => {
    const editor = read("src/react-app/domains/automations/automation-editor.tsx")
    const page = read("src/react-app/domains/automations/automations-page.tsx")

    expect(editor).toContain('kind: "saved_script"')
    expect(editor).toContain('executionTarget: "cloud"')
    expect(editor).toContain("pins the exact script version")
    expect(editor).toContain("even when your browser and desktop are closed")
    expect(page).toContain("scriptVersionId")
    expect(page).toContain("OpenWork Cloud")
    expect(page).toContain("supportsCloudSavedScriptAutomations")
    expect(page).toContain('queryKey: [...queryRoot, "capabilities", "saved-script-cloud"]')
    expect(page).toContain("does not support Cloud Script Automations yet")
  })

  test("keeps Script edits test-gated and renders one durable artifact contract", () => {
    const detail = read("src/react-app/domains/dynamic-artifacts/saved-script-detail.tsx")
    const result = read("src/react-app/domains/dynamic-artifacts/saved-script-artifact-result.tsx")
    const automations = read("src/react-app/domains/automations/automations-page.tsx")

    expect(detail).toContain("Any draft change invalidates the previous test")
    expect(detail).toContain("setTestResult(null)")
    expect(detail).toContain("disabled={!matchingTest")
    expect(detail).toContain("Save new version")
    expect(detail).toContain("Update Automation…")
    expect(detail).toContain("Audit facts will remain")
    expect(result).toContain('value="preview"')
    expect(result).toContain('value="data"')
    expect(result).toContain('value="lineage"')
    expect(automations).toContain("latestSuccessfulRunQuery")
    expect(automations).toContain("SavedScriptArtifactResult")
  })
})
