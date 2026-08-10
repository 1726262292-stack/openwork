/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react"
import {
  AUTOMATION_FREE_MODEL,
  type AutomationAction,
  type AutomationExecutionTarget,
  type AutomationSchedule,
  type CreateAutomationDefinition,
} from "@openwork/types/automations"
import type { DenSavedCodemodeScriptSummary } from "@/app/lib/den"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ChevronDown } from "lucide-react"

import { ModelPickerModal } from "@/react-app/domains/session/modals/model-picker-modal"
import type { AutomationModelOption, AutomationProviderCatalog } from "./automation-model-options"
import { automationPickerOptions, describeAutomationModel } from "./automation-model-options"

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const

function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

function tomorrowAtNine() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return date.getTime()
}

function toLocalDateTime(value: number) {
  const date = new Date(value)
  const component = (part: number) => String(part).padStart(2, "0")
  return `${date.getFullYear()}-${component(date.getMonth() + 1)}-${component(date.getDate())}T${component(date.getHours())}:${component(date.getMinutes())}`
}

type AutomationEditorInput = {
  name: string
  schedule: AutomationSchedule
  action: AutomationAction
  executionTarget: AutomationExecutionTarget
}

function canonicalInput(input: CreateAutomationDefinition): AutomationEditorInput {
  if ("action" in input) return input
  return {
    name: input.name,
    schedule: input.schedule,
    action: { kind: "agent", instructions: input.instructions, model: input.model },
    executionTarget: "desktop",
  }
}

function defaultInput(modelOptions: readonly AutomationModelOption[]): AutomationEditorInput {
  const first = modelOptions[0] ?? AUTOMATION_FREE_MODEL
  return {
    name: "",
    schedule: { kind: "daily", timezone: localTimezone(), hour: 9, minute: 0 },
    action: {
      kind: "agent",
      instructions: "",
      model: { providerId: first.providerId, modelId: first.modelId, variant: null },
    },
    executionTarget: "desktop",
  }
}

function modelKey(model: { providerId: string; modelId: string }) {
  return `${encodeURIComponent(model.providerId)}:${encodeURIComponent(model.modelId)}`
}

function timeForSchedule(schedule: AutomationSchedule) {
  if (schedule.kind === "once") return { hour: 9, minute: 0 }
  return { hour: schedule.hour, minute: schedule.minute }
}

function parseJson(value: string): unknown {
  return JSON.parse(value)
}

export type AutomationEditorProps = {
  initial?: CreateAutomationDefinition | null
  initialKey?: string
  modelOptions: readonly AutomationModelOption[]
  savedScripts: readonly DenSavedCodemodeScriptSummary[]
  providerCatalog?: AutomationProviderCatalog
  busy: boolean
  submitLabel: string
  onCancel: () => void
  onSave: (input: CreateAutomationDefinition) => Promise<void> | void
}

