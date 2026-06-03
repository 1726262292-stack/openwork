"use client"

import type { GrepToolPart } from "@/lib/build-in-tools"
import { parseFilename, truncateText } from "@/components/tools/path"
import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "./collapsible-tool"

interface GrepToolProps {
  part: GrepToolPart
}

interface ParsedGrepLine {
  number: number
  text: string
}

interface ParsedGrepFile {
  filePath: string
  lines: ParsedGrepLine[]
}

interface ParsedGrepOutput {
  files: ParsedGrepFile[]
  matchCount?: number
  shownLimit?: number
  truncated: boolean
  skippedPaths: boolean
  empty: boolean
}

const NO_FILES_FOUND = "No files found"
const HEADER_PATTERN = /^Found (\d+) matches(?: \(showing first (\d+)\))?$/
const FILE_PATTERN = /^(.+):$/
const LINE_PATTERN = /^\s+Line (\d+): ?(.*)$/
const TRUNCATED_PATTERN = /^\(Results truncated: showing (\d+) of (\d+) matches \((\d+) hidden\)\. Consider using a more specific path or pattern\.\)$/
const SKIPPED_PATHS = "(Some paths were inaccessible and skipped)"

function parseGrepOutput(output: string): ParsedGrepOutput {
  const files: ParsedGrepFile[] = []
  let currentFile: ParsedGrepFile | undefined
  let matchCount: number | undefined
  let shownLimit: number | undefined
  let truncated = false
  let skippedPaths = false
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

    if (line === SKIPPED_PATHS) {
      skippedPaths = true
      continue
    }

    const headerMatch = line.match(HEADER_PATTERN)
    if (headerMatch) {
      matchCount = parseOptionalNumber(headerMatch[1])
      shownLimit = parseOptionalNumber(headerMatch[2])
      continue
    }

    const truncatedMatch = line.match(TRUNCATED_PATTERN)
    if (truncatedMatch) {
      truncated = true
      shownLimit = parseOptionalNumber(truncatedMatch[1])
      matchCount = parseOptionalNumber(truncatedMatch[2])
      continue
    }

    const lineMatch = rawLine.match(LINE_PATTERN)
    if (lineMatch && currentFile) {
      const lineNumber = parseOptionalNumber(lineMatch[1])
      if (lineNumber === undefined) {
        continue
      }

      currentFile.lines.push({
        number: lineNumber,
        text: lineMatch[2] ?? "",
      })
      continue
    }

    const fileMatch = line.match(FILE_PATTERN)
    if (fileMatch) {
      const filePath = fileMatch[1]
      if (!filePath) {
        continue
      }

      currentFile = {
        filePath,
        lines: [],
      }
      files.push(currentFile)
    }
  }

  return {
    files,
    matchCount,
    shownLimit,
    truncated,
    skippedPaths,
    empty: empty || (matchCount === 0 && files.length === 0),
  }
}

function parseOptionalNumber(value: string | undefined) {
  if (!value) {
    return undefined
  }

  return Number(value)
}

function splitLines(value: string): string[] {
  return value.split(/\r\n|\n|\r/)
}

export function GrepTool({ part }: GrepToolProps) {
  const target = part.input.path ? parseFilename(part.input.path) : "workspace"

  if (part.state === "input-streaming") {
    return (
      <div>
        <span className="text-muted-foreground">
          Searching code in {target}
          {part.input.pattern ? ` for ${truncateText(part.input.pattern, 44)}` : null}
        </span>
      </div>
    )
  }

  if (part.state === "output-error") {
    return (
      <div>
        <span className="text-muted-foreground">
          Search attempted in {target}
          {part.input.pattern ? ` for ${truncateText(part.input.pattern, 44)}` : null}
        </span>
      </div>
    )
  }

  if (part.state !== "output-available") {
    return null
  }

  const output = parseGrepOutput(part.output)

  return (
    output.empty || output.matchCount === 0 ? (
      <div>
        <span className="text-muted-foreground">
          Searched code in {target}
          {part.input.pattern ? ` for ${truncateText(part.input.pattern, 44)}` : null}
          {" "}
          <span className="text-muted-foreground">no matches found</span>
        </span>
      </div>
    ) : (
      <CollapsibleTool>
        <CollapsibleToolStep className="flex flex-col gap-2">
          <CollapsibleToolTrigger>
            <span className="flex min-w-0 gap-2">
              <span className="shrink-0">
                Found {output.matchCount} {output.matchCount === 1 ? "match" : "matches"} in {output.files.length}{" "}
                {output.files.length === 1 ? "file" : "files"}
                {" "}in {target}
              </span>
              {part.input.pattern ? (
                <span className="grow truncate opacity-80">
                  {part.input.pattern}
                </span>
              ) : null}
              {part.input.include ? (
                <span className="shrink-0 opacity-80">
                  {part.input.include}
                </span>
              ) : null}
              {output.truncated && output.shownLimit ? (
                <span className="shrink-0 opacity-80">
                  Showing first {output.shownLimit}
                </span>
              ) : null}
            </span>
          </CollapsibleToolTrigger>
          <CollapsibleToolContent className="bg-muted rounded-lg p-2">
            <div className="flex flex-col gap-3 text-xs">
              {output.files.map((file) => (
                <div key={file.filePath} className="flex flex-col gap-1">
                  <div className="font-mono">{file.filePath}</div>
                  {file.lines.map((line) => (
                    <div key={`${file.filePath}-${line.number}-${line.text}`} className="font-mono opacity-80">
                      Line {line.number}: {line.text}
                    </div>
                  ))}
                </div>
              ))}
              {output.skippedPaths ? (
                <div className="font-mono opacity-80">
                  Some paths were inaccessible and skipped
                </div>
              ) : null}
            </div>
          </CollapsibleToolContent>
        </CollapsibleToolStep>
      </CollapsibleTool>
    )
  )
}
