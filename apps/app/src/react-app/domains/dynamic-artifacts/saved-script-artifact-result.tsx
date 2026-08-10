/** @jsxImportSource react */
import type { ArtifactFreshness, SavedScriptArtifactSnapshot } from "@openwork/types/dynamic-artifacts"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MarkdownBlock } from "@/react-app/domains/session/surface/markdown"

function freshnessLabel(freshness: ArtifactFreshness) {
  if (freshness.state === "never_run") return "Never run"
  if (freshness.state === "needs_attention") return "Needs attention"
  return freshness.state === "fresh" ? "Fresh" : "Stale"
}

function freshnessVariant(freshness: ArtifactFreshness): "default" | "secondary" | "destructive" | "outline" {
  if (freshness.state === "fresh") return "default"
  if (freshness.state === "needs_attention") return "destructive"
  return freshness.state === "stale" ? "secondary" : "outline"
}

export function SavedScriptArtifactResult(props: {
  snapshot: SavedScriptArtifactSnapshot
  freshness?: ArtifactFreshness
  lastSuccessful?: boolean
}) {
  const snapshot = props.snapshot
  return (
    <div className="space-y-3" data-testid="saved-script-artifact-result">
      <div className="flex flex-wrap gap-2">
        {props.freshness ? <Badge variant={freshnessVariant(props.freshness)}>{freshnessLabel(props.freshness)}</Badge> : null}
        {props.lastSuccessful ? <Badge variant="secondary">Last successful</Badge> : null}
        <Badge variant="outline">Exact Script version {snapshot.configObjectVersionId.slice(0, 8)}</Badge>
        <Badge variant="outline">{snapshot.source === "scheduled" ? "Scheduled" : "Manual"}</Badge>
        {snapshot.source === "scheduled" ? <Badge variant="outline">OpenWork Cloud</Badge> : null}
      </div>
      {snapshot.contentDeletedAt ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Artifact content deleted</p>
      ) : (
        <Tabs defaultValue="preview">
          <TabsList variant="line">
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="lineage">Lineage</TabsTrigger>
          </TabsList>
          <TabsContent value="preview" className="max-h-96 overflow-auto rounded-lg border border-border p-4">
            {snapshot.markdown ? <MarkdownBlock text={snapshot.markdown} /> : <p className="text-sm text-muted-foreground">No rendered result is retained.</p>}
          </TabsContent>
          <TabsContent value="data">
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 font-mono text-xs">{JSON.stringify(snapshot.value, null, 2)}</pre>
          </TabsContent>
          <TabsContent value="lineage">
            <dl className="grid gap-3 rounded-lg border border-border p-4 text-xs sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Receipt</dt><dd className="break-all font-mono">{snapshot.receiptId}</dd></div>
              <div><dt className="text-muted-foreground">Script version</dt><dd className="break-all font-mono">{snapshot.configObjectVersionId}</dd></div>
              <div><dt className="text-muted-foreground">Started</dt><dd>{new Date(snapshot.startedAt).toLocaleString()}</dd></div>
              <div><dt className="text-muted-foreground">Finished</dt><dd>{new Date(snapshot.finishedAt).toLocaleString()}</dd></div>
              <div><dt className="text-muted-foreground">Code digest</dt><dd className="break-all font-mono">{snapshot.codeDigest}</dd></div>
              <div><dt className="text-muted-foreground">Result digest</dt><dd className="break-all font-mono">{snapshot.resultDigest ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Output schema digest</dt><dd className="break-all font-mono">{snapshot.outputSchemaDigest ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Renderer</dt><dd>{snapshot.rendererVersion ?? "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">Input</dt><dd><pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono">{JSON.stringify(snapshot.input, null, 2)}</pre></dd></div>
              {snapshot.automationRunId ? <div className="sm:col-span-2"><dt className="text-muted-foreground">Automation run</dt><dd className="break-all font-mono">{snapshot.automationRunId}</dd></div> : null}
            </dl>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
