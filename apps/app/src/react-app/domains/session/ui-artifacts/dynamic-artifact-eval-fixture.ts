import type {
  UiArtifactProjectFile,
  UiArtifactProjectFiles,
} from "@openwork/types/ui-artifact-project"

const manifest = {
  protocol: "openwork.ui-artifact-project",
  schemaVersion: 2,
  apiVersion: 1,
  slug: "launch-radar",
  title: "Launch Radar",
  description: "A reusable mission dashboard generated as a React artifact project.",
  runtime: {
    kind: "react",
    entry: "src/App.tsx",
    styles: "styles.css",
  },
  data: {
    value: "data.json",
    schema: "data.schema.json",
  },
  presentation: {
    placement: "both",
    preferredWidth: "wide",
    preferredHeight: 430,
    resizable: true,
  },
  intents: [{
    id: "launch.explain",
    title: "Explain launch risk",
    description: "Ask the agent to explain the currently selected launch risk.",
    arguments: [{
      name: "mission",
      type: "string",
      required: true,
      description: "Mission name to explain.",
    }],
    effects: {
      data: "read",
      ui: "none",
      external: false,
    },
    confirmation: "never",
  }],
} as const

const source = `type Launch = {
  id: string
  name: string
  window: string
  readiness: number
  tone: string
}

type LaunchRadarProps = {
  data: { launches: Launch[] }
  state: { watching?: string } | null
  runtime: {
    replaceState(next: { watching?: string }): void
    invoke(intentId: string, payload: Record<string, unknown>): Promise<unknown>
  }
}

export default function LaunchRadar({ data, state, runtime }: LaunchRadarProps) {
  const primary = data.launches[0]
  const watching = state?.watching

  return (
    <main className="launch-radar">
      <header>
        <div>
          <p className="eyebrow">MISSION CONTROL</p>
          <h1>Launch Radar</h1>
        </div>
        <span className="live-indicator">LIVE</span>
      </header>
      <section className="hero">
        <div className="orbit" aria-hidden="true"><span /></div>
        <p className="window">{primary.window}</p>
        <h2>{primary.name}</h2>
        <p>{primary.readiness}% ready for launch</p>
        <button
          className="watch-button"
          onClick={() => runtime.replaceState({ watching: primary.id })}
        >
          {watching === primary.id ? "Watching Apollo" : "Watch launch"}
        </button>
      </section>
      <div className="launch-grid">
        {data.launches.map((launch) => (
          <article key={launch.id} style={{ "--mission-tone": launch.tone }}>
            <span>{launch.window}</span>
            <strong>{launch.name}</strong>
            <meter min="0" max="100" value={launch.readiness} />
          </article>
        ))}
      </div>
      <button
        className="agent-button"
        onClick={() => runtime.invoke("launch.explain", { mission: primary.name })}
      >
        Ask agent about launch risk
      </button>
    </main>
  )
}
`

const styles = `:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  background: #070b16;
  color: #f8fafc;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 0; }
button { font: inherit; }
.launch-radar {
  min-height: 390px;
  padding: 22px;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 40%, rgba(77, 208, 225, .18), transparent 32%),
    linear-gradient(145deg, #0a1020 0%, #070b16 60%, #111936 100%);
}
header { display: flex; align-items: flex-start; justify-content: space-between; }
.eyebrow { margin: 0 0 4px; color: #67e8f9; font-size: 11px; font-weight: 800; letter-spacing: .2em; }
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: 0; font-size: 25px; }
.live-indicator { color: #86efac; font-size: 11px; font-weight: 800; letter-spacing: .12em; }
.hero { position: relative; display: grid; justify-items: center; padding: 28px 0 22px; text-align: center; }
.orbit { position: absolute; top: 8px; width: 210px; height: 210px; border: 1px solid rgba(103, 232, 249, .18); border-radius: 999px; }
.orbit::before, .orbit::after { content: ""; position: absolute; inset: 22px; border: 1px solid rgba(129, 140, 248, .2); border-radius: inherit; }
.orbit::after { inset: 48px; }
.orbit span { position: absolute; top: 37px; right: 20px; width: 8px; height: 8px; border-radius: 50%; background: #67e8f9; box-shadow: 0 0 18px #67e8f9; }
.window { margin-bottom: 6px; color: #94a3b8; font-size: 12px; }
.hero h2 { z-index: 1; margin-bottom: 5px; font-size: 29px; }
.hero > p:not(.window) { z-index: 1; margin-bottom: 18px; color: #cbd5e1; font-size: 13px; }
.watch-button {
  z-index: 2;
  min-width: 150px;
  border: 1px solid rgba(103, 232, 249, .55);
  border-radius: 999px;
  padding: 10px 18px;
  background: rgba(8, 145, 178, .28);
  color: #ecfeff;
  font-weight: 750;
  cursor: pointer;
}
.launch-grid { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }
.launch-grid article { display: grid; gap: 5px; border: 1px solid color-mix(in srgb, var(--mission-tone) 38%, transparent); border-radius: 12px; padding: 10px; background: rgba(15, 23, 42, .75); }
.launch-grid span { color: #94a3b8; font-size: 10px; }
.launch-grid strong { font-size: 12px; }
meter { width: 100%; accent-color: var(--mission-tone); }
.agent-button { display: block; margin: 14px auto 0; border: 0; background: transparent; color: #a5b4fc; font-size: 11px; cursor: pointer; }
`

const data = {
  launches: [
    { id: "apollo", name: "Apollo", window: "T−00:42:18", readiness: 94, tone: "#67e8f9" },
    { id: "kepler", name: "Kepler", window: "T−03:16:04", readiness: 78, tone: "#a5b4fc" },
    { id: "voyager", name: "Voyager", window: "T−18:09:51", readiness: 61, tone: "#f0abfc" },
  ],
}

const dataSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["launches"],
  properties: {
    launches: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "name", "window", "readiness", "tone"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          window: { type: "string" },
          readiness: { type: "number", minimum: 0, maximum: 100 },
          tone: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
}

export const DYNAMIC_ARTIFACT_EVAL_PROJECT = {
  "artifact.json": JSON.stringify(manifest, null, 2) + "\n",
  "src/App.tsx": source,
  "styles.css": styles,
  "data.json": JSON.stringify(data, null, 2) + "\n",
  "data.schema.json": JSON.stringify(dataSchema, null, 2) + "\n",
} satisfies UiArtifactProjectFiles

export const DYNAMIC_ARTIFACT_EVAL_PROJECT_FILES = Object.entries(
  DYNAMIC_ARTIFACT_EVAL_PROJECT,
) as Array<[UiArtifactProjectFile, string]>

export const DYNAMIC_ARTIFACT_EVAL_INITIAL_STATE = {}