export function AutomationEditor(props: AutomationEditorProps) {
  const [input, setInput] = useState<AutomationEditorInput>(() => props.initial ? canonicalInput(props.initial) : defaultInput(props.modelOptions))
  const [scriptInput, setScriptInput] = useState(() => {
    const initial = props.initial ? canonicalInput(props.initial) : null
    return initial?.action.kind === "saved_script" ? JSON.stringify(initial.action.input ?? {}, null, 2) : "{}"
  })
  const appliedInitialKey = useRef(props.initialKey)

  useEffect(() => {
    if (props.initial) {
      if (appliedInitialKey.current === props.initialKey) return
      appliedInitialKey.current = props.initialKey
      const next = canonicalInput(props.initial)
      setInput(next)
      if (next.action.kind === "saved_script") setScriptInput(JSON.stringify(next.action.input ?? {}, null, 2))
      return
    }
    setInput(defaultInput(props.modelOptions))
  }, [props.initial, props.initialKey, props.modelOptions])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState("")
  const agentAction = input.action.kind === "agent" ? input.action : null
  const selectedModel = agentAction ? modelKey(agentAction.model) : ""
  const currentModelAvailable = agentAction
    ? props.modelOptions.some((option) => modelKey(option) === selectedModel)
    : true
  const modelLabel = agentAction ? describeAutomationModel(agentAction.model, props.modelOptions) : ""
  const pickerOptions = useMemo(
    () => automationPickerOptions({
      options: props.modelOptions,
      catalog: props.providerCatalog ?? {},
      selected: agentAction?.model ?? AUTOMATION_FREE_MODEL,
    }),
    [agentAction?.model, props.modelOptions, props.providerCatalog],
  )
  const scriptInputValue = useMemo(() => {
    try {
      return { ok: true as const, value: parseJson(scriptInput) }
    } catch {
      return { ok: false as const }
    }
  }, [scriptInput])
  const selectedScriptVersionId = input.action.kind === "saved_script"
    ? input.action.script.configObjectVersionId
    : null
  const canSave = useMemo(
    () => input.name.trim().length > 0 && (input.action.kind === "agent"
      ? input.action.instructions.trim().length > 0 && currentModelAvailable
      : props.savedScripts.some((script) => script.configObjectVersionId === selectedScriptVersionId)
        && scriptInputValue.ok),
    [currentModelAvailable, input.action, input.name, props.savedScripts, scriptInputValue.ok, selectedScriptVersionId],
  )
  const time = timeForSchedule(input.schedule)

  const changeScheduleKind = (kind: AutomationSchedule["kind"]) => {
    const timezone = input.schedule.timezone
    if (kind === "once") {
      setInput((current) => ({ ...current, schedule: { kind, timezone, at: tomorrowAtNine() } }))
      return
    }
    if (kind === "daily") {
      setInput((current) => ({ ...current, schedule: { kind, timezone, hour: time.hour, minute: time.minute } }))
      return
    }
    setInput((current) => ({
      ...current,
      schedule: { kind, timezone, daysOfWeek: [1, 2, 3, 4, 5], hour: time.hour, minute: time.minute },
    }))
  }

  const changeTime = (value: string) => {
    const [hour, minute] = value.split(":").map(Number)
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return
    setInput((current) => current.schedule.kind === "once" ? current : {
      ...current,
      schedule: { ...current.schedule, hour, minute },
    })
  }

  const toggleWeekday = (day: number) => {
    setInput((current) => {
      if (current.schedule.kind !== "weekly") return current
      const selected = current.schedule.daysOfWeek.includes(day)
      const daysOfWeek = selected
        ? current.schedule.daysOfWeek.filter((value) => value !== day)
        : [...current.schedule.daysOfWeek, day].sort((left, right) => left - right)
      if (daysOfWeek.length === 0) return current
      return { ...current, schedule: { ...current.schedule, daysOfWeek } }
    })
  }

  return (
    <form
      className="space-y-5"
      data-automation-editor
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSave || props.busy) return
        const next = input.action.kind === "saved_script" && scriptInputValue.ok
          ? { ...input, action: { ...input.action, input: scriptInputValue.value } }
          : input
        void props.onSave(next)
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="automation-name">Name</Label>
        <Input
          id="automation-name"
          value={input.name}
          maxLength={120}
          required
          placeholder="Daily project summary"
          onChange={(event) => {
            const name = event.currentTarget.value
            setInput((current) => ({ ...current, name }))
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="automation-action-kind">Runs</Label>
        <select
          id="automation-action-kind"
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
          value={input.action.kind}
          onChange={(event) => {
            if (event.currentTarget.value === "saved_script") {
              const script = props.savedScripts[0]
              if (!script) return
              setInput((current) => ({
                ...current,
                action: {
                  kind: "saved_script",
                  script: {
                    pluginId: script.pluginId,
                    configObjectId: script.configObjectId,
                    configObjectVersionId: script.configObjectVersionId,
                  },
                  input: {},
                },
                executionTarget: "cloud",
              }))
              setScriptInput("{}")
              return
            }
            const first = props.modelOptions[0] ?? AUTOMATION_FREE_MODEL
            setInput((current) => ({
              ...current,
              action: {
                kind: "agent",
                instructions: "",
                model: { providerId: first.providerId, modelId: first.modelId, variant: null },
              },
              executionTarget: "desktop",
            }))
          }}
        >
          <option value="agent">Agent task</option>
          <option value="saved_script" disabled={props.savedScripts.length === 0}>Saved script</option>
        </select>
        {props.savedScripts.length === 0 ? <p className="text-xs text-muted-foreground">Save a successful Code Mode run to automate it without a model.</p> : null}
      </div>

      {input.action.kind === "agent" ? (
        <div className="space-y-2">
          <Label htmlFor="automation-instructions">Instructions</Label>
          <Textarea
            id="automation-instructions"
            className="min-h-36 resize-y"
            value={input.action.instructions}
            required
            placeholder="Describe the outcome, sources to check, and what a useful result should include."
            onChange={(event) => {
              const instructions = event.currentTarget.value
              setInput((current) => current.action.kind === "agent"
                ? { ...current, action: { ...current.action, instructions } }
                : current)
            }}
          />
          <p className="text-xs text-muted-foreground">Each claimed run starts a fresh task in your desktop OpenCode runtime.</p>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-border p-4">
          <div className="space-y-2">
            <Label htmlFor="automation-script">Script</Label>
            <select
              id="automation-script"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
              value={input.action.script.configObjectVersionId}
              onChange={(event) => {
                const script = props.savedScripts.find((candidate) => candidate.configObjectVersionId === event.currentTarget.value)
                if (!script) return
                setInput((current) => ({
                  ...current,
                  action: {
                    kind: "saved_script",
                    script: {
                      pluginId: script.pluginId,
                      configObjectId: script.configObjectId,
                      configObjectVersionId: script.configObjectVersionId,
                    },
                    input: current.action.kind === "saved_script" ? current.action.input : {},
                  },
                }))
              }}
            >
              {props.savedScripts.map((script) => <option key={script.configObjectVersionId} value={script.configObjectVersionId}>{script.title}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">This Automation pins the exact script version. Updating the Script does not silently change scheduled work.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="automation-script-input">Input</Label>
            <Textarea id="automation-script-input" className="min-h-28 font-mono text-xs" value={scriptInput} onChange={(event) => setScriptInput(event.currentTarget.value)} />
            {!scriptInputValue.ok ? <p className="text-xs text-destructive">Enter valid JSON input.</p> : null}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="automation-frequency">Schedule</Label>
          <select
            id="automation-frequency"
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
            value={input.schedule.kind}
            onChange={(event) => {
              const kind = event.currentTarget.value
              if (kind === "once" || kind === "daily" || kind === "weekly") changeScheduleKind(kind)
            }}
          >
            <option value="once">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        {input.schedule.kind === "once" ? (
          <div className="space-y-2">
            <Label htmlFor="automation-once-at">Run at</Label>
            <Input
              id="automation-once-at"
              type="datetime-local"
              value={toLocalDateTime(input.schedule.at)}
              onChange={(event) => {
                const at = new Date(event.currentTarget.value).getTime()
                if (Number.isFinite(at)) setInput((current) => ({
                  ...current,
                  schedule: { kind: "once", timezone: current.schedule.timezone, at },
                }))
              }}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="automation-time">Time</Label>
            <Input
              id="automation-time"
              type="time"
              value={`${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`}
              onChange={(event) => changeTime(event.currentTarget.value)}
            />
          </div>
        )}
      </div>

      {input.schedule.kind === "weekly" ? (
        <div className="space-y-2">
          <Label>Days</Label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => (
              <Button
                key={day.value}
                type="button"
                size="sm"
                variant={input.schedule.kind === "weekly" && input.schedule.daysOfWeek.includes(day.value) ? "secondary" : "outline"}
                onClick={() => toggleWeekday(day.value)}
              >
                {day.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="automation-timezone">Timezone</Label>
          <Input
            id="automation-timezone"
            value={input.schedule.timezone}
            onChange={(event) => {
              const timezone = event.currentTarget.value
              setInput((current) => ({ ...current, schedule: { ...current.schedule, timezone } }))
            }}
          />
        </div>
        {input.action.kind === "agent" ? (
        <div className="space-y-2">
          <Label htmlFor="automation-model">Model</Label>
          <Button
            id="automation-model"
            type="button"
            variant="outline"
            className="h-9 w-full justify-between gap-2 font-normal"
            onClick={() => setPickerOpen(true)}
          >
            <span className="min-w-0 truncate">
              {currentModelAvailable ? modelLabel : "Current model is no longer available"}
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-60" />
          </Button>
          <ModelPickerModal
            open={pickerOpen}
            options={pickerOptions}
            query={modelQuery}
            setQuery={setModelQuery}
            subtitle="Runs use this model and reasoning level in your desktop runtime."
            target="default"
            current={{ providerID: input.action.model.providerId, modelID: input.action.model.modelId }}
            onSelect={(model) => {
              setInput((current) => current.action.kind === "agent" ? ({
                ...current,
                action: {
                  ...current.action,
                  model: { providerId: model.providerID, modelId: model.modelID, variant: null },
                },
              }) : current)
              setPickerOpen(false)
            }}
            onBehaviorChange={(model, variant) => setInput((current) => current.action.kind === "agent" ? ({
              ...current,
              action: { ...current.action, model: { providerId: model.providerID, modelId: model.modelID, variant } },
            }) : current)}
            onOpenSettings={() => setPickerOpen(false)}
            onClose={() => setPickerOpen(false)}
          />
        </div>
        ) : (
          <div className="space-y-2">
            <Label>Execution location</Label>
            <div className="flex h-9 items-center rounded-lg border border-border bg-muted/30 px-3 text-sm">OpenWork Cloud</div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        {input.action.kind === "saved_script"
          ? "OpenWork Cloud runs the exact saved Script version on schedule, even when your browser and desktop are closed. The same durable result and history are available on Web and desktop."
          : "Den keeps the schedule and run history. Your signed-in desktop claims each occurrence and executes it with the selected model in its local OpenCode runtime. If the desktop is unavailable before the claim deadline, the occurrence is recorded as missed."}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={props.busy} onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" disabled={!canSave || props.busy}>{props.busy ? "Saving…" : props.submitLabel}</Button>
      </div>
    </form>
  )
}
