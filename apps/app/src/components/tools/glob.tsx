"use client"

import type { GlobToolPart } from "@/lib/build-in-tools"
import { parseFilename, truncateText } from "@/components/tools/path"
import { CollapsibleTool, CollapsibleToolStep, CollapsibleToolTrigger, CollapsibleToolContent } from "./collapsible-tool"
import { FolderSearchIcon } from "lucide-react"

interface GlobToolProps {
  part: GlobToolPart
}

interface ParsedGlobOutput {
  files: string[]
  truncated: boolean
  limit?: number
  empty: boolean
}

const NO_FILES_FOUND = "No files found"
const TRUNCATED_PATTERN = /^\(Results are truncated: showing first (\d+) results\. Consider using a more specific path or pattern\.\)$/

function parseGlobOutput(output: string): ParsedGlobOutput {
  const files: string[] = []
  let truncated = false
  let limit: number | undefined
  let empty = false

  for (const rawLine of splitLines(output)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    if (line === NO_FILES_FOUND) {
      empty = true
      continue
    }

    const truncatedMatch = line.match(TRUNCATED_PATTERN)
    if (truncatedMatch) {
      truncated = true
      limit = Number(truncatedMatch[1])
      continue
    }

    files.push(rawLine)
  }

  return {
    files,
    truncated,
    limit,
    empty: files.length === 0,
  }
}

function splitLines(value: string): string[] {
  return value.split(/\r\n|\n|\r/)
}

export function GlobTool({ part }: GlobToolProps) {
  const pattern = part.input.pattern.trim()

  if (part.state === "input-streaming") {
    return (
      <div>
        <span className="text-muted-foreground">
          Searching files in {part.input.path ? parseFilename(part.input.path) : "workspace"}
          {pattern ? ` for ${truncateText(pattern, 44)}` : null}
        </span>
      </div>
    )
  }

  if (part.state === "output-error") {
    return (
      <div>
        <span className="text-muted-foreground">
          Search attempted in {part.input.path ? parseFilename(part.input.path) : "workspace"}
          {pattern ? ` for ${truncateText(pattern, 44)}` : null}
        </span>
      </div>
    )
  }

  if (part.state !== "output-available") {
    return null
  }

  const output = parseGlobOutput(part.output)

  if (output.empty) {
    return (
      <div>
        <span className="text-muted-foreground">
          Searched files in {part.input.path ? parseFilename(part.input.path) : "workspace"}
          {pattern ? ` for ${truncateText(pattern, 44)}` : null}
          {" "}
          <span className="text-muted-foreground">no files found</span>
        </span>
      </div>
    )
  }

  return (
    <CollapsibleTool>
      <CollapsibleToolStep className="flex flex-col gap-2">
        <CollapsibleToolTrigger leftIcon={<FolderSearchIcon className="size-4" />}>
          <span className="flex min-w-0 gap-2">
            <span className="shrink-0">
              Searched {output.files.length} {output.files.length === 1 ? "file" : "files"} in {part.input.path ? parseFilename(part.input.path) : "workspace"}
            </span>
            {pattern ? (
              <span className="grow truncate opacity-80">
                {pattern}
              </span>
            ) : null}
            {output.truncated && output.limit ? (
              <span className="shrink-0 opacity-80">
                Limit at {output.limit}
              </span>
            ) : null}
          </span>
        </CollapsibleToolTrigger>
        <CollapsibleToolContent className="bg-muted rounded-lg p-2">
          <div className="flex flex-col gap-2 text-xs">
            {output.files.map((file, index) => (
              <div key={`${file}-${index}`} className="font-mono">
                {file}
              </div>
            ))}
          </div>
        </CollapsibleToolContent>
      </CollapsibleToolStep>
    </CollapsibleTool>
  )
}
