/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, RefreshCw, Save, TestTube2, Trash2 } from "lucide-react"
import type { SavedScriptDetail, SavedScriptTestResult } from "@openwork/types/dynamic-artifacts"
import type { createDenClient, DenSavedCodemodeScriptDraft, DenSavedCodemodeScriptSnapshot } from "@/app/lib/den"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownBlock } from "@/react-app/domains/session/surface/markdown"
import { SavedScriptArtifactResult } from "./saved-script-artifact-result"

type DenClient = ReturnType<typeof createDenClient>
type DraftFields = {
  name: string
  description: string
  code: string
  exampleInput: string
  inputSchema: string
  outputSchema: string
}

const FRESHNESS_OPTIONS = [
  { label: "1 hour", value: 60 * 60_000 },
  { label: "1 day", value: 24 * 60 * 60_000 },
  { label: "1 week", value: 7 * 24 * 60 * 60_000 },
]

function pretty(value: unknown) {
  return value === null || value === undefined ? "" : JSON.stringify(value, null, 2)
}

function fieldsFromDetail(detail: SavedScriptDetail): DraftFields {
  return {
    name: detail.title,
    description: detail.description ?? "",
    code: detail.currentVersion.code,
    exampleInput: "{}",
    inputSchema: pretty(detail.currentVersion.inputSchema),
    outputSchema: pretty(detail.currentVersion.outputSchema),
  }
}

function fingerprint(fields: DraftFields) {
  return JSON.stringify(fields)
}

function parseJson(label: string, value: string, optional = false): unknown {
  const trimmed = value.trim()
  if (!trimmed && optional) return undefined
  try {
    return JSON.parse(trimmed || "null")
  } catch {
    throw new Error(`${label} syntax: enter valid JSON.`)
  }
}

function draftFromFields(detail: SavedScriptDetail, fields: DraftFields): DenSavedCodemodeScriptDraft {
  return {
    name: fields.name.trim(),
    description: fields.description.trim() || undefined,
    code: fields.code,
    exampleInput: parseJson("Example input", fields.exampleInput),
    inputSchema: parseJson("Input schema", fields.inputSchema, true),
    outputSchema: parseJson("Output schema", fields.outputSchema, true),
    requiredCapabilities: detail.currentVersion.requiredCapabilities,
  }
}

function errorCategory(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes("capability")) return "Missing capability"
  if (normalized.includes("output") || normalized.includes("result")) return "Output validation"
  if (normalized.includes("input") || normalized.includes("argument")) return "Input validation"
  return "Syntax or runtime"
}

