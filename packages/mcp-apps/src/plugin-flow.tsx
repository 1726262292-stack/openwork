import { pluginFlowPayloadSchema, type PluginFlowPayload } from "@openwork/types/plugin-flow-app"
import { mountMcpApp } from "./shared/bridge"
import { AppHeader, CheckIcon, KeyValueGrid, ShareIcon } from "./shared/ui"
import "./shared/theme.css"

const MODE_PRESENTATION: Record<PluginFlowPayload["mode"], {
  eyebrow: string
  title: string
  footnote: string
}> = {
  marketplace_plugin_added: {
    eyebrow: "Marketplace updated",
    title: "Plugin added to marketplace",
    footnote: "Everyone with access to the marketplace can now install this plugin.",
  },
  plugin_access_granted: {
    eyebrow: "Plugin shared",
    title: "Access granted",
    footnote: "The recipient can use this plugin's skills in chat immediately.",
  },
  marketplace_access_granted: {
    eyebrow: "Marketplace shared",
    title: "Marketplace access granted",
    footnote: "The member can now browse and install plugins from this marketplace.",
  },
}

const RECIPIENT_LABEL: Record<NonNullable<PluginFlowPayload["recipient"]>["kind"], string> = {
  member: "Member",
  team: "Team",
  org_wide: "Entire organization",
}

mountMcpApp({
  name: "OpenWork Plugin Flow",
  waitingLabel: "Finishing up...",
  schema: pluginFlowPayloadSchema,
  render: (payload) => {
    const presentation = MODE_PRESENTATION[payload.mode]
    const items: Array<{ label: string; value: string; mono?: boolean }> = []
    if (payload.pluginId) items.push({ label: "Plugin", value: payload.pluginId, mono: true })
    if (payload.marketplaceId) items.push({ label: "Marketplace", value: payload.marketplaceId, mono: true })
    if (payload.recipient) {
      items.push({
        label: RECIPIENT_LABEL[payload.recipient.kind],
        value: payload.recipient.id ?? "org-wide",
        mono: payload.recipient.id !== null,
      })
      if (payload.recipient.role) items.push({ label: "Role", value: payload.recipient.role })
    }
    return (
      <main className="card">
        <AppHeader
          tone={payload.mode === "marketplace_plugin_added" ? "info" : "success"}
          icon={payload.mode === "marketplace_plugin_added" ? <ShareIcon /> : <CheckIcon />}
          eyebrow={presentation.eyebrow}
          title={presentation.title}
          badge={{ tone: "success", label: "Done" }}
        />
        <KeyValueGrid items={items} />
        <p className="footnote">{presentation.footnote}</p>
      </main>
    )
  },
})
