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
      return `${payload.connectionName} or your organization admin needs to fix provider configuration.`
    case "org_admin":
    case "organization_admin":
    case "platform_admin":
      return "Your organization admin needs to fix this connection."
    default:
      return "This can't be fixed from this app right now."
  }
}

function isMemberReconnect(payload: ConnectionStatusPayload): boolean {
  return payload.actor === null || payload.actor === "member"
}

/**
 * Inline chat card for a broken Cloud connection surfaced by a capability
 * tool result. Reconnect attempts land on Settings → Connect with the
 * connector highlighted; admin/provider-owned failures keep honest caveats.
 * The diagnostic reference and raw payload stay available under a disclosure.
 */
export function ConnectionStatusTool({ part, payload }: ConnectionStatusToolProps) {
  const navigate = useNavigate()
  const [copied, setCopied] = React.useState(false)
  const memberReconnect = isMemberReconnect(payload)
  const title = payload.canAttemptReconnect
    ? memberReconnect
      ? `${payload.connectionName} needs you to sign in again`
      : `${payload.connectionName} rejected sign-in`
    : `${payload.connectionName} isn't working right now`
  const description = payload.canAttemptReconnect
    ? memberReconnect
      ? "Its sign-in expired or was revoked. Reconnect your account, then ask the agent to try again."
      : `The provider rejected sign-in or token refresh. You can try reconnecting; if it fails again, ${payload.connectionName} or your organization admin may need to fix provider configuration.`
    : (payload.message ?? "The connection returned an error.")
  const statusLabel = payload.canAttemptReconnect
    ? memberReconnect
      ? "Needs sign-in"
      : "Provider may need a fix"
    : "Needs attention"
  const reconnectLabel = memberReconnect
    ? `Reconnect ${payload.connectionName}`
    : `Try reconnecting to ${payload.connectionName}`

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
      className="not-prose w-full max-w-lg rounded-2xl border border-dls-border bg-dls-surface/95 p-3.5 shadow-sm"
    >
      <div className="flex items-start gap-3.5">
        <div className="relative flex size-10 shrink-0 items-center justify-center rounded-2xl border border-dls-border bg-dls-sidebar/70 text-base font-semibold text-dls-primary shadow-sm">
          {payload.connectionName.slice(0, 1).toUpperCase()}
          <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border border-dls-surface bg-amber-3 text-amber-11">
            <Unplug className="size-2.5" />
          </span>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-[11px] font-medium tracking-[0.16em] text-dls-tertiary uppercase">
                Cloud connection
              </p>
              <h3 className="truncate text-base leading-5 font-semibold text-dls-primary">
                {payload.connectionName}
              </h3>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-6/35 bg-amber-3/20 px-2 py-0.5 text-[11px] font-medium text-amber-11">
              <span className="size-1.5 rounded-full bg-amber-9" />
              {statusLabel}
            </span>
          </div>

          <div className="space-y-1">
            <p className="text-sm leading-5 font-medium text-dls-primary">{title}</p>
            <p className="text-xs leading-5 text-dls-secondary">{description}</p>
          </div>

          {payload.canAttemptReconnect ? (
            <Button
              size="sm"
              onClick={() =>
                navigate("/settings/connect", {
                  state: { focusConnection: payload.connectionName },
                })
              }
            >
              {reconnectLabel}
            </Button>
          ) : (
            <div className="rounded-xl border border-dls-border/70 bg-dls-sidebar/40 px-3 py-2 text-xs leading-5 text-dls-secondary">
              <p>
                {actorDescription(payload)}
              </p>
              {payload.actionLabel ? (
                <p className="mt-1 text-[11px] text-dls-tertiary">{payload.actionLabel}</p>
              ) : null}
            </div>
          )}

          <Tool toolPart={part} title="Technical details" className="pt-0.5">
            {payload.diagnosticReferenceId ? (
              <div className="border-border/70 border-t pt-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-dls-secondary">
                    Diagnostic reference
                  </span>
                  <code className="min-w-0 truncate rounded-md bg-dls-surface/80 px-2 py-1 font-mono text-[11px] text-dls-secondary">
                    {payload.diagnosticReferenceId}
                  </code>
                  <Button size="xs" variant="ghost" onClick={() => void copyDiagnostic()}>
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy reference"}
                  </Button>
                </div>
              </div>
            ) : null}
          </Tool>
        </div>
      </div>
    </div>
  )
}
