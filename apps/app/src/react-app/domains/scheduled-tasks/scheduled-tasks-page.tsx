/** @jsxImportSource react */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import type {
  ReviewScheduledTaskGrant,
  ScheduledTask,
  ScheduledTaskArtifactReference,
  ScheduledTaskDefinition,
  ScheduledTaskGrant,
  ScheduledTaskRevision,
  ScheduledTaskRun,
  ScheduledTaskSchedule,
  ScheduledTaskState,
} from "@openwork/types/scheduled-tasks";

import {
  OpenworkServerError,
  type OpenworkServerClient,
  type OpenworkServerCapabilities,
} from "@/app/lib/openwork-server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { useControlAction, type OpenworkControlAction } from "@/react-app/shell/control/control-provider";
import { workspaceScheduledTasksRoute, workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import { ScheduledTaskEditor } from "./scheduled-task-editor";

const ACTIVE_RUN_STATUSES = new Set<ScheduledTaskRun["status"]>([
  "scheduled",
  "claimed",
  "running",
  "retrying",
]);

type ScheduledTaskListItem = {
  task: ScheduledTask;
  revision: ScheduledTaskRevision;
  grant?: ScheduledTaskGrant | null;
  latestRun?: ScheduledTaskRun | null;
};

type ScheduledTaskDetail = {
  task: ScheduledTask;
  draftRevision: ScheduledTaskRevision;
  activeRevision: ScheduledTaskRevision | null;
  grant: ScheduledTaskGrant | null;
  runs: ScheduledTaskRun[];
};

type ScheduledTasksPageProps = {
  routeWorkspaceId: string;
  workspaceId: string;
  workspaceRoot: string;
  taskId: string | null;
  client: OpenworkServerClient | null;
  workspaces: Array<{ id: string; label: string }>;
};

function formatTime(value: number | null | undefined) {
  if (typeof value !== "number") return t("scheduled_tasks.not_scheduled");
  return new Date(value).toLocaleString();
}

function formatDuration(value: number | null | undefined) {
  if (typeof value !== "number") return "—";
  if (value < 60_000) return `${Math.round(value / 1_000)}s`;
  return `${Math.round(value / 60_000)}m`;
}

function scheduleLabel(schedule: ScheduledTaskSchedule) {
  if (schedule.kind === "manual") return t("scheduled_tasks.manual");
  const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  if (schedule.kind === "daily") {
    return `${t("scheduled_tasks.daily")} · ${time} · ${schedule.timezone}`;
  }
  const days = schedule.daysOfWeek.join(", ");
  return `${t("scheduled_tasks.weekly")} · ${days} · ${time} · ${schedule.timezone}`;
}

function stateLabel(state: ScheduledTaskState) {
  return t(`scheduled_tasks.state_${state.replace("-", "_")}`);
}

function stateBadgeVariant(state: ScheduledTaskState): "default" | "secondary" | "destructive" | "outline" {
  if (state === "enabled") return "default";
  if (state === "needs-attention") return "destructive";
  if (state === "paused") return "secondary";
  return "outline";
}

function describeError(error: unknown) {
  if (error instanceof OpenworkServerError) {
    if (
      error.status === 401
      || error.status === 403
      || error.code.includes("workspace")
    ) {
      return t("scheduled_tasks.error_inaccessible");
    }
    if (error.code.includes("revision") || error.code.includes("stale")) {
      return t("scheduled_tasks.error_stale");
    }
    if (error.status === 404) {
      return t("scheduled_tasks.error_not_found");
    }
    return error.message;
  }
  return error instanceof Error ? error.message : t("scheduled_tasks.error_generic");
}

function downloadBlob(data: ArrayBuffer, filename: string, contentType: string | null) {
  const url = URL.createObjectURL(new Blob([data], { type: contentType ?? "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function LimitationNote({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact
        ? "flex items-center gap-2 text-xs text-muted-foreground"
        : "rounded-2xl border border-blue-7/30 bg-blue-2/40 px-4 py-3 text-sm text-blue-11"
      }
      data-scheduled-task-limitation
    >
      <Clock3 className="size-4 shrink-0" aria-hidden="true" />
      <span>{t("scheduled_tasks.limit_copy")}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4 p-6" role="status" aria-label={t("scheduled_tasks.loading")}>
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-16 text-center" role="alert">
      <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
      <div>
        <h2 className="font-medium">{t("scheduled_tasks.error_title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{describeError(error)}</p>
      </div>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        {t("common.refresh")}
      </Button>
    </div>
  );
}

function UnavailableState({ reason }: { reason: string }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <Alert variant="warning">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>{t("scheduled_tasks.unavailable_title")}</AlertTitle>
        <AlertDescription>{reason}</AlertDescription>
      </Alert>
    </div>
  );
}

function TaskListCard({
  item,
  onOpen,
}: {
  item: ScheduledTaskListItem;
  onOpen: () => void;
}) {
  return (
    <Card
      variant="outline"
      size="sm"
      className="rounded-2xl bg-card/60"
      data-scheduled-task-card={item.task.id}
    >
      <CardHeader>
        <CardTitle>{item.revision.definition.name}</CardTitle>
        <CardDescription>{item.revision.definition.description || item.revision.definition.prompt}</CardDescription>
        <CardAction>
          <Badge variant={stateBadgeVariant(item.task.state)}>{stateLabel(item.task.state)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <span className="block font-medium text-foreground">{t("scheduled_tasks.schedule")}</span>
          <span>{scheduleLabel(item.revision.definition.schedule)}</span>
        </div>
        <div>
          <span className="block font-medium text-foreground">{t("scheduled_tasks.next_run")}</span>
          <span>{formatTime(item.task.nextRunAt)}</span>
        </div>
        {item.latestRun ? (
          <div>
            <span className="block font-medium text-foreground">{t("scheduled_tasks.latest_run")}</span>
            <span>{item.latestRun.status} · {formatTime(item.latestRun.createdAt)}</span>
          </div>
        ) : null}
        {item.task.needsAttention ? (
          <div className="text-destructive">
            <span className="block font-medium">{t("scheduled_tasks.needs_attention")}</span>
            <span>{item.task.needsAttention.message}</span>
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <LimitationNote compact />
        <Button
          variant="outline"
          size="sm"
          data-open-scheduled-task={item.task.id}
          aria-label={`${t("scheduled_tasks.open")} ${item.revision.definition.name}`}
          onClick={onOpen}
        >
          {t("scheduled_tasks.open")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ScheduledTaskList({
  items,
  canWrite,
  onCreate,
  onOpen,
}: {
  items: ScheduledTaskListItem[];
  canWrite: boolean;
  onCreate: () => void;
  onOpen: (taskId: string) => void;
}) {
  const groups = useMemo(() => {
    const needsAttention: ScheduledTaskListItem[] = [];
    const running: ScheduledTaskListItem[] = [];
    const upcoming: ScheduledTaskListItem[] = [];
    const recent: ScheduledTaskListItem[] = [];
    for (const item of items) {
      if (item.task.state === "needs-attention" || item.task.needsAttention) {
        needsAttention.push(item);
      } else if (item.latestRun && ACTIVE_RUN_STATUSES.has(item.latestRun.status)) {
        running.push(item);
      } else if (item.task.enabled && item.task.nextRunAt !== null) {
        upcoming.push(item);
      } else {
        recent.push(item);
      }
    }
    return [
      { id: "needs-attention", label: t("scheduled_tasks.group_needs_attention"), items: needsAttention },
      { id: "running", label: t("scheduled_tasks.group_running"), items: running },
      { id: "upcoming", label: t("scheduled_tasks.group_upcoming"), items: upcoming },
      { id: "recent", label: t("scheduled_tasks.group_recent"), items: recent },
    ];
  }, [items]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8" data-testid="scheduled-tasks-list">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("scheduled_tasks.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("scheduled_tasks.subtitle")}</p>
        </div>
        <Button data-testid="scheduled-task-create" disabled={!canWrite} onClick={onCreate}>
          <Plus aria-hidden="true" />
          {t("scheduled_tasks.create")}
        </Button>
      </div>
      <LimitationNote />
      {items.length === 0 ? (
        <Card variant="outline" className="items-center rounded-2xl py-12 text-center">
          <CalendarClock className="size-9 text-muted-foreground" aria-hidden="true" />
          <CardHeader>
            <CardTitle>{t("scheduled_tasks.empty_title")}</CardTitle>
            <CardDescription>{t("scheduled_tasks.empty_copy")}</CardDescription>
          </CardHeader>
          <Button disabled={!canWrite} onClick={onCreate}>{t("scheduled_tasks.create")}</Button>
        </Card>
      ) : (
        <div className="space-y-7">
          {groups.filter((group) => group.items.length > 0).map((group) => (
            <section key={group.id} data-scheduled-task-group={group.id}>
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-medium">{group.label}</h3>
                <Badge variant="outline">{group.items.length}</Badge>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {group.items.map((item) => (
                  <TaskListCard key={item.task.id} item={item} onOpen={() => onOpen(item.task.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

type AuthorityEditorProps = {
  detail: ScheduledTaskDetail;
  workspaceRoot: string;
  busy: boolean;
  canWrite: boolean;
  onReview: (input: ReviewScheduledTaskGrant) => void;
  onRevoke: () => void;
};

function AuthorityEditor(props: AuthorityEditorProps) {
  const existing = props.detail.grant;
  const definition = props.detail.draftRevision.definition;
  const [roots, setRoots] = useState(
    () => existing?.authorizedWorkspaceRoots.join("\n") || props.workspaceRoot,
  );
  const [capabilities, setCapabilities] = useState(
    () => existing?.capabilityIds.join("\n") || "workspace.files.read",
  );
  const [actionClasses, setActionClasses] = useState<Array<"read" | "write" | "execute">>(
    () => existing?.actionClasses ?? ["read"],
  );
  const [filesystemRead, setFilesystemRead] = useState(existing?.filesystem.read ?? true);
  const [filesystemWrite, setFilesystemWrite] = useState(existing?.filesystem.write ?? false);
  const [grantor, setGrantor] = useState(existing?.grantor ?? t("scheduled_tasks.default_grantor"));

  const toggleAction = (action: "read" | "write" | "execute") => {
    setActionClasses((current) => {
      if (current.includes(action)) {
        return current.length === 1 ? current : current.filter((candidate) => candidate !== action);
      }
      return [...current, action];
    });
  };

  return (
    <Card variant="outline" className="rounded-2xl" data-testid="scheduled-task-authority">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" aria-hidden="true" />
          {t("scheduled_tasks.authority_title")}
        </CardTitle>
        <CardDescription>{t("scheduled_tasks.authority_copy")}</CardDescription>
        <CardAction>
          <Badge variant={existing && existing.revokedAt === null ? "secondary" : "outline"}>
            {existing && existing.revokedAt === null ? t("scheduled_tasks.reviewed") : t("scheduled_tasks.review_required")}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground" data-testid="scheduled-task-authority-workspace">
          {t("scheduled_tasks.selected_workspace", { workspace: definition.workspaceId })}
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="scheduled-task-authorized-roots">{t("scheduled_tasks.authorized_roots")}</Label>
            <Textarea
              id="scheduled-task-authorized-roots"
              data-testid="scheduled-task-authorized-roots"
              className="min-h-24 font-mono text-xs"
              value={roots}
              onChange={(event) => setRoots(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduled-task-capabilities">{t("scheduled_tasks.capability_ids")}</Label>
            <Textarea
              id="scheduled-task-capabilities"
              data-testid="scheduled-task-capabilities"
              className="min-h-24 font-mono text-xs"
              value={capabilities}
              placeholder={t("scheduled_tasks.capability_ids_placeholder")}
              onChange={(event) => setCapabilities(event.currentTarget.value)}
            />
          </div>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">{t("scheduled_tasks.action_classes")}</legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {(["read", "write", "execute"] as const).map((action) => (
              <label key={action} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  data-action-class={action}
                  checked={actionClasses.includes(action)}
                  onChange={() => toggleAction(action)}
                />
                {action}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm">
            <input data-filesystem-read type="checkbox" checked={filesystemRead} onChange={(event) => setFilesystemRead(event.currentTarget.checked)} />
            {t("scheduled_tasks.filesystem_read")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input data-filesystem-write type="checkbox" checked={filesystemWrite} onChange={(event) => setFilesystemWrite(event.currentTarget.checked)} />
            {t("scheduled_tasks.filesystem_write")}
          </label>
        </div>
        <div className="grid gap-3 rounded-xl bg-muted/50 p-3 text-xs sm:grid-cols-3">
          <div><span className="block font-medium">{t("scheduled_tasks.communication")}</span>{t("scheduled_tasks.denied")}</div>
          <div><span className="block font-medium">{t("scheduled_tasks.destructive_actions")}</span>{t("scheduled_tasks.denied")}</div>
          <div><span className="block font-medium">{t("scheduled_tasks.self_modification")}</span>{t("scheduled_tasks.denied")}</div>
        </div>
        <div className="max-w-sm space-y-2">
          <Label htmlFor="scheduled-task-grantor">{t("scheduled_tasks.reviewed_by")}</Label>
          <Input id="scheduled-task-grantor" value={grantor} onChange={(event) => setGrantor(event.currentTarget.value)} />
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        {existing && existing.revokedAt === null ? (
          <Button
            type="button"
            variant="outline"
            className="me-auto text-destructive"
            disabled={!props.canWrite || props.busy}
            onClick={() => {
              if (window.confirm(t("scheduled_tasks.revoke_confirm"))) props.onRevoke();
            }}
          >
            {t("scheduled_tasks.revoke_authority")}
          </Button>
        ) : null}
        <Button
          type="button"
          data-testid="scheduled-task-review-authority"
          disabled={!props.canWrite || props.busy || !roots.trim() || !grantor.trim()}
          onClick={() => props.onReview({
            expectedRevisionId: props.detail.draftRevision.id,
            authorizedWorkspaceRoots: roots.split("\n").map((value) => value.trim()).filter(Boolean),
            capabilityIds: capabilities.split("\n").map((value) => value.trim()).filter(Boolean),
            actionClasses,
            filesystem: { read: filesystemRead, write: filesystemWrite },
            maximumRuntimeMs: definition.maximumRuntimeMs,
            model: definition.model,
            expiresAt: null,
            grantor: grantor.trim(),
          })}
        >
          <ShieldCheck aria-hidden="true" />
          {t("scheduled_tasks.approve_authority")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ArtifactLink({
  artifact,
  onOpen,
}: {
  artifact: ScheduledTaskArtifactReference;
  onOpen: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-scheduled-task-artifact={artifact.id}
      aria-label={`${t("scheduled_tasks.open_artifact")} ${artifact.name ?? artifact.value}`}
      onClick={onOpen}
    >
      {artifact.kind === "url" ? <ExternalLink aria-hidden="true" /> : <FileText aria-hidden="true" />}
      <span className="max-w-56 truncate">{artifact.name ?? artifact.value}</span>
    </Button>
  );
}

function RunHistory({
  detail,
  busyAction,
  canExecute,
  onCancel,
  onOpenSession,
  onOpenArtifact,
}: {
  detail: ScheduledTaskDetail;
  busyAction: string | null;
  canExecute: boolean;
  onCancel: (runId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenArtifact: (
    runId: string,
    artifact: ScheduledTaskArtifactReference,
  ) => void;
}) {
  if (detail.runs.length === 0) {
    return (
      <Card variant="outline" className="rounded-2xl">
        <CardHeader>
          <CardTitle>{t("scheduled_tasks.run_history")}</CardTitle>
          <CardDescription>{t("scheduled_tasks.no_runs")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card variant="outline" className="rounded-2xl" data-testid="scheduled-task-run-history">
      <CardHeader>
        <CardTitle>{t("scheduled_tasks.run_history")}</CardTitle>
        <CardDescription>{t("scheduled_tasks.run_history_copy")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {detail.runs.map((run) => (
          <div key={run.id} className="rounded-xl border border-border p-4" data-scheduled-task-run={run.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  {run.status === "completed" ? (
                    <CheckCircle2 className="size-4 text-green-10" aria-hidden="true" />
                  ) : run.status === "failed" || run.status === "needs-attention" ? (
                    <XCircle className="size-4 text-destructive" aria-hidden="true" />
                  ) : (
                    <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="text-sm font-medium">{run.status}</span>
                  <Badge variant="outline">{run.trigger}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatTime(run.createdAt)} · {formatDuration(run.durationMs)} · {run.attemptCount} {t("scheduled_tasks.attempts")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("scheduled_tasks.usage_summary", {
                    input: run.boundedUsage.inputTokens ?? 0,
                    output: run.boundedUsage.outputTokens ?? 0,
                    cost: run.boundedUsage.costMicros ?? 0,
                  })}
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {t("scheduled_tasks.revision_binding", {
                    task: run.taskRevisionId,
                    grant: run.grantRevisionId,
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {run.sessionId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-open-scheduled-task-session={run.sessionId}
                    onClick={() => onOpenSession(run.sessionId!)}
                  >
                    {t("scheduled_tasks.open_session")}
                  </Button>
                ) : null}
                {ACTIVE_RUN_STATUSES.has(run.status) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canExecute || busyAction !== null}
                    onClick={() => onCancel(run.id)}
                  >
                    {t("scheduled_tasks.cancel_run")}
                  </Button>
                ) : null}
              </div>
            </div>
            {run.needsAttention ? (
              <p className="mt-3 rounded-lg bg-red-2/50 px-3 py-2 text-sm text-red-11">{run.needsAttention.message}</p>
            ) : null}
            {run.error ? (
              <p className="mt-3 rounded-lg bg-red-2/50 px-3 py-2 text-sm text-red-11">{run.error.message}</p>
            ) : null}
            {run.artifacts.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {run.artifacts.map((artifact) => (
                  <ArtifactLink
                    key={artifact.id}
                    artifact={artifact}
                    onOpen={() => onOpenArtifact(run.id, artifact)}
                  />
                ))}
              </div>
            ) : null}
            <ol className="mt-3 border-s border-border ps-4 text-xs text-muted-foreground">
              <li>{t("scheduled_tasks.timeline_claimed")} · {formatTime(run.claimedAt)}</li>
              {run.startedAt ? <li>{t("scheduled_tasks.timeline_started")} · {formatTime(run.startedAt)}</li> : null}
              {run.completedAt ? <li>{t("scheduled_tasks.timeline_completed")} · {formatTime(run.completedAt)}</li> : null}
            </ol>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ScheduledTaskDetailView({
  detail,
  routeWorkspaceId,
  workspaceId,
  workspaceRoot,
  client,
  capabilities,
  onBack,
  onOpenTask,
}: {
  detail: ScheduledTaskDetail;
  routeWorkspaceId: string;
  workspaceId: string;
  workspaceRoot: string;
  client: OpenworkServerClient;
  capabilities: NonNullable<OpenworkServerCapabilities["scheduledTasks"]>;
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const task = detail.task;
  const definition = detail.draftRevision.definition;
  const hasUnreviewedRevision = Boolean(
    detail.activeRevision
    && detail.activeRevision.id !== detail.draftRevision.id,
  );
  const hasActiveGrant = Boolean(
    detail.grant
    && detail.grant.revokedAt === null
    && (detail.grant.expiresAt === null || detail.grant.expiresAt > Date.now()),
  );
  const previewQuery = useQuery({
    queryKey: ["scheduled-task-preview", workspaceId, detail.draftRevision.id],
    queryFn: () => client.previewScheduledTaskSchedule(workspaceId, {
      schedule: definition.schedule,
    }),
  });

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scheduled-tasks", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["scheduled-task", workspaceId, task.id] }),
    ]);
  }, [queryClient, task.id, workspaceId]);

  const act = async (name: string, action: () => Promise<void>, success: string) => {
    setBusyAction(name);
    try {
      await action();
      await refresh();
      toast.success(success);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const openArtifact = async (
    runId: string,
    artifact: ScheduledTaskArtifactReference,
  ) => {
    if (artifact.kind === "url") {
      window.open(artifact.value, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const result = await client.downloadScheduledTaskArtifact(
        workspaceId,
        task.id,
        runId,
        artifact.id,
      );
      downloadBlob(result.data, artifact.name ?? artifact.value.split("/").at(-1) ?? "artifact", result.contentType);
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  if (editing) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8">
        <Button variant="ghost" onClick={() => setEditing(false)}>
          <ArrowLeft aria-hidden="true" />
          {t("scheduled_tasks.back_to_task")}
        </Button>
        <div>
          <h2 className="text-2xl font-semibold">{t("scheduled_tasks.edit_title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("scheduled_tasks.edit_copy")}</p>
        </div>
        <ScheduledTaskEditor
          workspaceId={workspaceId}
          initial={definition}
          busy={busyAction === "edit"}
          submitLabel={t("common.save")}
          onCancel={() => setEditing(false)}
          onPreview={async (schedule) => (await client.previewScheduledTaskSchedule(workspaceId, { schedule })).preview}
          onSave={async (nextDefinition) => {
            await act("edit", async () => {
              await client.updateScheduledTaskDraft(workspaceId, task.id, {
                expectedRevisionId: detail.draftRevision.id,
                definition: nextDefinition,
              });
              setEditing(false);
            }, t("scheduled_tasks.updated"));
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8" data-testid="scheduled-task-detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ms-2 mb-2" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            {t("scheduled_tasks.title")}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-2xl font-semibold tracking-tight">{definition.name}</h2>
            <Badge variant={stateBadgeVariant(task.state)}>{stateLabel(task.state)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{definition.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!capabilities.write || busyAction !== null} onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" />
            {t("common.edit")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!capabilities.write || busyAction !== null}
            onClick={() => void act("duplicate", async () => {
              const result = await client.duplicateScheduledTask(workspaceId, task.id);
              onOpenTask(result.task.id);
            }, t("scheduled_tasks.duplicated"))}
          >
            <Copy aria-hidden="true" />
            {t("scheduled_tasks.duplicate")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            disabled={!capabilities.write || busyAction !== null}
            onClick={() => {
              if (!window.confirm(t("scheduled_tasks.delete_confirm"))) return;
              void act("delete", async () => {
                await client.deleteScheduledTask(workspaceId, task.id);
                onBack();
              }, t("scheduled_tasks.deleted"));
            }}
          >
            <Trash2 aria-hidden="true" />
            {t("scheduled_tasks.delete")}
          </Button>
        </div>
      </div>

      <LimitationNote />

      {hasUnreviewedRevision ? (
        <Alert variant="warning" data-testid="scheduled-task-stale-revision">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t("scheduled_tasks.review_required")}</AlertTitle>
          <AlertDescription>{t("scheduled_tasks.edit_copy")}</AlertDescription>
        </Alert>
      ) : null}

      {task.needsAttention ? (
        <Alert variant="destructive" data-testid="scheduled-task-needs-attention">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t("scheduled_tasks.needs_attention")}</AlertTitle>
          <AlertDescription>{task.needsAttention.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card variant="outline" className="rounded-2xl">
        <CardHeader>
          <CardTitle>{t("scheduled_tasks.definition")}</CardTitle>
          <CardDescription>{scheduleLabel(definition.schedule)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("scheduled_tasks.prompt")}</p>
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-muted/50 p-4 text-sm">{definition.prompt}</p>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div><dt className="text-muted-foreground">{t("scheduled_tasks.next_run")}</dt><dd>{formatTime(task.nextRunAt)}</dd></div>
            <div><dt className="text-muted-foreground">{t("scheduled_tasks.timeout_minutes")}</dt><dd>{Math.round(definition.maximumRuntimeMs / 60_000)}</dd></div>
            <div><dt className="text-muted-foreground">{t("scheduled_tasks.provider")}</dt><dd>{definition.model.providerId ?? t("scheduled_tasks.default_value")}</dd></div>
            <div><dt className="text-muted-foreground">{t("scheduled_tasks.model")}</dt><dd>{definition.model.modelId ?? t("scheduled_tasks.default_value")}</dd></div>
            <div><dt className="text-muted-foreground">{t("scheduled_tasks.agent")}</dt><dd>{definition.model.agent ?? t("scheduled_tasks.default_value")}</dd></div>
          </dl>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("scheduled_tasks.next_five")}
              </p>
              {previewQuery.isFetching ? <span className="text-xs text-muted-foreground">{t("scheduled_tasks.preview_loading")}</span> : null}
            </div>
            {previewQuery.error ? (
              <p role="alert" className="text-sm text-destructive">{describeError(previewQuery.error)}</p>
            ) : previewQuery.data ? (
              <>
                <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" data-testid="scheduled-task-detail-preview">
                  {previewQuery.data.preview.occurrences.map((occurrence, index) => (
                    <li key={`${occurrence}:${index}`} className="rounded-xl bg-muted/60 px-3 py-2 text-xs">
                      <span className="block font-medium">{t("scheduled_tasks.occurrence", { count: index + 1 })}</span>
                      <time dateTime={new Date(occurrence).toISOString()}>{new Date(occurrence).toLocaleString()}</time>
                    </li>
                  ))}
                </ol>
                {previewQuery.data.preview.warnings.length > 0 ? (
                  <ul className="space-y-1 text-xs text-amber-11" data-testid="scheduled-task-preview-warnings">
                    {previewQuery.data.preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("scheduled_tasks.fixed_policies")}</p>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button
            type="button"
            data-testid="scheduled-task-run-once"
            disabled={!capabilities.execute || busyAction !== null || !hasActiveGrant}
            onClick={() => void act("run", async () => {
              await client.runScheduledTaskOnce(workspaceId, task.id);
            }, t("scheduled_tasks.run_started"))}
          >
            <Play aria-hidden="true" />
            {t("scheduled_tasks.run_once")}
          </Button>
          {task.state === "paused" && definition.schedule.kind !== "manual" ? (
            <Button
              type="button"
              variant="outline"
              data-testid="scheduled-task-resume"
              disabled={!capabilities.write || busyAction !== null}
              onClick={() => void act("resume", async () => {
                await client.resumeScheduledTask(workspaceId, task.id);
              }, t("scheduled_tasks.resumed"))}
            >
              <Play aria-hidden="true" />
              {t("scheduled_tasks.resume")}
            </Button>
          ) : task.state === "needs-attention" ? (
            <Button
              type="button"
              variant="outline"
              data-testid="scheduled-task-pause"
              disabled={!capabilities.write || busyAction !== null}
              onClick={() => void act("pause", async () => {
                await client.pauseScheduledTask(workspaceId, task.id);
              }, t("scheduled_tasks.paused"))}
            >
              <Pause aria-hidden="true" />
              {t("scheduled_tasks.pause")}
            </Button>
          ) : task.enabled ? (
            <Button
              type="button"
              variant="outline"
              data-testid="scheduled-task-pause"
              disabled={!capabilities.write || busyAction !== null}
              onClick={() => void act("pause", async () => {
                await client.pauseScheduledTask(workspaceId, task.id);
              }, t("scheduled_tasks.paused"))}
            >
              <Pause aria-hidden="true" />
              {t("scheduled_tasks.pause")}
            </Button>
          ) : definition.schedule.kind !== "manual" ? (
            <Button
              type="button"
              variant="outline"
              data-testid="scheduled-task-enable"
              disabled={!capabilities.write || busyAction !== null || !hasActiveGrant || !task.activeRevisionId}
              onClick={() => void act("enable", async () => {
                await client.enableScheduledTask(workspaceId, task.id);
              }, t("scheduled_tasks.enabled"))}
            >
              <Play aria-hidden="true" />
              {t("scheduled_tasks.enable")}
            </Button>
          ) : null}
          {!hasActiveGrant ? <span className="text-xs text-muted-foreground">{t("scheduled_tasks.review_before_run")}</span> : null}
        </CardFooter>
      </Card>

      <AuthorityEditor
        key={detail.draftRevision.id}
        detail={detail}
        workspaceRoot={workspaceRoot}
        busy={busyAction === "review"}
        canWrite={capabilities.write}
        onReview={(input) => void act("review", async () => {
          await client.reviewScheduledTaskGrant(workspaceId, task.id, input);
        }, t("scheduled_tasks.authority_approved"))}
        onRevoke={() => void act("revoke", async () => {
          await client.revokeScheduledTaskGrant(workspaceId, task.id);
        }, t("scheduled_tasks.authority_revoked"))}
      />

      <RunHistory
        detail={detail}
        busyAction={busyAction}
        canExecute={capabilities.execute}
        onCancel={(runId) => void act(`cancel:${runId}`, async () => {
          await client.cancelScheduledTaskRun(workspaceId, task.id, runId);
        }, t("scheduled_tasks.run_cancelled"))}
        onOpenSession={(sessionId) => navigate(workspaceSessionRoute(routeWorkspaceId, sessionId))}
        onOpenArtifact={(runId, artifact) => void openArtifact(runId, artifact)}
      />
    </div>
  );
}

export function ScheduledTasksControlActions({
  client,
  workspaceId,
  routeWorkspaceId,
}: {
  client: OpenworkServerClient | null;
  workspaceId: string;
  routeWorkspaceId: string;
}) {
  const navigate = useNavigate();
  const listAction = useMemo<OpenworkControlAction>(() => ({
    id: "scheduled_tasks.list",
    label: "List Scheduled Tasks",
    description: "Read Scheduled Tasks and their current state in the active workspace.",
    kind: "query",
    effects: { data: "read", ui: "none", external: false },
    sideEffect: "none",
    disabled: !client || !workspaceId,
    execute: async () => client?.listScheduledTasks(workspaceId),
  }), [client, workspaceId]);
  useControlAction(listAction);

  const openAction = useMemo<OpenworkControlAction>(() => ({
    id: "scheduled_tasks.open",
    label: "Open Scheduled Tasks",
    description: "Navigate to Scheduled Tasks, or to a specific task when taskId is provided.",
    sideEffect: "navigation",
    disabled: !routeWorkspaceId,
    args: [{ name: "taskId", type: "string", required: false }],
    execute: (args) => {
      const value = args && typeof args === "object" ? Reflect.get(args, "taskId") : null;
      const taskId = typeof value === "string" ? value : null;
      navigate(workspaceScheduledTasksRoute(routeWorkspaceId, taskId));
      return { taskId };
    },
  }), [navigate, routeWorkspaceId]);
  useControlAction(openAction);

  const createAction = useMemo<OpenworkControlAction>(() => ({
    id: "scheduled_tasks.open_create",
    label: "Open new Scheduled Task",
    description: "Open the disabled Scheduled Task draft editor for human review.",
    sideEffect: "navigation",
    disabled: !routeWorkspaceId,
    execute: () => {
      navigate(`${workspaceScheduledTasksRoute(routeWorkspaceId)}?create=1`);
      return { state: "draft", enabled: false };
    },
  }), [navigate, routeWorkspaceId]);
  useControlAction(createAction);

  const openSessionAction = useMemo<OpenworkControlAction>(() => ({
    id: "scheduled_tasks.open_session",
    label: "Open a Scheduled Task run session",
    description: "Open the exact user-owned session created for a Scheduled Task run.",
    sideEffect: "navigation",
    disabled: !routeWorkspaceId,
    requiresArgs: true,
    args: [{ name: "sessionId", type: "string", required: true }],
    execute: (args) => {
      const value = args && typeof args === "object" ? Reflect.get(args, "sessionId") : null;
      if (typeof value !== "string" || !value.trim()) return { ok: false, error: "sessionId is required" };
      navigate(workspaceSessionRoute(routeWorkspaceId, value));
      return { sessionId: value };
    },
  }), [navigate, routeWorkspaceId]);
  useControlAction(openSessionAction);

  const openArtifactAction = useMemo<OpenworkControlAction>(() => ({
    id: "scheduled_tasks.open_artifact",
    label: "Open a Scheduled Task run artifact",
    description: "Open the exact artifact recorded on a Scheduled Task run receipt.",
    sideEffect: "external",
    requiresArgs: true,
    disabled: !client || !workspaceId,
    args: [
      { name: "taskId", type: "string", required: true },
      { name: "runId", type: "string", required: true },
      { name: "artifactId", type: "string", required: true },
    ],
    execute: async (args) => {
      const taskValue = args && typeof args === "object" ? Reflect.get(args, "taskId") : null;
      const runValue = args && typeof args === "object" ? Reflect.get(args, "runId") : null;
      const artifactValue = args && typeof args === "object" ? Reflect.get(args, "artifactId") : null;
      if (
        typeof taskValue !== "string"
        || typeof runValue !== "string"
        || typeof artifactValue !== "string"
      ) {
        return { ok: false, error: "taskId, runId, and artifactId are required" };
      }
      const receipt = await client!.getScheduledTaskRunReceipt(workspaceId, taskValue, runValue);
      const artifact = receipt.artifacts.find((candidate) => candidate.id === artifactValue);
      if (!artifact) return { ok: false, error: "Artifact is not present on this run receipt" };
      if (artifact.kind === "url") {
        window.open(artifact.value, "_blank", "noopener,noreferrer");
      } else {
        const result = await client!.downloadScheduledTaskArtifact(
          workspaceId,
          taskValue,
          runValue,
          artifact.id,
        );
        downloadBlob(
          result.data,
          artifact.name ?? artifact.value.split("/").at(-1) ?? "artifact",
          result.contentType,
        );
      }
      return { artifact };
    },
  }), [client, workspaceId]);
  useControlAction(openArtifactAction);

  const tickAction = useMemo<OpenworkControlAction | null>(() => {
    if (!import.meta.env.DEV) return null;
    return {
      id: "eval.scheduled_tasks.tick",
      label: "Tick Scheduled Tasks scheduler",
      description: "Deterministically process due Scheduled Tasks in development and coded evals.",
      sideEffect: "mutation",
      disabled: !client || !workspaceId,
      args: [{ name: "now", type: "number", required: false }],
      execute: async (args) => {
        const value = args && typeof args === "object" ? Reflect.get(args, "now") : null;
        return client?.tickScheduledTaskScheduler(workspaceId, typeof value === "number" ? value : undefined);
      },
    };
  }, [client, workspaceId]);
  useControlAction(tickAction);
  return null;
}

export function ScheduledTasksPage(props: ScheduledTasksPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const creating = !props.taskId && searchParams.get("create") === "1";
  const [createBusy, setCreateBusy] = useState(false);

  const capabilitiesQuery = useQuery({
    queryKey: ["scheduled-tasks-capabilities", props.client?.baseUrl],
    enabled: Boolean(props.client),
    queryFn: () => props.client!.capabilities(),
  });
  const capabilities = capabilitiesQuery.data?.scheduledTasks;
  const listQuery = useQuery({
    queryKey: ["scheduled-tasks", props.workspaceId],
    enabled: Boolean(props.client && capabilities?.read && !props.taskId && !creating),
    queryFn: () => props.client!.listScheduledTasks(props.workspaceId),
    refetchInterval: 10_000,
  });
  const detailQuery = useQuery({
    queryKey: ["scheduled-task", props.workspaceId, props.taskId],
    enabled: Boolean(props.client && capabilities?.read && props.taskId),
    queryFn: () => props.client!.getScheduledTask(props.workspaceId, props.taskId!),
    refetchInterval: 5_000,
  });

  const openList = () => navigate(workspaceScheduledTasksRoute(props.routeWorkspaceId));
  const openTask = (taskId: string) => navigate(workspaceScheduledTasksRoute(props.routeWorkspaceId, taskId));
  const openCreate = () => navigate(`${workspaceScheduledTasksRoute(props.routeWorkspaceId)}?create=1`);

  if (!props.client) {
    return <UnavailableState reason={t("scheduled_tasks.server_unavailable")} />;
  }
  if (capabilitiesQuery.isLoading) return <LoadingState />;
  if (capabilitiesQuery.error) {
    return <ErrorState error={capabilitiesQuery.error} onRetry={() => void capabilitiesQuery.refetch()} />;
  }
  if (!capabilities) {
    return <UnavailableState reason={t("scheduled_tasks.upgrade_required")} />;
  }
  if (!capabilities.read) {
    return <UnavailableState reason={t("scheduled_tasks.read_unavailable")} />;
  }

  return (
    <>
      {creating ? (
        <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8" data-testid="scheduled-task-create-view">
          <Button variant="ghost" className="-ms-2" onClick={openList}>
            <ArrowLeft aria-hidden="true" />
            {t("scheduled_tasks.title")}
          </Button>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t("scheduled_tasks.create_title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("scheduled_tasks.create_copy")}</p>
          </div>
          <div className="max-w-md space-y-2 rounded-2xl border border-border p-4">
            <Label htmlFor="scheduled-task-workspace">{t("scheduled_tasks.workspace")}</Label>
            <select
              id="scheduled-task-workspace"
              data-testid="scheduled-task-workspace"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
              value={props.routeWorkspaceId}
              onChange={(event) => {
                navigate(`${workspaceScheduledTasksRoute(event.currentTarget.value)}?create=1`);
              }}
            >
              {props.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{t("scheduled_tasks.workspace_hint")}</p>
          </div>
          <ScheduledTaskEditor
            workspaceId={props.workspaceId}
            busy={createBusy}
            submitLabel={t("scheduled_tasks.save_draft")}
            onCancel={openList}
            onPreview={async (schedule) => (await props.client!.previewScheduledTaskSchedule(props.workspaceId, { schedule })).preview}
            onSave={async (definition: ScheduledTaskDefinition) => {
              setCreateBusy(true);
              try {
                const result = await props.client!.createScheduledTaskDraft(props.workspaceId, definition);
                await queryClient.invalidateQueries({ queryKey: ["scheduled-tasks", props.workspaceId] });
                toast.success(t("scheduled_tasks.draft_created"));
                openTask(result.task.id);
              } catch (error) {
                toast.error(describeError(error));
              } finally {
                setCreateBusy(false);
              }
            }}
          />
        </div>
      ) : props.taskId ? (
        detailQuery.isLoading ? <LoadingState /> :
        detailQuery.error ? <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} /> :
        detailQuery.data ? (
          <ScheduledTaskDetailView
            detail={detailQuery.data}
            routeWorkspaceId={props.routeWorkspaceId}
            workspaceId={props.workspaceId}
            workspaceRoot={props.workspaceRoot}
            client={props.client}
            capabilities={capabilities}
            onBack={openList}
            onOpenTask={openTask}
          />
        ) : <ErrorState error={new Error(t("scheduled_tasks.error_not_found"))} onRetry={() => void detailQuery.refetch()} />
      ) : (
        listQuery.isLoading ? <LoadingState /> :
        listQuery.error ? <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} /> :
        <ScheduledTaskList
          items={listQuery.data?.items ?? []}
          canWrite={capabilities.write}
          onCreate={openCreate}
          onOpen={openTask}
        />
      )}
    </>
  );
}
