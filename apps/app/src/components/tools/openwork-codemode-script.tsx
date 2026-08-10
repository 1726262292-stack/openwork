"use client"

import { useMemo, useState } from "react"
import type { DynamicToolUIPart } from "ai"
import { Play, Save } from "lucide-react"

import { createDenClient, readDenSettings } from "@/app/lib/den"
import { CapabilityCallLine } from "@/components/chat/capability-call-line"
import { useMessageList } from "@/components/chat/message-list-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizedToolName(value: string): string {
  return value.trim().toLowerCase().replace(/^functions[._-]/, "")
}

export function isCodemodeScriptToolPart(part: DynamicToolUIPart): boolean {
  return part.state === "output-available"
    && normalizedToolName(part.toolName).endsWith("execute_capability_script")
    && isRecord(part.input)
    && typeof part.input.code === "string"
    && part.input.code.trim().length > 0
}

function inferredSchema(value: unknown): Record<string, unknown> {
  if (value === null) return { type: "null" }
  if (Array.isArray(value)) {
    return value.length > 0 ? { type: "array", items: inferredSchema(value[0]) } : { type: "array" }
  }
  if (isRecord(value)) {
    return {
      type: "object",
      properties: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, inferredSchema(entry)])),
      required: Object.keys(value),
      additionalProperties: false,
    }
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { type: typeof value }
  }
  return {}
}

function parseSchema(value: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (!isRecord(parsed)) throw new Error(`${label} must be a JSON object.`)
  return parsed
}

