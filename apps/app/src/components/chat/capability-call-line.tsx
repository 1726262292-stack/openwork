"use client"

import { useState } from "react"
import type { DynamicToolUIPart } from "ai"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { DotMatrixLoader } from "@/components/ui/dot-matrix-loader"
import { getCapabilityCallSentence } from "@/lib/capability-call"
import { trackToolCallDuration } from "@/lib/tool-call-duration"
import { isToolPartInFlight } from "@/lib/tool-activity"
import { cn } from "@/lib/utils"

type CapabilityCallLineProps = {
  part: DynamicToolUIPart
  className?: string
}

function formatTechnicalValue(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Paper "Capability calls → sentences" + "No icon per tool call":
 * a plain muted text line — dot-matrix while running, small green dot
 * when done, past-tense verb with duration. IDs, schema digests, and
 * raw payloads live under a collapsed "Technical details" section.
 */
export function CapabilityCallLine({ part, className }: CapabilityCallLineProps) {
  const [open, setOpen] = useState(false)
  const inFlight = isToolPartInFlight(part)
  const sentence = getCapabilityCallSentence(part)
  const duration = trackToolCallDuration(part)
  const line = inFlight ? sentence.present : sentence.past

  return (
    <Collapsible data-capability-call={part.toolName} open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger
        className="group flex min-w-0 max-w-full cursor-pointer items-center gap-2 text-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        aria-label={open ? `${line}. Hide technical details` : `${line}. Show technical details`}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          {inFlight ? (
            <DotMatrixLoader label={line} className="text-muted-foreground" />
          ) : (
            <span aria-hidden="true" className="size-1.5 rounded-full bg-green-9" />
          )}
        </span>
        <span className="min-w-0 truncate">{line}</span>
        {duration ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{duration}</span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out data-starting-style:h-0 data-ending-style:h-0 [&[hidden]:not([hidden='until-found'])]:hidden">
        <div className="mt-2 flex flex-col gap-2 rounded-lg bg-muted p-2 text-xs">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Technical details
          </div>
          <div className={cn("text-muted-foreground", "font-mono text-[11px]")}>
            {part.toolName} · {part.toolCallId}
          </div>
          {part.input !== undefined && part.input !== null ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word">
              {formatTechnicalValue(part.input)}
            </pre>
          ) : null}
          {"output" in part && part.output !== undefined ? (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap wrap-break-word opacity-80">
              {formatTechnicalValue(part.output)}
            </pre>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
