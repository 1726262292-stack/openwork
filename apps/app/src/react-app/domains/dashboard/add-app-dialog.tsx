/** @jsxImportSource react */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Plus, RefreshCw } from "lucide-react";

import type { OpenworkMcpAppCatalogApp, OpenworkMcpAppCatalogServer } from "@/app/lib/openwork-server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/react-app/shell/workspace-provider";
import { builtinHelloEntry, type DashboardEntry, type DashboardMcpAppEntry } from "./dashboard-store";

export function mcpEntryFromCatalogApp(app: OpenworkMcpAppCatalogApp): DashboardMcpAppEntry {
  return {
    kind: "mcp",
    id: `mcp:${app.serverName}:${app.toolName}`,
    serverName: app.serverName,
    ...(app.connectionId ? { connectionId: app.connectionId } : {}),
    toolName: app.toolName,
    projectedToolName: app.projectedToolName,
    resourceUri: app.resourceUri,
    title: app.title ?? app.toolName,
  };
}

type AddAppDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingIds: ReadonlySet<string>;
  onAdd: (entry: DashboardEntry) => void;
};

function AddButton({ added, disabled, onAdd, label }: {
  added: boolean;
  disabled?: boolean;
  onAdd: () => void;
  label: string;
}) {
  if (added) {
    return (
      <Button variant="ghost" size="sm" disabled>
        <Check className="size-4" /> Added
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" disabled={disabled} aria-label={`Add ${label}`} onClick={onAdd}>
      <Plus className="size-4" /> Add
    </Button>
  );
}

function ServerSection({ server, existingIds, onAdd }: {
  server: OpenworkMcpAppCatalogServer;
  existingIds: ReadonlySet<string>;
  onAdd: (entry: DashboardEntry) => void;
}) {
  return (
    <section className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">
          {server.displayName ?? server.serverName}
        </span>
        {server.reachable ? (
          <Badge variant="secondary">Connected</Badge>
        ) : (
          <Badge variant="destructive" title={server.error}>Not connected</Badge>
        )}
      </div>
      {!server.reachable ? (
        <p className="text-xs text-muted-foreground">
          This MCP server is not reachable right now, so its apps cannot be listed.
        </p>
      ) : server.apps.length === 0 ? (
        <p className="text-xs text-muted-foreground">This MCP server does not advertise any apps.</p>
      ) : (
        server.apps.map((app) => {
          const entry = mcpEntryFromCatalogApp(app);
          return (
            <div key={entry.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{entry.title}</p>
                {app.description ? (
                  <p className="truncate text-xs text-muted-foreground">{app.description}</p>
                ) : null}
              </div>
              {app.requiresInput ? (
                <Badge variant="outline" title="This app needs launch input, which dashboard tiles do not provide.">
                  <AlertTriangle className="size-3" /> Requires input
                </Badge>
              ) : null}
              <AddButton
                added={existingIds.has(entry.id)}
                disabled={app.requiresInput}
                label={entry.title}
                onAdd={() => onAdd(entry)}
              />
            </div>
          );
        })
      )}
    </section>
  );
}

export function AddAppDialog({ open, onOpenChange, existingIds, onAdd }: AddAppDialogProps) {
  const { openworkServerClient, workspaceId } = useWorkspace();
  const workspaceReady = Boolean(openworkServerClient) && Boolean(workspaceId);
  const catalog = useQuery({
    queryKey: ["mcp-app-catalog", workspaceId],
    queryFn: () => {
      if (!openworkServerClient || !workspaceId) throw new Error("No connected workspace is available.");
      return openworkServerClient.listMcpApps(workspaceId);
    },
    enabled: open && workspaceReady,
    staleTime: 30_000,
  });
  const hello = builtinHelloEntry();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add app</DialogTitle>
          <DialogDescription>
            MCP apps available via OpenWork Connect and this workspace&apos;s MCP
            servers. Only apps that can start without input can be added.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs font-medium text-muted-foreground">
              {!workspaceReady
                ? "Waiting for a connected workspace…"
                : catalog.isFetching
                  ? "Checking your MCP servers…"
                  : catalog.data
                    ? `Checked ${catalog.data.servers.length} MCP source${catalog.data.servers.length === 1 ? "" : "s"}.`
                    : null}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!workspaceReady || catalog.isFetching}
              onClick={() => {
                void catalog.refetch();
              }}
            >
              <RefreshCw className="size-4" /> Refresh
            </Button>
          </div>
          <section className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Built-in</span>
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{hello.title}</p>
                <p className="truncate text-xs text-muted-foreground">A static local tile that ships with OpenWork.</p>
              </div>
              <AddButton
                added={existingIds.has(hello.id)}
                label={hello.title}
                onAdd={() => onAdd(hello)}
              />
            </div>
          </section>
          {!workspaceReady ? (
            <p className="text-xs text-muted-foreground" role="status">
              MCP apps cannot be listed until a workspace connection is ready.
              Open a session in this workspace first, then try again.
            </p>
          ) : null}
          {workspaceReady && catalog.isFetching ? (
            <div className="space-y-2" role="status" aria-label="Loading MCP apps">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : null}
          {catalog.isError && !catalog.isFetching ? (
            <p className="text-xs text-muted-foreground" role="status">
              MCP apps could not be listed: {catalog.error instanceof Error ? catalog.error.message : "unknown error"}
            </p>
          ) : null}
          {catalog.data && !catalog.isFetching ? (
            catalog.data.servers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No MCP app sources were found. Connect an MCP server in Settings,
                or sign in to OpenWork Connect, then refresh.
              </p>
            ) : (
              catalog.data.servers.map((server) => (
                <ServerSection
                  key={server.serverName}
                  server={server}
                  existingIds={existingIds}
                  onAdd={onAdd}
                />
              ))
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