export function OpenWorkCodemodeScriptTool({ part }: { part: DynamicToolUIPart }) {
  const { setPrompt } = useMessageList()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [inputSchema, setInputSchema] = useState(() => JSON.stringify(
    inferredSchema(isRecord(part.input) ? part.input.input : undefined),
    null,
    2,
  ))
  const [outputSchema, setOutputSchema] = useState(() => JSON.stringify(
    inferredSchema(isRecord(part.output) && "value" in part.output ? part.output.value : part.output),
    null,
    2,
  ))
  const [saving, setSaving] = useState(false)
  const [checkingSupport, setCheckingSupport] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ pluginId: string; configObjectId: string; configObjectVersionId: string } | null>(null)
  const code = isRecord(part.input) && typeof part.input.code === "string" ? part.input.code : ""
  const scriptInput = isRecord(part.input) ? part.input.input : undefined
  const resultValue = isRecord(part.output) && "value" in part.output ? part.output.value : part.output
  const capabilityPaths = useMemo(() => [...new Set(
    [...code.matchAll(/\btools\.[a-z_$][a-z0-9_$]*\.[a-z_$][a-z0-9_$]*/gi)].map((match) => match[0]),
  )], [code])
  const rerunPrompt = useMemo(() => [
    "Run this exact program again with execute_capability_script.",
    `Code:\n${code}`,
    scriptInput === undefined ? null : `Input:\n${JSON.stringify(scriptInput, null, 2)}`,
    "Return the fresh result without changing the program.",
  ].filter((line): line is string => line !== null).join("\n\n"), [code, scriptInput])

  const save = async () => {
    const settings = readDenSettings()
    const organizationId = settings.activeOrgId?.trim()
    const token = settings.authToken?.trim()
    if (!organizationId || !token) {
      setError("Sign in to OpenWork Cloud before saving this script.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await createDenClient({ baseUrl: settings.baseUrl, token }).saveCodemodeScript(organizationId, {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        code,
        currentInput: scriptInput,
        inputSchema: parseSchema(inputSchema, "Input schema"),
        outputSchema: parseSchema(outputSchema, "Output schema"),
      })
      setSaved(result)
      setOpen(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The script could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  const openSave = async () => {
    const settings = readDenSettings()
    const organizationId = settings.activeOrgId?.trim()
    const token = settings.authToken?.trim()
    if (!organizationId || !token) {
      setOpen(true)
      return
    }
    setCheckingSupport(true)
    setError(null)
    try {
      const supported = await createDenClient({ baseUrl: settings.baseUrl, token }).supportsSavedCodemodeScripts(organizationId)
      if (!supported) {
        setError("Saved scripts will be available after this OpenWork Cloud server is upgraded.")
        return
      }
      setOpen(true)
    } catch (supportError) {
      setError(supportError instanceof Error ? supportError.message : "Could not check saved script support.")
    } finally {
      setCheckingSupport(false)
    }
  }

  return (
    <div className="space-y-2" data-openwork-codemode-script={part.toolCallId}>
      <CapabilityCallLine part={part} />
      <div className="flex flex-wrap gap-2 ps-5">
        <Button type="button" variant="outline" size="xs" onClick={() => setPrompt(rerunPrompt)}>
          <Play className="size-3.5" />
          Run again
        </Button>
        <Button type="button" variant="outline" size="xs" disabled={Boolean(saved) || checkingSupport} onClick={() => void openSave()}>
          <Save className="size-3.5" />
          {saved ? "Script saved" : checkingSupport ? "Checking…" : "Save as script"}
        </Button>
      </div>

      {error && !open ? <p className="ps-5 text-xs text-destructive" role="alert">{error}</p> : null}

      <Sheet open={open} onOpenChange={(nextOpen) => !saving && setOpen(nextOpen)}>
        <SheetContent
          side="right"
          showCloseButton={!saving}
          className="data-[side=right]:w-[min(46rem,calc(100vw-1rem))] data-[side=right]:sm:max-w-2xl"
        >
          <SheetHeader className="shrink-0 border-b pe-16">
            <SheetTitle className="text-lg">Save reusable script</SheetTitle>
            <SheetDescription>
              Turn this successful Code Mode run into a reusable script without leaving the task.
            </SheetDescription>
          </SheetHeader>

          <div data-saved-script-scroll className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="space-y-6">
              <section className="space-y-4" aria-labelledby="saved-script-details-heading">
                <div>
                  <h3 id="saved-script-details-heading" className="font-medium">Script details</h3>
                  <p className="text-xs text-muted-foreground">Name the reusable result so it is easy to find in Library.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="saved-script-name">Name</Label>
                  <Input id="saved-script-name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Launch briefing" autoFocus />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="saved-script-description">Description</Label>
                  <Input id="saved-script-description" value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="What this reusable script returns" />
                </div>
              </section>

              <section className="rounded-xl border border-border bg-muted/20 p-4" aria-labelledby="saved-script-access-heading">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 id="saved-script-access-heading" className="font-medium">Capabilities used</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Access is pinned now. Future runs recheck access before contacting a provider.</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">Read-only</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {capabilityPaths.length > 0
                    ? capabilityPaths.map((path) => <code key={path} className="rounded-md bg-muted px-2 py-1 text-xs">{path}</code>)
                    : <span className="text-xs text-muted-foreground">No provider capabilities detected in this program.</span>}
                </div>
              </section>

              <section className="space-y-4" aria-labelledby="saved-script-contract-heading">
                <div>
                  <h3 id="saved-script-contract-heading" className="font-medium">Data contract</h3>
                  <p className="text-xs text-muted-foreground">Review the inferred JSON schemas used to validate each run.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="saved-script-input-schema">Input schema</Label>
                    <Textarea id="saved-script-input-schema" className="min-h-28 font-mono text-xs" value={inputSchema} onChange={(event) => setInputSchema(event.currentTarget.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="saved-script-output-schema">Output schema</Label>
                    <Textarea id="saved-script-output-schema" className="min-h-28 font-mono text-xs" value={outputSchema} onChange={(event) => setOutputSchema(event.currentTarget.value)} />
                  </div>
                </div>
              </section>

              <section className="grid gap-4 sm:grid-cols-2" aria-label="Run review">
                <div className="space-y-2">
                  <Label>Program</Label>
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">{code}</pre>
                </div>
                <div className="space-y-2">
                  <Label>Latest result preview</Label>
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">{JSON.stringify(resultValue, null, 2)}</pre>
                </div>
              </section>
            </div>
            {error ? <p className="mt-4 text-sm text-destructive" role="alert">{error}</p> : null}
          </div>

          <SheetFooter className="shrink-0 flex-row justify-end border-t bg-popover p-4">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={saving || !name.trim() || !code.trim()} onClick={() => void save()}>
              {saving ? "Saving…" : "Save script"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
