/** @jsxImportSource react */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Plus, RefreshCw, SquarePen } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/react-app/shell/workspace-provider";
import { builtinHelloEntry, type DashboardEntry, type DashboardMcpAppEntry } from "./dashboard-store";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    // Adding through the picker is the user's consent to automatic launches;
    // write-tools stay run-on-request regardless.
    ...(app.requiresApproval ? {} : { autoLaunch: true }),
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
        server.apps.map((app) => (
          <CatalogAppRow
            key={`${app.serverName}:${app.toolName}`}
            app={app}
            added={existingIds.has(mcpEntryFromCatalogApp(app).id)}
            onAdd={onAdd}
          />
        ))
      )}
    </section>
  );
}

function CatalogAppRow({ app, added, onAdd }: {
  app: OpenworkMcpAppCatalogApp;
  added: boolean;
  onAdd: (entry: DashboardEntry) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [argsText, setArgsText] = useState("");
  const [argsError, setArgsError] = useState<string | null>(null);
  const entry = mcpEntryFromCatalogApp(app);
  // Every add goes through the details panel: it names what adding consents
  // to (automatic launches, data modification, stored input) so no tool runs
  // later on a server-controlled hint the user never saw.
  const buildEntry = (launchArguments?: Record<string, unknown>): DashboardMcpAppEntry => ({
    ...entry,
    ...(launchArguments ? { launchArguments } : {}),
    ...(app.requiresApproval ? { requiresApproval: true, launchApproved: true } : {}),
  });
  const addFromDetails = () => {
    let launchArguments: Record<string, unknown> | undefined;
    if (app.requiresInput) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(argsText);
      } catch {
        setArgsError("This is not valid JSON.");
        return;
      }
      if (!isRecord(parsed)) {
        setArgsError("Launch input must be a JSON object, for example {\"query\": \"…\"}.");
        return;
      }
      launchArguments = parsed;
    }
    setArgsError(null);
    setDetailsOpen(false);
    onAdd(buildEntry(launchArguments));
  };
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{entry.title}</p>
          {app.description ? (
            <p className="line-clamp-2 text-xs break-words text-muted-foreground">{app.description}</p>
          ) : null}
        </div>
        {app.requiresInput ? (
          <Badge variant="outline" title="This app needs launch input; you provide it once when adding.">
            <AlertTriangle className="size-3" /> Requires input
          </Badge>
        ) : null}
        {app.requiresApproval ? (
          <Badge variant="outline" title="This app modifies data when it runs; its tile only runs on request.">
            <SquarePen className="size-3" /> Modifies data
          </Badge>
        ) : null}
        {added ? (
          <Button variant="ghost" size="sm" disabled>
            <Check className="size-4" /> Added
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Add ${entry.title}`}
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((value) => !value)}
          >
            <Plus className="size-4" /> Add…
          </Button>
        )}
      </div>
      {detailsOpen && !added ? (
        <div className="space-y-1">
          {app.requiresInput ? (
            <>
              <Textarea
                value={argsText}
                onChange={(event) => setArgsText(event.target.value)}
                placeholder='{"key": "value"}'
                rows={3}
                className="font-mono text-xs"
                aria-label={`Launch input for ${entry.title}`}
              />
              <p className="text-xs text-muted-foreground">
                Paste the launch arguments as a JSON object. The tile reuses them
                on every launch and refresh.
              </p>
            </>
          ) : null}
          {app.requiresApproval ? (
            <p className="text-xs text-muted-foreground">
              This app modifies data when it runs ({entry.toolName} on{" "}
              {entry.serverName}). Adding it allows that call, and the tile only
              runs when you press Run — never automatically.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Adding this app ({entry.toolName} on {entry.serverName}) lets its
              tile launch automatically whenever you open the dashboard.
            </p>
          )}
          {argsError ? <p className="text-xs text-destructive" role="alert">{argsError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDetailsOpen(false)}>Cancel</Button>
            <Button variant="outline" size="sm" onClick={addFromDetails}>
              <Plus className="size-4" />
              {app.requiresApproval ? "Add and allow" : app.requiresInput ? "Add with input" : "Add"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
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
            servers. Added apps launch automatically when the dashboard opens;
            apps that modify data only run on request. Apps that need input ask
            for JSON launch arguments when you add them.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
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
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{hello.title}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">A static local tile that ships with OpenWork.</p>
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
              MCP apps launch through a workspace&apos;s MCP runtime and none is
              available yet. Create or open a workspace, then refresh.
            </p>
          ) : null}
          {workspaceReady && catalog.isFetching && !catalog.data ? (
            <div className="space-y-2" role="status" aria-label="Loading MCP apps">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : null}
          {catalog.isError && !catalog.data && !catalog.isFetching ? (
            <p className="text-xs text-muted-foreground" role="status">
              MCP apps could not be listed: {catalog.error instanceof Error ? catalog.error.message : "unknown error"}
            </p>
          ) : null}
          {/* Keep rows mounted through background refetches: unmounting would
              destroy in-progress launch-input text in an open row. */}
          {catalog.data ? (
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
