"use client"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { getToolActivityLabel, isToolPartInFlight } from "@/lib/tool-activity"
import { cn } from "@/lib/utils"
import { ChevronDown, CircleAlert, LoaderCircle, Wrench } from "lucide-react"
import type { DynamicToolUIPart, ToolUIPart } from "ai"

export type ToolPart = ToolUIPart | DynamicToolUIPart

export type ToolProps = {
  title?: string
  toolPart: ToolPart
  defaultOpen?: boolean
  className?: string
}

const formatValue = (value: unknown): string => {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") return value
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2)
  }
  return String(value)
}

const Tool = ({ title, toolPart, defaultOpen = false, className }: ToolProps) => {
  const { state, input } = toolPart
  const inFlight = isToolPartInFlight(toolPart)
  const isError = state === "output-error"
  const label = title ?? getToolActivityLabel(toolPart)
  const hasInput = input !== null && input !== undefined
  const hasOutput = "output" in toolPart && toolPart.output !== undefined

  return (
    <Collapsible className={className} defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        className="group text-muted-foreground hover:text-foreground flex w-full min-w-0 cursor-pointer items-center justify-start gap-2 overflow-hidden text-start text-sm transition-colors"
      >
        <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
          <span className="transition-opacity group-hover:opacity-0">
            {inFlight ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : isError ? (
              <CircleAlert className="text-destructive size-4" />
            ) : (
              <Wrench className="size-3.5" />
            )}
          </span>
          <ChevronDown className="absolute size-4 opacity-0 transition-opacity group-hover:opacity-100 group-data-panel-open:rotate-180" />
        </span>
        <span className="min-w-0 truncate">{label}</span>
        {isError ? (
          <span className="text-destructive shrink-0 text-xs">failed</span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden text-sm transition-[height] duration-150 ease-out data-starting-style:h-0 data-ending-style:h-0 [&[hidden]:not([hidden='until-found'])]:hidden">
        <div className="bg-muted mt-2 flex flex-col gap-2 rounded-lg p-2 text-xs">
          {hasInput ? (
            <pre className="whitespace-pre-wrap wrap-break-word">
              {formatValue(input)}
            </pre>
          ) : null}
          {hasOutput ? (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap wrap-break-word opacity-80">
              {formatValue(toolPart.output)}
            </pre>
          ) : null}
          {isError && toolPart.errorText ? (
            <pre className="text-destructive whitespace-pre-wrap wrap-break-word">
              {toolPart.errorText}
            </pre>
          ) : null}
          {inFlight && !hasInput ? (
            <span className="text-muted-foreground">Waiting for input…</span>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export { Tool }
