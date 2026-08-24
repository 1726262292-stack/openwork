/** @jsxImportSource react */
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DashboardTileShell } from "./dashboard-tile-shell";

/**
 * Minimal built-in tile so the dashboard is never empty on first open. It is
 * a static local component, deliberately marked built-in: no MCP server, no
 * network, no launch capability.
 */
export function HelloWorldTile({ onRemove }: { onRemove: () => void }) {
  return (
    <DashboardTileShell
      title="Hello World"
      badge={<Badge variant="secondary">Built-in</Badge>}
      onRemove={onRemove}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <Sparkles className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Hello from your dashboard</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          This is your permanent home for MCP apps. Use Add app to pin
          interactive apps from your connected MCP servers.
        </p>
      </div>
    </DashboardTileShell>
  );
}
