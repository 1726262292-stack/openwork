import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  WorkspaceArtifactLayout,
  WorkspaceArtifactWidget,
} from "@openwork/types/dynamic-artifacts";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { toast } from "@/components/ui/sonner";

type WorkspaceArtifactLayoutResponse = {
  layout: WorkspaceArtifactLayout;
  updatedAt: number | null;
};

export function emptyWorkspaceArtifactLayout(): WorkspaceArtifactLayout {
  return {
    version: 1,
    expanded: false,
    height: "standard",
    visibleWidgets: 1,
    activeWidgetId: null,
    widgets: [],
  };
}

export function workspaceArtifactWidgetIdentity(
  widget: Pick<WorkspaceArtifactWidget, "programId" | "serverName" | "resourceUri" | "input">,
): string {
  return `${widget.serverName}\0${widget.programId}\0${widget.resourceUri}\0${JSON.stringify(widget.input)}`;
}

export function pinWorkspaceArtifact(
  layout: WorkspaceArtifactLayout,
  widget: WorkspaceArtifactWidget,
): WorkspaceArtifactLayout {
  const identity = workspaceArtifactWidgetIdentity(widget);
  const existing = layout.widgets.find((candidate) => workspaceArtifactWidgetIdentity(candidate) === identity);
  if (existing) {
    return {
      ...layout,
      expanded: true,
      activeWidgetId: existing.id,
      widgets: layout.widgets.map((candidate) => candidate.id === existing.id ? { ...candidate, title: widget.title } : candidate),
    };
  }
  if (layout.widgets.length >= 12) return layout;
  return {
    ...layout,
    expanded: true,
    activeWidgetId: widget.id,
    widgets: [...layout.widgets, widget],
  };
}

export function unpinWorkspaceArtifact(
  layout: WorkspaceArtifactLayout,
  widgetId: string,
): WorkspaceArtifactLayout {
  const index = layout.widgets.findIndex((widget) => widget.id === widgetId);
  if (index < 0) return layout;
  const widgets = layout.widgets.filter((widget) => widget.id !== widgetId);
  const activeWidgetId = layout.activeWidgetId === widgetId
    ? widgets[index]?.id ?? widgets[index - 1]?.id ?? widgets[0]?.id ?? null
    : layout.activeWidgetId;
  return {
    ...layout,
    expanded: widgets.length > 0 && layout.expanded,
    activeWidgetId,
    widgets,
  };
}

export function selectWorkspaceArtifact(
  layout: WorkspaceArtifactLayout,
  widgetId: string,
): WorkspaceArtifactLayout {
  return layout.widgets.some((widget) => widget.id === widgetId)
    ? { ...layout, activeWidgetId: widgetId }
    : layout;
}

export function selectWorkspaceArtifactOffset(
  layout: WorkspaceArtifactLayout,
  offset: number,
): WorkspaceArtifactLayout {
  if (layout.widgets.length < 2) return layout;
  const current = Math.max(0, layout.widgets.findIndex((widget) => widget.id === layout.activeWidgetId));
  const next = (current + offset + layout.widgets.length) % layout.widgets.length;
  return { ...layout, activeWidgetId: layout.widgets[next]?.id ?? layout.activeWidgetId };
}

export function reorderWorkspaceArtifact(
  layout: WorkspaceArtifactLayout,
  widgetId: string,
  offset: -1 | 1,
): WorkspaceArtifactLayout {
  const index = layout.widgets.findIndex((widget) => widget.id === widgetId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= layout.widgets.length) return layout;
  const widgets = [...layout.widgets];
  const selected = widgets[index];
  const adjacent = widgets[target];
  if (!selected || !adjacent) return layout;
  widgets[index] = adjacent;
  widgets[target] = selected;
  return { ...layout, widgets };
}

export function visibleWorkspaceArtifacts(layout: WorkspaceArtifactLayout): WorkspaceArtifactWidget[] {
  if (!layout.widgets.length) return [];
  const start = Math.max(0, layout.widgets.findIndex((widget) => widget.id === layout.activeWidgetId));
  const count = Math.min(layout.visibleWidgets, layout.widgets.length);
  return Array.from({ length: count }, (_, offset) => layout.widgets[(start + offset) % layout.widgets.length])
    .filter((widget) => widget !== undefined);
}

function layoutQueryKey(workspaceId: string) {
  return ["workspace-artifact-layout", workspaceId] as const;
}

export function useWorkspaceArtifactLayout(
  client: OpenworkServerClient | null,
  workspaceId: string,
) {
  const queryClient = useQueryClient();
  const queryKey = layoutQueryKey(workspaceId);
  const query = useQuery({
    queryKey,
    queryFn: () => {
      if (!client || !workspaceId) throw new Error("Workspace Artifact layouts are unavailable.");
      return client.getWorkspaceArtifactLayout(workspaceId);
    },
    enabled: Boolean(client && workspaceId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const mutation = useMutation({
    mutationFn: (layout: WorkspaceArtifactLayout) => {
      if (!client || !workspaceId) throw new Error("Workspace Artifact layouts are unavailable.");
      return client.updateWorkspaceArtifactLayout(workspaceId, layout);
    },
    scope: { id: `workspace-artifact-layout:${workspaceId}` },
    onMutate: async (layout) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<WorkspaceArtifactLayoutResponse>(queryKey);
      queryClient.setQueryData<WorkspaceArtifactLayoutResponse>(queryKey, {
        layout,
        updatedAt: previous?.updatedAt ?? null,
      });
      return { previous };
    },
    onError: (cause, _layout, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error(cause instanceof Error ? cause.message : "Could not update the workspace Artifact layout.");
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
    },
  });
  const layout = query.data?.layout ?? emptyWorkspaceArtifactLayout();
  const update = useCallback((updater: (current: WorkspaceArtifactLayout) => WorkspaceArtifactLayout) => {
    const current = queryClient.getQueryData<WorkspaceArtifactLayoutResponse>(queryKey)?.layout ?? layout;
    const next = updater(current);
    if (next !== current) mutation.mutate(next);
  }, [layout, mutation, queryClient, queryKey]);

  return {
    layout,
    update,
    isLoading: query.isLoading,
    isSaving: mutation.isPending,
    error: query.error,
  };
}
