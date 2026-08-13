/** @jsxImportSource react */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dynamicArtifactAppToolName,
  type WorkspaceArtifactLayout,
  type WorkspaceArtifactWidget,
} from "@openwork/types/dynamic-artifacts";
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LoaderCircle,
  MoveLeft,
  MoveRight,
  RefreshCcw,
  Rows3,
  Settings2,
  Trash2,
} from "lucide-react";

import type { OpenworkMcpAppToolResult, OpenworkServerClient } from "@/app/lib/openwork-server";
import { McpAppFrame, type PreservedMcpAppResult } from "@/components/chat/mcp-app-frame";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  reorderWorkspaceArtifact,
  selectWorkspaceArtifact,
  selectWorkspaceArtifactOffset,
  unpinWorkspaceArtifact,
  useWorkspaceArtifactLayout,
  visibleWorkspaceArtifacts,
} from "./workspace-artifact-layout";

const HEIGHTS = {
  compact: 240,
  standard: 360,
  tall: 520,
} as const;

function workspaceArtifactWidgetQueryKey(workspaceId: string, widgetId: string) {
  return ["workspace-artifact-widget", workspaceId, widgetId] as const;
}

function preservedToolResult(result: OpenworkMcpAppToolResult): PreservedMcpAppResult {
  return {
    content: result.content,
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    ...(result._meta ? { _meta: result._meta } : {}),
  };
}

function resultMessage(result: OpenworkMcpAppToolResult): string {
  const item = result.content.find((candidate) => candidate.type === "text" && typeof candidate.text === "string");
  const text = item && typeof item.text === "string" ? item.text : null;
  return text?.trim() || "The Artifact widget could not load its current data.";
}

function WorkspaceArtifactWidgetCard({
  client,
  workspaceId,
  widget,
  height,
}: {
  client: OpenworkServerClient;
  workspaceId: string;
  widget: WorkspaceArtifactWidget;
  height: number;
}) {
  const query = useQuery({
    queryKey: workspaceArtifactWidgetQueryKey(workspaceId, widget.id),
    queryFn: async () => {
      const toolInput = { ...widget.input, configObjectId: widget.programId };
      const { app } = await client.resolveMcpAppResource(workspaceId, {
        serverName: widget.serverName,
        toolName: dynamicArtifactAppToolName,
        title: widget.title,
        resourceUri: widget.resourceUri,
      });
      const result = await client.callMcpAppTool(workspaceId, {
        serverName: app.serverName,
        name: app.toolName,
        arguments: toolInput,
      });
      if (result.isError) throw new Error(resultMessage(result));
      return {
        app,
        input: toolInput,
        result: preservedToolResult(result),
        toolName: dynamicArtifactAppToolName,
      };
    },
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  return (
    <article
      className="min-w-0 overflow-hidden bg-transparent"
      data-workspace-artifact-widget={widget.id}
      aria-label={widget.title}
    >
      <div className="relative overflow-hidden bg-transparent" style={{ height }}>
        {query.isFetching ? (
          <div className="absolute end-3 top-3 z-10 flex size-7 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm">
            <LoaderCircle className="size-3.5 animate-spin" aria-label={`Refreshing ${widget.title}`} />
          </div>
        ) : null}
        {query.data ? (
          <McpAppFrame
            surface="workspace"
            resolvedApp={query.data.app}
            toolName={query.data.toolName}
            input={query.data.input}
            result={query.data.result}
            fixedHeight={height}
          />
        ) : query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" role="status">
            <p className="max-w-sm text-sm text-muted-foreground">
              {query.error instanceof Error ? query.error.message : "This Artifact widget could not load."}
            </p>
            <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCcw className="size-3.5" />
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
            <LoaderCircle className="me-2 size-4 animate-spin" />
            Loading {widget.title}
          </div>
        )}
      </div>
    </article>
  );
}

export function WorkspaceArtifactLayoutToggle({
  client,
  workspaceId,
}: {
  client: OpenworkServerClient | null;
  workspaceId: string;
}) {
  const { layout, update, isLoading, error } = useWorkspaceArtifactLayout(client, workspaceId);
  const hasWidgets = layout.widgets.length > 0;
  const label = layout.expanded ? "Hide workspace artifacts" : "Show workspace artifacts";

  if (error) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              "relative rounded-xl text-gray-10 transition-colors hover:bg-muted hover:text-foreground",
              layout.expanded && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
            )}
            data-workspace-artifact-toggle
            aria-label={hasWidgets ? label : "No workspace artifacts pinned"}
            aria-pressed={layout.expanded}
            disabled={isLoading || !hasWidgets}
            onClick={() => update((current) => ({ ...current, expanded: !current.expanded }))}
          >
            <LayoutDashboard size={16} />
            {hasWidgets ? (
              <span className="absolute -end-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
                {layout.widgets.length}
              </span>
            ) : null}
          </Button>
        }
      />
      <TooltipContent>{hasWidgets ? label : "Pin an interactive Artifact from the conversation"}</TooltipContent>
    </Tooltip>
  );
}

