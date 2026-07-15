"use client"

import * as React from "react"
import { Check, Copy, Unplug } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Tool, type ToolPart } from "@/components/ui/tool"
import type { ConnectionStatusPayload } from "@/react-app/domains/connections/connection-status-payload"

interface ConnectionStatusToolProps {
  part: ToolPart
  payload: ConnectionStatusPayload
}

function actorDescription(payload: ConnectionStatusPayload): string {
  switch (payload.actor) {
    case "provider_admin":
      return `This needs a fix on the ${payload.connectionName} provider side.`
    case "org_admin":
    case "platform_admin":
      return "This needs a fix from your organization admin."
    default:
      return "This can't be fixed from this app right now."
  }
}

/**
 * Inline chat card for a broken Cloud connection surfaced by a capability
 * tool result. Reconnectable (per-member OAuth) failures get a Reconnect
 * button that lands on Settings → Connect with the connector highlighted;
 * failures owned by someone else degrade honestly to who must act plus the
 * diagnostic reference. The raw payload stays available under a disclosure.
 */
export function ConnectionStatusTool({ part, payload }: ConnectionStatusToolProps) {
  const navigate = useNavigate()
  const [copied, setCopied] = React.useState(false)

  const copyDiagnostic = React.useCallback(async () => {
    if (!payload.diagnosticReferenceId) return
    try {
      await navigator.clipboard.writeText(payload.diagnosticReferenceId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard failures
    }
  }, [payload.diagnosticReferenceId])

  return (
    <div
      data-testid="connection-status-card"
      data-connection-name={payload.connectionName}
      className="not-prose w-full max-w-xl rounded-2xl border border-amber-6/50 bg-dls-surface/95 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-amber-6/40 bg-amber-3/30 text-amber-11">
          <Unplug className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-dls-primary">
              {payload.canReconnect
                ? `${payload.connectionName} needs you to sign in again`
                : `${payload.connectionName} isn't working right now`}
            </h3>
            <p className="text-xs leading-5 text-dls-secondary">
              {payload.canReconnect
                ? "Its sign-in expired or was revoked. Reconnect your account, then ask the agent to try again."
                : (payload.message ?? "The connection returned an error.")}
            </p>
          </div>

          {payload.canReconnect ? (
            <Button
              size="sm"
              onClick={() =>
                navigate("/settings/connect", {
                  state: { focusConnection: payload.connectionName },
                })
              }
            >
              Reconnect {payload.connectionName}
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="rounded-lg border border-amber-6/40 bg-amber-3/20 px-3 py-2 text-xs text-amber-11">
                {actorDescription(payload)}
                {payload.actionLabel ? ` ${payload.actionLabel}` : ""}
              </p>
              {payload.diagnosticReferenceId ? (
                <div className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 truncate rounded-md bg-dls-sidebar/60 px-2 py-1 font-mono text-[11px] text-dls-secondary">
                    {payload.diagnosticReferenceId}
                  </code>
                  <Button size="sm" variant="ghost" onClick={() => void copyDiagnostic()}>
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy reference"}
                  </Button>
                </div>
              ) : null}
            </div>
          )}

          <Tool toolPart={part} title="Technical details" />
        </div>
      </div>
    </div>
  )
}
