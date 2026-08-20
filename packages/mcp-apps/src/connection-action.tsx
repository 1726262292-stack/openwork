import { connectionActionPayloadSchema, type ConnectionActionPayload } from "@openwork/types/connection-action-app"
import { mountMcpApp } from "./shared/bridge"
import { AlertIcon, AppHeader, ArrowIcon, CheckIcon, KeyValueGrid, PlugIcon, type Tone } from "./shared/ui"
import "./shared/theme.css"

type BadgeTone = Exclude<Tone, "brand">

const STATE_PRESENTATION: Record<ConnectionActionPayload["state"], {
  tone: Tone
  badgeTone: BadgeTone
  badge: string
  eyebrow: string
}> = {
  connected: { tone: "success", badgeTone: "success", badge: "Connected", eyebrow: "Connection ready" },
  needs_connection: { tone: "warning", badgeTone: "warning", badge: "Not connected", eyebrow: "Connection needed" },
  reauth_required: { tone: "warning", badgeTone: "warning", badge: "Sign-in required", eyebrow: "Reconnect needed" },
  provider_error: { tone: "danger", badgeTone: "danger", badge: "Provider error", eyebrow: "Connection error" },
}

const ACTOR_LABEL: Record<NonNullable<ConnectionActionPayload["actor"]>, string> = {
  member: "You",
  organization_admin: "An organization admin",
  provider_admin: "The provider admin",
  network_admin: "A network admin",
  openwork: "OpenWork support",
}

const SURFACE_LABEL: Record<NonNullable<ConnectionActionPayload["action"]>["surface"], string> = {
  openwork_your_connections: "Your Connections",
  openwork_organization_connections: "Organization Connections",
  provider_admin_console: "Provider admin console",
  network_infrastructure: "Network infrastructure",
  openwork_support: "OpenWork support",
}

mountMcpApp({
  name: "OpenWork Connection Action",
  waitingLabel: "Checking the connection...",
  schema: connectionActionPayloadSchema,
  render: (payload, app) => {
    const presentation = STATE_PRESENTATION[payload.state]
    const actionUrl = payload.action?.url
    const openAction = () => {
      if (actionUrl) void app?.openLink({ url: actionUrl })
    }
    return (
      <main className="card">
        <AppHeader
          tone={presentation.tone}
          icon={payload.state === "connected" ? <CheckIcon /> : payload.state === "provider_error" ? <AlertIcon /> : <PlugIcon />}
          eyebrow={presentation.eyebrow}
          title={payload.connectionName}
          badge={{ tone: presentation.badgeTone, label: presentation.badge }}
        />
        <p className="description">{payload.message}</p>
        {payload.action ? (
          <KeyValueGrid
            items={[
              ...(payload.actor ? [{ label: "Who acts", value: ACTOR_LABEL[payload.actor] }] : []),
              { label: "Where", value: SURFACE_LABEL[payload.action.surface] },
            ]}
          />
        ) : null}
        {payload.action ? (
          <div className="actions">
            {actionUrl ? (
              <button className="action-primary" type="button" onClick={openAction}>
                {payload.action.label} <ArrowIcon />
              </button>
            ) : (
              <span className="badge" data-tone={presentation.badgeTone}>{payload.action.label}</span>
            )}
          </div>
        ) : null}
        <p className="footnote">
          {payload.state === "connected"
            ? "Tools from this connection are available in chat right now."
            : "After it is fixed, ask again in this chat — the agent searches live."}
        </p>
      </main>
    )
  },
})
