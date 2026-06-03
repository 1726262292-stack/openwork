"use client"

import type { LspInput, LspToolPart } from "@/lib/build-in-tools"
import { parseFilename } from "@/components/tools/path"
import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "@/components/tools/collapsible-tool"

interface LspToolProps {
  part: LspToolPart
}

type ParsedLspOutput =
  | { type: "results"; results: unknown[] }
  | { type: "empty" }
  | { type: "raw"; content: string }

const LSP_OPERATION_LABELS: Record<LspInput["operation"], string> = {
  goToDefinition: "Go to definition",
  findReferences: "Find references",
  hover: "Hover",
  documentSymbol: "Document symbols",
  workspaceSymbol: "Workspace symbols",
  goToImplementation: "Go to implementation",
  prepareCallHierarchy: "Prepare call hierarchy",
  incomingCalls: "Incoming calls",
  outgoingCalls: "Outgoing calls",
}

function parseLspOutput(output: string): ParsedLspOutput {
  const trimmed = output.trim()
  if (!trimmed || trimmed.startsWith("No results found")) {
    return { type: "empty" }
  }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed.length === 0 ? { type: "empty" } : { type: "results", results: parsed }
    }
  } catch {
    // Non-JSON LSP output is still useful as raw details.
  }

  return { type: "raw", content: output }
}

export function LspTool({ part }: LspToolProps) {
  const detail = part.input.query
    ? `L${part.input.line}:${part.input.character} · ${part.input.query}`
    : `L${part.input.line}:${part.input.character}`

  if (part.state === "input-streaming") {
    return (
      <div>
        <span className="text-muted-foreground">
          Running {LSP_OPERATION_LABELS[part.input.operation].toLowerCase()} in {parseFilename(part.input.filePath)} {detail}
        </span>
      </div>
    )
  }

  if (part.state === "output-error") {
    return (
      <div>
        <span className="text-muted-foreground">
          {LSP_OPERATION_LABELS[part.input.operation]} attempted in {parseFilename(part.input.filePath)} {detail}
        </span>
      </div>
    )
  }

  if (part.state !== "output-available") {
    return null
  }

  const output = parseLspOutput(part.output)

  return (
    output.type === "empty" ? (
      <div>
        <span className="text-muted-foreground">
          {LSP_OPERATION_LABELS[part.input.operation]} in {parseFilename(part.input.filePath)} {detail} no results
        </span>
      </div>
    ) : (
      <CollapsibleTool>
        <CollapsibleToolStep className="flex flex-col gap-2">
          <CollapsibleToolTrigger>
            <span className="flex min-w-0 gap-2">
              <span className="shrink-0">
                {LSP_OPERATION_LABELS[part.input.operation]} in {parseFilename(part.input.filePath)}
              </span>
              <span className="grow truncate opacity-80">{detail}</span>
              {output.type === "results" ? (
                <span className="shrink-0 opacity-80">
                  {output.results.length} {output.results.length === 1 ? "result" : "results"}
                </span>
              ) : null}
            </span>
          </CollapsibleToolTrigger>
          <CollapsibleToolContent className="bg-muted rounded-lg p-2">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word text-xs">
              {output.type === "results" ? JSON.stringify(output.results, null, 2) : output.content}
            </pre>
          </CollapsibleToolContent>
        </CollapsibleToolStep>
      </CollapsibleTool>
    )
  )
}
