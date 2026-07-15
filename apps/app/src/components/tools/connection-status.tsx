"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Tool, type ToolPart } from "@/components/ui/tool"
import { resolveExtensionIconUrl } from "@/react-app/design-system/extension-icon-src"
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
  const [failedIconUrl, setFailedIconUrl] = React.useState<string | null>(null)
  const memberReconnect = isMemberReconnect(payload)
  const iconUrl = resolveExtensionIconUrl({ serviceUrl: payload.serviceUrl ?? undefined })
  const showLogo = iconUrl ? failedIconUrl !== iconUrl : false
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
      className="not-prose w-full max-w-lg py-1"
    >
      <div className="flex items-start gap-3.5">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-dls-sidebar/70 text-base font-semibold text-dls-primary">
          {showLogo && iconUrl ? (
            <img
              alt=""
              aria-hidden="true"
              className="size-full object-cover"
              src={iconUrl}
              onError={() => setFailedIconUrl(iconUrl)}
            />
          ) : (
            payload.connectionName.slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-base leading-5 font-semibold text-dls-primary">
                {payload.connectionName}
              </h3>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-dls-secondary">
                <span className="size-1.5 rounded-full bg-amber-9" />
                {statusLabel}
              </span>
            </div>
            <p className="text-sm leading-5 font-medium text-dls-primary">{title}</p>
            <p className="text-xs leading-5 text-dls-secondary">{description}</p>
          </div>

          {payload.canAttemptReconnect ? (
            <div className="flex items-center gap-2">
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
            </div>
          ) : (
            <div className="flex flex-col gap-1 text-xs leading-5 text-dls-secondary">
              <p>
                {actorDescription(payload)}
              </p>
              {payload.actionLabel ? (
                <p className="text-[11px] text-dls-tertiary">{payload.actionLabel}</p>
              ) : null}
            </div>
          )}

          <Tool toolPart={part} title="Technical details" className="pt-0.5">
            {payload.diagnosticReferenceId ? (
              <div className="flex flex-col gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-dls-secondary">
                    Diagnostic reference
                  </span>
                  <code className="min-w-0 truncate font-mono text-[11px] text-dls-secondary">
                    {payload.diagnosticReferenceId}
                  </code>
                  <Button size="xs" variant="ghost" onClick={() => void copyDiagnostic()}>
                    {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
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
