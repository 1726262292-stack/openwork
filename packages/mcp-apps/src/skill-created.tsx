import { skillCreatedPayloadSchema } from "@openwork/types/skill-created-app"
import { mountMcpApp } from "./shared/bridge"
import { AppHeader, ArrowIcon, CheckIcon, KeyValueGrid } from "./shared/ui"
import "./shared/theme.css"

mountMcpApp({
  name: "OpenWork Skill Saved",
  waitingLabel: "Finishing your skill...",
  schema: skillCreatedPayloadSchema,
  render: (payload, app) => {
    const updated = payload.mode === "updated"
    const openLibrary = () => {
      if (payload.libraryUrl) void app?.openLink({ url: payload.libraryUrl })
    }
    return (
      <main className="card">
        <AppHeader
          tone="brand"
          icon={<CheckIcon />}
          eyebrow={updated ? "Skill updated" : "Skill created"}
          title={payload.name}
          badge={{ tone: "success", label: "Ready" }}
        />
        <p className="description">{payload.description}</p>
        <KeyValueGrid
          items={[
            { label: "Plugin", value: payload.pluginId, mono: true },
            { label: "Skill", value: payload.skillId, mono: true },
          ]}
        />
        {payload.libraryUrl ? (
          <div className="actions">
            <button className="action-primary" type="button" onClick={openLibrary}>
              Open in Library <ArrowIcon />
            </button>
          </div>
        ) : null}
        <p className="footnote">
          {updated
            ? "A new immutable version is live. Everyone with access uses it immediately."
            : "Private to you until you share it or add it to a marketplace."}
        </p>
      </main>
    )
  },
})
