import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (relative: string) => readFileSync(join(import.meta.dir, "..", relative), "utf8")

describe("saved Code Mode script journey", () => {
  test("offers run again and save from a successful script result", () => {
    const card = read("src/components/tools/openwork-codemode-script.tsx")
    const messages = read("src/components/chat/message-list.tsx")

    expect(messages).toContain("isCodemodeScriptToolPart(part)")
    expect(messages).toContain("<OpenWorkCodemodeScriptTool")
    expect(card).toContain("Run again")
    expect(card).toContain("Save as script")
    expect(card).toContain("currentInput: scriptInput")
    expect(card).toContain("Future runs recheck access before contacting a provider")
  })

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
  })
})
