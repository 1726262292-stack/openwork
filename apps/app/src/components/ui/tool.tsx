"use client"

import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "@/components/tools/collapsible-tool"
import { CheckCircle, Loader2, Settings, XCircle } from "lucide-react"
import type { DynamicToolUIPart, ToolUIPart } from "ai"
import { cn } from "@/lib/utils"

type ToolPartState = ToolUIPart["state"] | DynamicToolUIPart["state"]

interface StateBadgeProps {
  className?: string
  state: ToolPartState
}

function StateBadge({ className, state }: StateBadgeProps) {
  if (state === "output-error") {
    return <span className={cn(className)}>Error</span>
  }
}

interface StateIconProps {
  className?: string
  state: ToolPartState
}

function StateIcon({ className, state }: StateIconProps) {
  if (state === "input-streaming") {
    return <Loader2 className={cn(className, "h-4 w-4 animate-spin text-blue-500")} />
  }

  if (state === "input-available") {
    return <Settings className={cn(className, "h-4 w-4 text-orange-500")} />
  }

  if (state === "output-available") {
    return <CheckCircle className={cn(className, "h-4 w-4 text-green-500")} />
  }

  if (state === "output-error") {
    return <XCircle className={cn(className, "h-4 w-4 text-red-500")} />
  }

  return <Settings className={cn(className, "text-muted-foreground h-4 w-4")} />
}

const formatValue = (value: unknown): string => {
  if (value === null) {
       return "null" 
  }

  if (value === undefined) {
    return "undefined"
  }

  if (typeof value === "string") {
    return value
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2)
  }

  return String(value)
}

export type ToolProps = {
  title?: string
  toolPart: ToolUIPart | DynamicToolUIPart
  defaultOpen?: boolean
  className?: string
}

const Tool = ({ title, toolPart, defaultOpen = false, className }: ToolProps) => {
  const { state, input, output, toolCallId } = toolPart

  const toolName =
    toolPart.type === "dynamic-tool" ? toolPart.toolName : toolPart.type

  const hasInput = input !== null && input !== undefined
  const hasOutput = "output" in toolPart && toolPart.output !== undefined

  return (
    <CollapsibleTool className={className}>
      <CollapsibleToolStep defaultOpen={defaultOpen} className="flex flex-col gap-2">
        <CollapsibleToolTrigger leftIcon={<StateIcon state={state} />}>
          <span className="flex gap-2">
            <span className="shrink-0">{title || toolName}</span>
            <StateBadge className="px-2 py-1 rounded-full text-xs font-medium" state={state} />
          </span>
        </CollapsibleToolTrigger>
        <CollapsibleToolContent className="bg-muted space-y-3 rounded-lg p-2">
          {hasInput && (
            <div>
              <h4 className="text-muted-foreground mb-2 text-sm font-medium">
                Input
              </h4>
              <div className="bg-background rounded p-2 font-mono text-sm">
                <pre className="whitespace-pre-wrap wrap-break-word">
                  {formatValue(input)}
                </pre>
              </div>
            </div>
          )}

          {hasOutput && (
            <div>
              <h4 className="text-muted-foreground mb-2 text-sm font-medium">
                Output
              </h4>
              <div className="bg-background max-h-60 overflow-auto rounded p-2 font-mono text-sm">
                <pre className="whitespace-pre-wrap wrap-break-word">
                  {formatValue(toolPart.output)}
                </pre>
              </div>
            </div>
          )}

          {state === "output-error" && toolPart.errorText && (
            <div>
              <h4 className="mb-2 text-sm font-medium text-red-500">Error</h4>
              <div className="bg-background rounded p-2 text-sm dark:bg-red-900/20">
                {toolPart.errorText}
              </div>
            </div>
          )}

          {state === "input-streaming" && (
            <div className="text-muted-foreground text-sm">
              Processing tool call...
            </div>
          )}

          {toolCallId && (
            <div className="text-muted-foreground pt-2 text-xs">
              <span className="font-mono">Call ID: {toolCallId}</span>
            </div>
          )}
        </CollapsibleToolContent>
      </CollapsibleToolStep>
    </CollapsibleTool>
  )
}

export { Tool }
