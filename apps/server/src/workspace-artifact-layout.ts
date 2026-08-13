import {
  workspaceArtifactLayoutSchema,
  type WorkspaceArtifactLayout,
} from "@openwork/types/dynamic-artifacts";
import { runtimeDbPath } from "./runtime-db.js";
import type { ServerConfig } from "./types.js";
import { createWorkspaceKvStore } from "./workspace-kv-store.js";

export const EMPTY_WORKSPACE_ARTIFACT_LAYOUT: WorkspaceArtifactLayout = {
  version: 1,
  expanded: false,
  height: "standard",
  visibleWidgets: 1,
  activeWidgetId: null,
  widgets: [],
};

function normalizeWorkspaceArtifactLayout(value: unknown): WorkspaceArtifactLayout {
  const parsed = workspaceArtifactLayoutSchema.safeParse(value);
  if (!parsed.success) return EMPTY_WORKSPACE_ARTIFACT_LAYOUT;

  const widgets = parsed.data.widgets.filter((widget, index, all) => (
    all.findIndex((candidate) => candidate.id === widget.id) === index
  ));
  const activeWidgetId = parsed.data.activeWidgetId
    && widgets.some((widget) => widget.id === parsed.data.activeWidgetId)
    ? parsed.data.activeWidgetId
    : widgets[0]?.id ?? null;

  return {
    ...parsed.data,
    expanded: parsed.data.expanded && widgets.length > 0,
    activeWidgetId,
    widgets,
  };
}

function parseWorkspaceArtifactLayout(value: string): WorkspaceArtifactLayout {
  try {
    return normalizeWorkspaceArtifactLayout(JSON.parse(value));
  } catch {
    return EMPTY_WORKSPACE_ARTIFACT_LAYOUT;
  }
}

const workspaceArtifactLayoutStore = createWorkspaceKvStore<WorkspaceArtifactLayout>({
  tableName: "workspace_artifact_layouts",
  valueColumn: "layout_json",
  extraColumns: { schemaVersion: { name: "schema_version", definition: "INTEGER NOT NULL DEFAULT 1", value: 1 } },
  parse: parseWorkspaceArtifactLayout,
  serialize: (value) => JSON.stringify(value),
});

export async function readWorkspaceArtifactLayout(
  config: ServerConfig,
  workspaceId: string,
): Promise<{ layout: WorkspaceArtifactLayout; updatedAt: number | null }> {
  const row = await workspaceArtifactLayoutStore.getRow(config, workspaceId);
  return row
    ? { layout: row.value, updatedAt: row.updatedAt }
    : { layout: EMPTY_WORKSPACE_ARTIFACT_LAYOUT, updatedAt: null };
}

const updateQueueByWorkspace = new Map<string, Promise<void>>();

export async function writeWorkspaceArtifactLayout(
  config: ServerConfig,
  workspaceId: string,
  layout: WorkspaceArtifactLayout,
): Promise<{ layout: WorkspaceArtifactLayout; updatedAt: number }> {
  const key = `${runtimeDbPath(config)}:${workspaceId}`;
  const previous = updateQueueByWorkspace.get(key) ?? Promise.resolve();
  let release = () => {};
  const queued = new Promise<void>((resolve) => {
    release = resolve;
  });
  const currentQueue = previous.then(() => queued, () => queued);
  updateQueueByWorkspace.set(key, currentQueue);

  await previous.catch(() => undefined);
  try {
    const next = normalizeWorkspaceArtifactLayout(layout);
    const updatedAt = Date.now();
    await workspaceArtifactLayoutStore.set(config, workspaceId, next, updatedAt);
    return { layout: next, updatedAt };
  } finally {
    release();
    if (updateQueueByWorkspace.get(key) === currentQueue) {
      updateQueueByWorkspace.delete(key);
    }
  }
}
