"use client"

import type { EditToolPart } from "@/lib/build-in-tools"
import { parseFilename } from "@/components/tools/path"
import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "./collapsible-tool"

interface EditToolProps {
  part: EditToolPart
}

interface ParsedEditOutput {
  diagnostics: string[]
}

const DIAGNOSTIC_HEADER = "LSP errors detected in this file, please fix:"

function parseEditOutput(output: string): ParsedEditOutput {
  const diagnostics: string[] = []
  let readingDiagnostics = false

  for (const rawLine of splitLines(output)) {
    const line = rawLine.trim()

    if (line === "Edit applied successfully.") {
      continue
    }

    if (line === DIAGNOSTIC_HEADER) {
      readingDiagnostics = true
      continue
    }

    if (readingDiagnostics && line) {
      diagnostics.push(rawLine)
    }
  }

  return { diagnostics }
}

function splitLines(value: string): string[] {
  return value.split(/\r\n|\n|\r/)
}

export function EditTool({ part }: EditToolProps) {
  const filename = parseFilename(part.input.filePath)

  if (part.state === "input-streaming") {
    return (
      <div>
        <span className="text-muted-foreground">Editing {filename}</span>
      </div>
    )
  }

  if (part.state === "output-error") {
    return (
      <div>
        <span className="text-muted-foreground">Edit attempted {filename}</span>
      </div>
    )
  }

  if (part.state !== "output-available") {
    return null
  }

  const output = parseEditOutput(part.output)

  return (
    <CollapsibleTool>
      <CollapsibleToolStep className="flex flex-col gap-2">
        <CollapsibleToolTrigger>
          <span className="flex min-w-0 gap-2">
            <span className="shrink-0">
              Edited {filename}
            </span>
          </span>
        </CollapsibleToolTrigger>
        {output.diagnostics.length > 0 ? (
          <CollapsibleToolContent className="bg-muted rounded-lg p-2">
            <div className="flex flex-col gap-2 text-xs">
              {output.diagnostics.map((line, index) => (
                <div key={`${line}-${index}`} className="font-mono">
                  {line}
                </div>
              ))}
            </div>
          </CollapsibleToolContent>
        ) : null}
      </CollapsibleToolStep>
    </CollapsibleTool>
  )
}
