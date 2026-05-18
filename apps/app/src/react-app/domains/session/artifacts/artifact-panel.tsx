/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, Loader2, X } from "lucide-react";

import type { OpenworkServerClient } from "../../../../app/lib/openwork-server";
import { openDesktopPath } from "../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { MarkdownBlock } from "../surface/markdown";
import type { OpenTarget } from "./open-target";

type ArtifactPanelProps = {
  client: OpenworkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  target: OpenTarget;
  onClose: () => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "text"; content: string }
  | { status: "binary"; url: string; contentType: string | null };

function absoluteWorkspacePath(root: string, path: string) {
  const cleanRoot = root.trim().replace(/[/\\]+$/, "");
  const cleanPath = path.trim().replace(/^\.\//, "");
  return cleanRoot ? `${cleanRoot}/${cleanPath}` : cleanPath;
}

function parseDelimited(content: string, delimiter: string) {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 200)
    .map((line) => line.split(delimiter).map((cell) => cell.replace(/^"|"$/g, "")));
}

function encodeArtifactId(path: string) {
  const bytes = new TextEncoder().encode(path);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function SheetPreview(props: { target: OpenTarget; content?: string }) {
  const ext = props.target.name.toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls" || ext === "ods") {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-sm rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileText className="size-5" />
          </div>
          <div className="text-sm font-medium text-foreground">Spreadsheet preview needs a parser</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            OpenWork detected this spreadsheet reliably. Full .xlsx rendering can be added with a lazy-loaded parser; for now open it externally.
          </p>
        </div>
      </div>
    );
  }

  const rows = parseDelimited(props.content ?? "", ext === "tsv" ? "\t" : ",");
  if (!rows.length) return <div className="p-4 text-sm text-muted-foreground">No rows to preview.</div>;
  return (
    <div className="h-full overflow-auto p-3">
      <table className="w-full border-collapse text-xs">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.slice(0, 40).map((cell, cellIndex) => (
                <td key={cellIndex} className="max-w-[220px] truncate border border-border px-2 py-1 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ArtifactPanel({ client, workspaceId, workspaceRoot, target, onClose }: ArtifactPanelProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const canReadAsText = ["markdown", "text", "sheet"].includes(target.preview) && !/\.(xlsx|xls|ods)$/i.test(target.value);
  const externalPath = useMemo(() => target.kind === "file" ? absoluteWorkspacePath(workspaceRoot, target.value) : target.value, [target.kind, target.value, workspaceRoot]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "loading" });

    async function load() {
      try {
        if (target.kind === "url") {
          setState({ status: "error", message: "URLs open in browser tabs." });
          return;
        }
        if (canReadAsText) {
          const result = await client.readWorkspaceFile(workspaceId, target.value);
          if (!cancelled) setState({ status: "text", content: result.content });
          return;
        }
        const result = await client.downloadArtifact(workspaceId, encodeArtifactId(target.value));
        objectUrl = URL.createObjectURL(new Blob([result.data], { type: result.contentType ?? "application/octet-stream" }));
        if (!cancelled) setState({ status: "binary", url: objectUrl, contentType: result.contentType });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "Failed to load artifact" });
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [canReadAsText, client, target, workspaceId]);

  const openExternal = () => {
    if (target.kind === "url") window.open(target.value, "_blank", "noopener,noreferrer");
    else void openDesktopPath(externalPath);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{target.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{target.value}</div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={openExternal} aria-label="Open externally" title="Open externally">
          <ExternalLink />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close artifact" title="Close artifact">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {state.status === "loading" ? (
          <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
        ) : state.status === "error" ? (
          <div className="p-4 text-sm text-muted-foreground">{state.message}</div>
        ) : target.preview === "markdown" && state.status === "text" ? (
          <div className="h-full overflow-auto p-4"><MarkdownBlock text={state.content} /></div>
        ) : target.preview === "sheet" ? (
          <SheetPreview target={target} content={state.status === "text" ? state.content : undefined} />
        ) : target.preview === "image" && state.status === "binary" ? (
          <div className="flex h-full items-center justify-center overflow-auto bg-muted/30 p-3"><img src={state.url} alt={target.name} className="max-h-full max-w-full object-contain" /></div>
        ) : state.status === "binary" && (target.preview === "pdf" || target.preview === "html") ? (
          <iframe src={state.url} title={target.name} className="h-full w-full border-0" sandbox="allow-scripts allow-same-origin" />
        ) : state.status === "text" ? (
          <pre className="h-full overflow-auto p-4 text-xs leading-5 text-foreground whitespace-pre-wrap">{state.content}</pre>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">Preview unavailable. Open externally to view this file.</div>
        )}
      </div>
    </div>
  );
}
