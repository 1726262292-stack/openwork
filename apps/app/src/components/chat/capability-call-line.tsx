"use client"

import { useState } from "react"
import type { DynamicToolUIPart } from "ai"
import { ExternalLink, LoaderCircle, RefreshCcw } from "lucide-react"

import { attributeChatToolError } from "@/components/tools/error-attribution"
import {
  useChatToolReconnect,
  type ChatToolReconnectCallbacks,
} from "@/components/tools/use-chat-tool-reconnect"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { DotMatrixLoader } from "@/components/ui/dot-matrix-loader"
import { getCapabilityCallSentence, parseRecord } from "@/lib/capability-call"
import { trackToolCallDuration } from "@/lib/tool-call-duration"
import { isToolPartInFlight } from "@/lib/tool-activity"
import { cn } from "@/lib/utils"

type CapabilityCallLineProps = ChatToolReconnectCallbacks & {
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

/** One human sentence explaining what to do about a failed call. */
function failureInstruction(part: DynamicToolUIPart, reconnectName: string | null): string {
  if (reconnectName) {
    return `${reconnectName} needs a fresh sign-in — reconnect it, then retry.`
  }
  const errorText = part.state === "output-error" ? part.errorText : null
  const attribution = errorText ? attributeChatToolError(errorText) : null
  if (attribution) return attribution.description

  // Structured provider errors ({ error, details: [{ message }] }) should
  // read as a sentence, never as raw JSON.
  const record = errorText ? parseRecord(errorText) : null
  if (record) {
    const code = typeof record.error === "string" ? record.error : null
    const detailMessage = Array.isArray(record.details)
      ? record.details
        .map((detail) => (typeof detail === "object" && detail !== null && "message" in detail && typeof detail.message === "string" ? detail.message : null))
        .find((message) => message)
      : null
    const message = detailMessage ?? (typeof record.message === "string" ? record.message : null)
    const summary = [code?.replace(/_/g, " "), message].filter(Boolean).join(" — ")
    if (summary) return `The provider rejected the call: ${summary}.`
  }

  const firstLine = errorText?.split("\n")[0]?.trim()
  if (firstLine && !firstLine.startsWith("{") && !firstLine.startsWith("[")) return firstLine
  return "The call failed. Full error is under Technical details."
}

/**
 * Paper "Capability calls → sentences" + "No icon per tool call":
 * a plain muted text line — dot-matrix while running, small green dot
 * when done, past-tense verb with duration. IDs, schema digests, and
 * raw payloads live under a collapsed "Technical details" section.
 * Failures follow "Failures are instructions": same neutral dot, one
 * line saying what to do next, and an inline Reconnect/Retry button
 * when the error maps to a known connection. No traffic-light colors.
 */
export function CapabilityCallLine({
  part,
  className,
  onReconnect,
  onReopenAuthorization,
  onRetry,
}: CapabilityCallLineProps) {
  const [open, setOpen] = useState(false)
  const inFlight = isToolPartInFlight(part)
  const isFailed = part.state === "output-error"
  const sentence = getCapabilityCallSentence(part)
  const duration = trackToolCallDuration(part)
  const line = inFlight ? sentence.present : sentence.past
  const { reconnectAction, reconnectState, reconnectError, reconnectPresentation, handleReconnect } =
    useChatToolReconnect(part, { onReconnect, onReopenAuthorization, onRetry })
  const ReconnectIcon = reconnectState === "opening"
    ? LoaderCircle
    : reconnectState === "authorization_opened"
      ? ExternalLink
      : RefreshCcw

  return (
    <Collapsible data-capability-call={part.toolName} open={open} onOpenChange={setOpen} className={className}>
      <div className="flex min-w-0 items-center gap-2">
        <CollapsibleTrigger
          className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-start text-sm text-muted-foreground transition-colors hover:text-foreground"
          aria-label={open ? `${line}. Hide technical details` : `${line}. Show technical details`}
        >
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            {inFlight ? (
              <DotMatrixLoader label={line} className="text-muted-foreground" />
            ) : (
              <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground/60" />
            )}
          </span>
          <span className="min-w-0 truncate">{line}</span>
          {isFailed ? <span className="shrink-0 text-xs text-muted-foreground">failed</span> : null}
          {duration ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{duration}</span>
          ) : null}
        </CollapsibleTrigger>
        {isFailed && reconnectAction && onReconnect ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className={cn(
              "h-7 shrink-0 gap-1.5 rounded-lg px-2.5 font-semibold shadow-none before:shadow-none",
              reconnectState === "connected"
                ? "border-green-7/40 bg-green-3/60 text-green-11 hover:border-green-7/60 hover:bg-green-4/70"
                : reconnectState === "failed"
                  ? "border-destructive/30 bg-destructive/5 text-destructive hover:border-destructive/50 hover:bg-destructive/10"
                  : "border-amber-7/40 bg-amber-3/60 text-amber-11 hover:border-amber-7/60 hover:bg-amber-4/70",
            )}
            data-testid="chat-mcp-reconnect-action"
            disabled={reconnectPresentation?.disabled}
            title={`${reconnectPresentation?.buttonLabel} ${reconnectAction.connectionName}`}
            aria-label={`${reconnectPresentation?.buttonLabel} ${reconnectAction.connectionName}`}
            onClick={() => void handleReconnect()}
          >
            <ReconnectIcon
              data-icon="inline-start"
              className={cn("size-3.5", reconnectState === "opening" && "animate-spin")}
              aria-hidden="true"
            />
            {reconnectPresentation?.buttonLabel}
          </Button>
        ) : null}
      </div>
      {isFailed ? (
        <p className="mt-1 ps-5.5 text-xs text-muted-foreground">
          {failureInstruction(part, reconnectAction?.connectionName ?? null)}
        </p>
      ) : null}
      {reconnectError ? (
        <p className="mt-1 ps-5.5 text-xs text-destructive" role="alert">{reconnectError}</p>
      ) : null}
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
          {isFailed && part.errorText ? (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap wrap-break-word opacity-80">
              {part.errorText}
            </pre>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
