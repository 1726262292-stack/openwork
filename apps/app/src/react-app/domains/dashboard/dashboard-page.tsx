/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { LayoutDashboard, Plus } from "lucide-react";

import { readDenSettings } from "@/app/lib/den";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import { AddAppDialog } from "./add-app-dialog";
import {
  dashboardScopeKey,
  readDashboardEntries,
  writeDashboardEntries,
  type DashboardEntry,
} from "./dashboard-store";
import { HelloWorldTile } from "./hello-world-tile";
import { McpAppTile } from "./mcp-app-tile";

/**
 * The per-user MCP Apps dashboard: a session-independent grid of app tiles.
 * Entries persist locally per signed-in user and organization, so switching
 * sessions or workspaces never changes the board.
 */
export function DashboardPage() {
  const denAuth = useDenAuth();
  const scopeKey = useMemo(() => {
    const settings = readDenSettings();
    return dashboardScopeKey(denAuth.user?.id ?? null, settings.activeOrgId ?? null);
  }, [denAuth.user?.id]);
  const [entries, setEntries] = useState<DashboardEntry[]>(() => readDashboardEntries(scopeKey));
  useEffect(() => {
    setEntries(readDashboardEntries(scopeKey));
  }, [scopeKey]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const existingIds = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries]);

  const updateEntries = (next: DashboardEntry[]) => {
    setEntries(next);
    writeDashboardEntries(scopeKey, next);
  };
  const removeEntry = (id: string) => updateEntries(entries.filter((entry) => entry.id !== id));

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6" data-dashboard-page>
      <header className="mb-4 flex items-center gap-2">
        <p className="flex-1 text-sm text-muted-foreground">
          Your MCP apps, one click away in every session.
        </p>
        <Button onClick={() => setPickerOpen(true)}>
          <Plus className="size-4" /> Add app
        </Button>
      </header>
      {entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><LayoutDashboard /></EmptyMedia>
            <EmptyTitle>No apps yet</EmptyTitle>
            <EmptyDescription>
              Add MCP apps available via OpenWork Connect to keep them one click away.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setPickerOpen(true)}>
              <Plus className="size-4" /> Add app
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {entries.map((entry) => (
            entry.kind === "builtin-hello" ? (
              <HelloWorldTile key={entry.id} onRemove={() => removeEntry(entry.id)} />
            ) : (
              <McpAppTile key={entry.id} entry={entry} onRemove={() => removeEntry(entry.id)} />
            )
          ))}
        </div>
      )}
      <AddAppDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        existingIds={existingIds}
        onAdd={(entry) => {
          if (!existingIds.has(entry.id)) updateEntries([...entries, entry]);
        }}
      />
    </div>
  );
}
