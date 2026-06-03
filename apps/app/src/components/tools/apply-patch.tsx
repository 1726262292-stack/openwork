"use client"

import type { ApplyPatchToolPart } from "@/lib/build-in-tools"
import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "./collapsible-tool"

interface ApplyPatchToolProps {
  part: ApplyPatchToolPart
}

interface ParsedApplyPatchChange {
  marker: "A" | "M" | "D"
  filePath: string
}

interface ParsedApplyPatchDiagnostic {
  filePath: string
  lines: string[]
}

interface ParsedApplyPatchOutput {
  success: boolean
  changes: ParsedApplyPatchChange[]
  diagnostics: ParsedApplyPatchDiagnostic[]
}

const CHANGE_PATTERN = /^([AMD])\s+(.+)$/
const DIAGNOSTIC_PATTERN = /^LSP errors detected in (.+), please fix:$/

function parseApplyPatchOutput(output: string): ParsedApplyPatchOutput {
  const changes: ParsedApplyPatchChange[] = []
  const diagnostics: ParsedApplyPatchDiagnostic[] = []
  let success = false
  let currentDiagnostic: ParsedApplyPatchDiagnostic | undefined

  for (const rawLine of splitLines(output)) {
    const line = rawLine.trim()

    if (line === "Success. Updated the following files:") {
      success = true
      currentDiagnostic = undefined
      continue
    }

    const changeMatch = line.match(CHANGE_PATTERN)
    if (changeMatch) {
      const marker = parseChangeMarker(changeMatch[1])
      const filePath = changeMatch[2]
      if (!marker || !filePath) {
        continue
      }

      changes.push({
        marker,
        filePath,
      })
      currentDiagnostic = undefined
      continue
    }

    const diagnosticMatch = line.match(DIAGNOSTIC_PATTERN)
    if (diagnosticMatch) {
      const filePath = diagnosticMatch[1]
      if (!filePath) {
        continue
      }

      currentDiagnostic = {
        filePath,
        lines: [],
      }
      diagnostics.push(currentDiagnostic)
      continue
    }

    if (currentDiagnostic && line) {
      currentDiagnostic.lines.push(rawLine)
    }
  }

  return { success, changes, diagnostics }
}

function parseChangeMarker(value: string | undefined): ParsedApplyPatchChange["marker"] | undefined {
  if (value === "A" || value === "M" || value === "D") {
    return value
  }

  return undefined
}

function splitLines(value: string): string[] {
  return value.split(/\r\n|\n|\r/)
}

export function ApplyPatchTool({ part }: ApplyPatchToolProps) {
  if (part.state === "input-streaming") {
    return (
      <div>
        <span className="text-muted-foreground">Applying patch</span>
      </div>
    )
  }

  if (part.state === "output-error") {
    return (
      <div>
        <span className="text-muted-foreground">Apply patch attempted</span>
      </div>
    )
  }

  if (part.state !== "output-available") {
    return null
  }

  const output = parseApplyPatchOutput(part.output)

  return (
    <CollapsibleTool>
      <CollapsibleToolStep className="flex flex-col gap-2">
        <CollapsibleToolTrigger disabled={!(output.changes.length > 0 || output.diagnostics.length > 0)}>
          <span className="flex min-w-0 gap-2">
            <span className="shrink-0">
              {output.success ? "Applied patch" : "Patch finished"}
              {output.changes.length > 0
                ? ` to ${output.changes.length} ${output.changes.length === 1 ? "file" : "files"}`
                : null}
            </span>
          </span>
        </CollapsibleToolTrigger>
        {output.changes.length > 0 || output.diagnostics.length > 0 ? (
          <CollapsibleToolContent className="bg-muted rounded-lg p-2">
            <div className="flex flex-col gap-2 text-xs">
              {output.changes.map((change) => (
                <div key={`${change.marker}-${change.filePath}`} className="font-mono">
                  {change.marker === "A" ? "Added" : change.marker === "D" ? "Deleted" : "Modified"}{" "}
                  {change.filePath}
                </div>
              ))}
              {output.diagnostics.map((diagnostic) => (
                <div key={diagnostic.filePath} className="font-mono">
                  <div>LSP errors detected in {diagnostic.filePath}</div>
                  {diagnostic.lines.map((line, index) => (
                    <div key={`${diagnostic.filePath}-${index}`} className="opacity-80">
                      {line}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </CollapsibleToolContent>
        ) : null}
      </CollapsibleToolStep>
    </CollapsibleTool>
  )
}