function updateHeight(layout: WorkspaceArtifactLayout, height: string): WorkspaceArtifactLayout {
  if (height !== "compact" && height !== "standard" && height !== "tall") return layout;
  return { ...layout, height };
}

function updateVisibleWidgets(layout: WorkspaceArtifactLayout, visibleWidgets: string): WorkspaceArtifactLayout {
  if (visibleWidgets === "1") return { ...layout, visibleWidgets: 1 };
  if (visibleWidgets === "2") return { ...layout, visibleWidgets: 2 };
  if (visibleWidgets === "3") return { ...layout, visibleWidgets: 3 };
  return layout;
}

export function WorkspaceArtifactShelf({
  client,
  workspaceId,
}: {
  client: OpenworkServerClient | null;
  workspaceId: string;
}) {
  const queryClient = useQueryClient();
  const { layout, update, error } = useWorkspaceArtifactLayout(client, workspaceId);
  const swipeStartRef = useRef<number | null>(null);
  const lastWheelAtRef = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!client || error || !layout.expanded || !layout.widgets.length) return null;

  const activeWidget = layout.widgets.find((widget) => widget.id === layout.activeWidgetId) ?? layout.widgets[0];
  if (!activeWidget) return null;
  const activeIndex = layout.widgets.findIndex((widget) => widget.id === activeWidget.id);
  const widgets = visibleWorkspaceArtifacts(layout);
  const configuredCount = Math.min(layout.visibleWidgets, layout.widgets.length);
  const height = HEIGHTS[layout.height];
  const gridClass = configuredCount === 1
    ? "grid-cols-1"
    : configuredCount === 2
      ? "grid-cols-1 lg:grid-cols-2"
      : "grid-cols-1 lg:grid-cols-3";
  const move = (offset: -1 | 1) => update((current) => reorderWorkspaceArtifact(current, activeWidget.id, offset));
  const navigate = (offset: number) => update((current) => selectWorkspaceArtifactOffset(current, offset));
  const refresh = () => queryClient.invalidateQueries({
    queryKey: workspaceArtifactWidgetQueryKey(workspaceId, activeWidget.id),
  });

  return (
    <section
      className="border-t border-border/70 bg-dls-surface/95 px-4 pb-3 pt-2 mac:bg-dls-surface/80"
      data-workspace-artifact-layout
      aria-label="Workspace artifacts"
    >
      <div
        className="mb-2 flex h-9 touch-pan-y items-center gap-2 px-0.5"
        onPointerDown={(event) => {
          swipeStartRef.current = event.clientX;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          const start = swipeStartRef.current;
          swipeStartRef.current = null;
          if (start === null || Math.abs(event.clientX - start) < 48) return;
          navigate(event.clientX < start ? 1 : -1);
        }}
        onWheel={(event) => {
          if (Math.abs(event.deltaX) < 24 || Date.now() - lastWheelAtRef.current < 350) return;
          lastWheelAtRef.current = Date.now();
          navigate(event.deltaX > 0 ? 1 : -1);
        }}
      >
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <LayoutDashboard className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground" data-workspace-artifact-active-title>{activeWidget.title}</p>
          <p className="text-[10px] text-muted-foreground">Workspace dashboard · {activeIndex + 1} of {layout.widgets.length}</p>
        </div>

        {layout.widgets.length > 1 ? (
          <div className="hidden items-center gap-1 sm:flex" aria-label="Choose workspace Artifact">
            {layout.widgets.map((widget) => (
              <button
                key={widget.id}
                type="button"
                className={cn(
                  "size-1.5 rounded-full bg-muted-foreground/30 transition-all hover:bg-muted-foreground/60",
                  widget.id === activeWidget.id && "w-4 bg-primary",
                )}
                aria-label={`Show ${widget.title}`}
                aria-current={widget.id === activeWidget.id ? "true" : undefined}
                onClick={() => update((current) => selectWorkspaceArtifact(current, widget.id))}
              />
            ))}
          </div>
        ) : null}

        {layout.widgets.length > 1 ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="rounded-lg"
              aria-label="Previous workspace Artifact"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="rounded-lg"
              aria-label="Next workspace Artifact"
              onClick={() => navigate(1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-lg"
          aria-label={`Refresh ${activeWidget.title}`}
          onClick={() => void refresh()}
        >
          <RefreshCcw className="size-3.5" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn("rounded-lg", settingsOpen && "bg-muted text-foreground")}
          aria-label="Configure workspace Artifact layout"
          aria-expanded={settingsOpen}
          aria-controls="workspace-artifact-layout-settings"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </div>

      {settingsOpen ? (
        <div
          id="workspace-artifact-layout-settings"
          className="mb-2 grid gap-2 rounded-2xl border border-border/70 bg-background/80 p-2 shadow-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          data-workspace-artifact-layout-settings
        >
          <div className="min-w-0">
            <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Widget height</p>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1" role="group" aria-label="Widget height">
              {(["compact", "standard", "tall"] as const).map((heightOption) => (
                <Button
                  key={heightOption}
                  type="button"
                  variant={layout.height === heightOption ? "secondary" : "ghost"}
                  size="xs"
                  className="h-7 rounded-lg capitalize"
                  aria-label={`${heightOption[0]?.toUpperCase()}${heightOption.slice(1)} widget height`}
                  aria-pressed={layout.height === heightOption}
                  onClick={() => update((current) => updateHeight(current, heightOption))}
                >
                  {heightOption}
                </Button>
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Widgets visible</p>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1" role="group" aria-label="Widgets visible">
              {([1, 2, 3] as const).map((count) => (
                <Button
                  key={count}
                  type="button"
                  variant={layout.visibleWidgets === count ? "secondary" : "ghost"}
                  size="xs"
                  className="h-7 rounded-lg"
                  aria-label={`${count} ${count === 1 ? "widget" : "widgets"} visible`}
                  aria-pressed={layout.visibleWidgets === count}
                  onClick={() => update((current) => updateVisibleWidgets(current, String(count)))}
                >
                  <Rows3 className="size-3.5" />
                  {count}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-1">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Move widget left" disabled={activeIndex <= 0} onClick={() => move(-1)}>
              <MoveLeft className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Move widget right" disabled={activeIndex >= layout.widgets.length - 1} onClick={() => move(1)}>
              <MoveRight className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Unpin ${activeWidget.title}`}
              onClick={() => update((current) => unpinWorkspaceArtifact(current, activeWidget.id))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <div className={cn("grid gap-3", gridClass)}>
        {widgets.map((widget) => (
          <WorkspaceArtifactWidgetCard
            key={widget.id}
            client={client}
            workspaceId={workspaceId}
            widget={widget}
            height={height}
          />
        ))}
      </div>
    </section>
  );
}