export function SavedScriptDetail(props: {
  client: DenClient
  organizationId: string
  configObjectId: string
  onClose: () => void
  onAutomate: (versionId: string) => void
}) {
  const [maxAgeMs, setMaxAgeMs] = useState(FRESHNESS_OPTIONS[1].value)
  const [detail, setDetail] = useState<SavedScriptDetail | null>(null)
  const [snapshots, setSnapshots] = useState<DenSavedCodemodeScriptSnapshot[]>([])
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null)
  const [fields, setFields] = useState<DraftFields | null>(null)
  const [baseFingerprint, setBaseFingerprint] = useState("")
  const [testResult, setTestResult] = useState<SavedScriptTestResult | null>(null)
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadedVersionRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    const [nextDetail, nextSnapshots] = await Promise.all([
      props.client.getSavedCodemodeScript(props.organizationId, props.configObjectId, { maxAgeMs }),
      props.client.listSavedCodemodeScriptSnapshots(props.organizationId, props.configObjectId, { limit: 100 }),
    ])
    setDetail(nextDetail)
    setSnapshots(nextSnapshots)
    setSelectedReceiptId((current) => current ?? nextDetail.latestSnapshot?.receiptId ?? nextDetail.latestSuccessfulSnapshot?.receiptId ?? null)
  }, [maxAgeMs, props.client, props.configObjectId, props.organizationId])

  useEffect(() => {
    let cancelled = false
    setBusy("load")
    void Promise.all([
      props.client.getSavedCodemodeScript(props.organizationId, props.configObjectId, { maxAgeMs }),
      props.client.listSavedCodemodeScriptSnapshots(props.organizationId, props.configObjectId, { limit: 100 }),
    ]).then(([nextDetail, nextSnapshots]) => {
      if (cancelled) return
      setDetail(nextDetail)
      setSnapshots(nextSnapshots)
      if (loadedVersionRef.current !== nextDetail.currentVersion.id) {
        const nextFields = fieldsFromDetail(nextDetail)
        setFields(nextFields)
        setBaseFingerprint(fingerprint(nextFields))
        setTestResult(null)
        setTestedFingerprint(null)
        loadedVersionRef.current = nextDetail.currentVersion.id
      }
      setSelectedReceiptId(nextDetail.latestSnapshot?.receiptId ?? nextDetail.latestSuccessfulSnapshot?.receiptId ?? null)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "The Script could not be loaded.")
    }).finally(() => {
      if (!cancelled) setBusy(null)
    })
    return () => { cancelled = true }
  }, [maxAgeMs, props.client, props.configObjectId, props.organizationId])

  const currentFingerprint = fields ? fingerprint(fields) : ""
  const dirty = Boolean(fields && currentFingerprint !== baseFingerprint)
  const selectedSnapshot = snapshots.find((snapshot) => snapshot.receiptId === selectedReceiptId)
    ?? detail?.latestSuccessfulSnapshot
    ?? null
  const matchingTest = testResult !== null && testedFingerprint === currentFingerprint

  const setField = (key: keyof DraftFields, value: string) => {
    setFields((current) => current ? { ...current, [key]: value } : current)
    setTestResult(null)
    setTestedFingerprint(null)
    setError(null)
  }

  const close = () => {
    if (dirty && !window.confirm("Discard unsaved Script changes?")) return
    props.onClose()
  }

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Script action failed.")
    } finally {
      setBusy(null)
    }
  }

  if (busy === "load" && !detail) return <div className="p-8 text-sm text-muted-foreground">Loading Script…</div>
  if (!detail || !fields) {
    return <Alert variant="warning"><AlertTitle>Script unavailable</AlertTitle><AlertDescription>{error ?? "The Script could not be loaded."}</AlertDescription></Alert>
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6" data-testid="saved-script-detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" aria-label="Back to Library" onClick={close}><ArrowLeft /></Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{detail.title}</h2>
              <Badge variant="outline">Version {detail.currentVersion.id.slice(0, 8)}</Badge>
              <Badge variant={detail.freshness.state === "needs_attention" ? "destructive" : detail.freshness.state === "fresh" ? "default" : "secondary"}>
                {detail.freshness.state.replace("_", " ")}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Edit, test, version, refresh, and inspect one durable Dynamic Artifact lifecycle.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Stale after
            <select className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={maxAgeMs} onChange={(event) => setMaxAgeMs(Number(event.currentTarget.value))}>
              {FRESHNESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <Button variant="outline" onClick={() => props.onAutomate(detail.currentVersion.id)}>Automate</Button>
          <Button
            disabled={busy !== null}
            onClick={() => void runAction("refresh", async () => {
              const draft = draftFromFields(detail, fields)
              let result: Awaited<ReturnType<DenClient["runSavedCodemodeScript"]>>
              try {
                result = await props.client.runSavedCodemodeScript(props.organizationId, {
                  pluginId: detail.pluginId,
                  configObjectId: detail.configObjectId,
                  configObjectVersionId: detail.currentVersion.id,
                }, draft.exampleInput)
              } finally {
                await load()
              }
              setSelectedReceiptId(result.receiptId)
            })}
          ><RefreshCw />{busy === "refresh" ? "Refreshing…" : "Refresh now"}</Button>
        </div>
      </div>

      {error ? <Alert variant="destructive"><AlertTitle>{errorCategory(error)}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {detail.freshness.state === "needs_attention" ? (
        <Alert variant="warning"><AlertTitle>Latest refresh needs attention</AlertTitle><AlertDescription>{detail.freshness.reason} The previous successful result remains readable.</AlertDescription></Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
        <div className="space-y-5">
          <Card variant="outline">
            <CardHeader><CardTitle>Script editor</CardTitle><CardDescription>Saving creates a new immutable version. Any draft change invalidates the previous test.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium">Name<Input value={fields.name} onChange={(event) => setField("name", event.currentTarget.value)} /></label>
                <label className="space-y-1 text-sm font-medium">Description<Input value={fields.description} onChange={(event) => setField("description", event.currentTarget.value)} /></label>
              </div>
              <label className="block space-y-1 text-sm font-medium">Source<Textarea className="min-h-72 font-mono text-xs" value={fields.code} onChange={(event) => setField("code", event.currentTarget.value)} /></label>
              <div className="grid gap-4 lg:grid-cols-3">
                <label className="space-y-1 text-sm font-medium">Example input<Textarea className="min-h-40 font-mono text-xs" value={fields.exampleInput} onChange={(event) => setField("exampleInput", event.currentTarget.value)} /></label>
                <label className="space-y-1 text-sm font-medium">Input schema<Textarea className="min-h-40 font-mono text-xs" value={fields.inputSchema} onChange={(event) => setField("inputSchema", event.currentTarget.value)} /></label>
                <label className="space-y-1 text-sm font-medium">Output schema<Textarea className="min-h-40 font-mono text-xs" value={fields.outputSchema} onChange={(event) => setField("outputSchema", event.currentTarget.value)} /></label>
              </div>
              <div>
                <p className="text-sm font-medium">Required capabilities</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detail.currentVersion.requiredCapabilities.length === 0 ? <Badge variant="outline">No provider tools</Badge> : detail.currentVersion.requiredCapabilities.map((capability) => (
                    <Badge key={`${capability.capabilityName}:${capability.scriptPath}`} variant="outline">{capability.scriptPath}</Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void runAction("test", async () => {
                    const draft = draftFromFields(detail, fields)
                    const result = await props.client.testSavedCodemodeScript(props.organizationId, detail.configObjectId, draft)
                    setTestResult(result)
                    setTestedFingerprint(currentFingerprint)
                  })}
                ><TestTube2 />{busy === "test" ? "Testing…" : "Test changes"}</Button>
                <Button
                  disabled={!matchingTest || busy !== null}
                  onClick={() => void runAction("save", async () => {
                    if (!testResult) return
                    const draft = draftFromFields(detail, fields)
                    const next = await props.client.createSavedCodemodeScriptVersion(
                      props.organizationId,
                      detail.configObjectId,
                      testResult.receiptId,
                      draft,
                    )
                    const nextFields = fieldsFromDetail(next)
                    setDetail(next)
                    setFields(nextFields)
                    setBaseFingerprint(fingerprint(nextFields))
                    loadedVersionRef.current = next.currentVersion.id
                    setTestResult(null)
                    setTestedFingerprint(null)
                    await load()
                  })}
                ><Save />{busy === "save" ? "Saving…" : "Save new version"}</Button>
              </div>
              {!matchingTest ? <p className="text-right text-xs text-muted-foreground">Run a successful matching test to enable Save.</p> : null}
            </CardContent>
          </Card>

          {testResult ? (
            <Card variant="outline">
              <CardHeader><CardTitle>Test output</CardTitle><CardDescription>Successful member-bound receipt {testResult.receiptId.slice(0, 8)}</CardDescription></CardHeader>
              <CardContent>
                <Tabs defaultValue="preview">
                  <TabsList variant="line"><TabsTrigger value="preview">Preview</TabsTrigger><TabsTrigger value="data">Data</TabsTrigger></TabsList>
                  <TabsContent value="preview" className="rounded-lg border border-border p-4"><MarkdownBlock text={testResult.markdown} /></TabsContent>
                  <TabsContent value="data"><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 font-mono text-xs">{JSON.stringify(testResult.value, null, 2)}</pre></TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : null}

          <Card variant="outline">
            <CardHeader><CardTitle>Artifact result</CardTitle><CardDescription>Preview, canonical data, and exact lineage use the same retained snapshot.</CardDescription></CardHeader>
            <CardContent>
              {selectedSnapshot ? <SavedScriptArtifactResult
                snapshot={selectedSnapshot}
                freshness={selectedSnapshot.receiptId === detail.latestSnapshot?.receiptId ? detail.freshness : undefined}
                lastSuccessful={selectedSnapshot.receiptId === detail.latestSuccessfulSnapshot?.receiptId}
              /> : <p className="text-sm text-muted-foreground">This Script has not produced a retained result yet.</p>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card variant="outline">
            <CardHeader><CardTitle>Version history</CardTitle><CardDescription>Automations remain pinned until you update them explicitly.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {detail.versions.map((version, index) => (
                <div key={version.id} className="rounded-lg border border-border p-3 text-xs">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono">{version.id.slice(0, 12)}</span>{index === 0 ? <Badge>Current</Badge> : <Badge variant="outline">Earlier</Badge>}</div>
                  <p className="mt-1 text-muted-foreground">{new Date(version.createdAt).toLocaleString()} · {version.automationReferences.length} Automation{version.automationReferences.length === 1 ? "" : "s"}</p>
                  {index > 0 && version.automationReferences.map((reference) => (
                    <Button
                      key={reference.id}
                      size="sm"
                      variant="outline"
                      className="mt-2 w-full justify-start"
                      disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm(`Update ${reference.name} from ${version.id} to ${detail.currentVersion.id}? Its schedule and input will be preserved if the input remains valid.`)) return
                        void runAction(`automation:${reference.id}`, async () => {
                          await props.client.updateAutomation(props.organizationId, reference.id, {
                            action: {
                              kind: "saved_script",
                              script: {
                                pluginId: detail.pluginId,
                                configObjectId: detail.configObjectId,
                                configObjectVersionId: detail.currentVersion.id,
                              },
                              input: reference.input,
                            },
                            executionTarget: "cloud",
                          })
                          await load()
                        })
                      }}
                    >Update Automation… · {reference.name}</Button>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card variant="outline">
            <CardHeader><CardTitle>Snapshot history</CardTitle><CardDescription>Failures remain visible without replacing the last successful result.</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              {snapshots.length === 0 ? <p className="text-sm text-muted-foreground">No snapshots yet.</p> : snapshots.map((snapshot) => (
                <div key={snapshot.receiptId} className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedReceiptId(snapshot.receiptId)}>
                    <span className="flex flex-wrap gap-2"><Badge variant={snapshot.status === "failed" ? "destructive" : "outline"}>{snapshot.status}</Badge>{snapshot.contentDeletedAt ? <Badge variant="secondary">Content deleted</Badge> : null}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{new Date(snapshot.finishedAt).toLocaleString()} · {snapshot.source} · {snapshot.configObjectVersionId.slice(0, 8)}</span>
                  </button>
                  {!snapshot.contentDeletedAt && detail.canManage ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete snapshot content"
                      disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm("Delete this snapshot's input, JSON, and Markdown? Audit facts will remain.")) return
                        void runAction(`delete:${snapshot.receiptId}`, async () => {
                          await props.client.deleteSavedCodemodeScriptSnapshotContent(props.organizationId, detail.configObjectId, snapshot.receiptId)
                          await load()
                        })
                      }}
                    ><Trash2 /></Button>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
