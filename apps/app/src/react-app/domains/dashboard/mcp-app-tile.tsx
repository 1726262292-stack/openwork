/** @jsxImportSource react */
import { useEffect, useState } from "react";

import {
  OpenworkServerError,
  type OpenworkMcpAppResource,
} from "@/app/lib/openwork-server";
import { McpAppSandboxView, type PreservedMcpAppResult } from "@/components/chat/mcp-app-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/react-app/shell/workspace-provider";
import { DashboardTileShell } from "./dashboard-tile-shell";
import type { DashboardMcpAppEntry } from "./dashboard-store";

/**
 * Dashboard tiles only host zero-config launches: the stored reference has no
 * argument payload and every (re)launch calls the tool with empty arguments.
 */
const EMPTY_ARGUMENTS: Record<string, unknown> = {};

type TileState =
  | { phase: "loading" }
  | { phase: "ready"; app: OpenworkMcpAppResource; result: PreservedMcpAppResult }
  | { phase: "closed" }
  | { phase: "error"; message: string };

function firstTextContent(content: Array<Record<string, unknown>>): string | null {
  for (const item of content) {
    if (item.type === "text" && typeof item.text === "string" && item.text.trim()) return item.text;
  }
  return null;
}

export function McpAppTile({ entry, onRemove }: { entry: DashboardMcpAppEntry; onRemove: () => void }) {
  const { openworkServerClient, workspaceId } = useWorkspace();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<TileState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    if (!openworkServerClient || !workspaceId) {
      setState({ phase: "error", message: "No connected workspace is available to launch this app." });
      return;
    }
    const client = openworkServerClient;
    void (async (): Promise<TileState> => {
      // Connect app-host apps resolve through their connection reference; the
      // host revalidates the live UI binding before returning the resource.
      const launch = entry.connectionId
        ? {
            connectionId: entry.connectionId,
            toolName: entry.toolName,
            resourceUri: entry.resourceUri,
            arguments: EMPTY_ARGUMENTS,
          }
        : undefined;
      const { app } = await client.resolveMcpApp(workspaceId, entry.projectedToolName, launch);
      if (!app) return { phase: "error", message: "This tool no longer advertises an interactive app." };
      const request = {
        serverName: app.serverName,
        name: app.toolName,
        resourceUri: app.resourceUri,
        arguments: EMPTY_ARGUMENTS,
      };
      let result;
      try {
        result = await client.callMcpAppTool(workspaceId, request);
      } catch (cause) {
        if (!(cause instanceof OpenworkServerError) || cause.code !== "tool_requires_approval") throw cause;
        const approved = window.confirm(`Allow this MCP App to call ${app.toolName} on ${app.serverName}?`);
        if (!approved) return { phase: "error", message: "The app launch was declined." };
        result = await client.callMcpAppTool(workspaceId, { ...request, approved: true });
      }
      if (result.isError) {
        return {
          phase: "error",
          message: firstTextContent(result.content)
            ?? "This app could not start without input, which the dashboard does not provide.",
        };
      }
      return {
        phase: "ready",
        app,
        result: {
          content: result.content,
          ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
          ...(result._meta ? { _meta: result._meta } : {}),
        },
      };
    })()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          phase: "error",
          message: cause instanceof Error && cause.message ? cause.message : "The app could not be launched.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [entry.connectionId, entry.projectedToolName, entry.resourceUri, entry.toolName, nonce, openworkServerClient, workspaceId]);

  return (
    <DashboardTileShell
      title={entry.title}
      subtitle={entry.serverName}
      onRefresh={() => setNonce((value) => value + 1)}
      onRemove={onRemove}
    >
      {state.phase === "loading" ? (
        <div className="space-y-2 pt-3" role="status" aria-label={`Loading ${entry.title}`}>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}
      {state.phase === "error" ? (
        <p className="pt-3 text-xs text-muted-foreground" role="status">{state.message}</p>
      ) : null}
      {state.phase === "closed" ? (
        <p className="pt-3 text-xs text-muted-foreground" role="status">
          This app closed its view. Use refresh to launch it again.
        </p>
      ) : null}
      {state.phase === "ready" ? (
        <McpAppSandboxView
          key={nonce}
          app={state.app}
          toolName={entry.projectedToolName}
          inputArguments={EMPTY_ARGUMENTS}
          result={state.result}
          unavailableNotice="This app view is unavailable."
          onRequestTeardown={() => setState({ phase: "closed" })}
        />
      ) : null}
    </DashboardTileShell>
  );
}
