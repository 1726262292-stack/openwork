/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Edit2,
  FileText,
  History,
  ListChecks,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  pillGhostClass,
  pillPrimaryClass,
  pillSecondaryClass,
  tagClass,
} from "@/react-app/domains/workspace/modal-styles";
import {
  OpenworkServerError,
  type OpenworkServerClient,
  type OpenworkWorkflowItem,
  type OpenworkWorkflowRun,
  type OpenworkWorkflowRunStatus,
} from "@/app/lib/openwork-server";

const pageTitleClass = "text-[28px] font-semibold tracking-[-0.5px] text-dls-text";
const panelCardClass =
  "rounded-[20px] border border-dls-border bg-dls-surface p-5 transition-all hover:border-dls-border hover:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]";
const fieldLabelClass = "text-[12px] font-medium text-dls-secondary";
const textInputClass =
  "w-full rounded-xl border border-dls-border bg-dls-surface px-3 py-2 text-[13px] text-dls-text focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.25)]";
const textAreaClass = `${textInputClass} min-h-[88px] font-mono text-[12px]`;

/** How often connected clients pick up collaborators' changes. */
const LIVE_SYNC_INTERVAL_MS = 3_000;

export type WorkflowsViewProps = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  busy: boolean;
  canWrite: boolean;
  /**
   * Create an agent session seeded with the compiled run prompt.
   * Returns the new session id, or null when launching failed.
   */
  onLaunchRun: (input: { prompt: string; title: string }) => Promise<string | null>;
  /** Navigate to an existing session (used from run history and after launch). */
  onOpenSession: (sessionId: string) => void;
};

type EditorStep = {
  name: string;
  prompt: string;
};

type EditorState = {
  slug: string | null;
  name: string;
  description: string;
  inputsText: string;
  steps: EditorStep[];
  /** updatedAt of the workflow when the editor was opened (co-editing guard). */
  baseUpdatedAt: number | null;
};

const emptyEditorState: EditorState = {
  slug: null,
  name: "",
  description: "",
  inputsText: "",
  steps: [{ name: "", prompt: "" }],
  baseUpdatedAt: null,
};

const exampleEditorState: EditorState = {
  slug: null,
  name: "Weekly research digest",
  description: "Turn collected notes into a publishable digest with sources.",
  inputsText: "notes/\nREADME.md",
  steps: [
    {
      name: "Collect highlights",
      prompt:
        "Read every input file. Extract the 5-10 most important findings, each with a one-line summary and the source file it came from.",
    },
    {
      name: "Draft the digest",
      prompt:
        "Write a structured digest in Markdown: a short intro, one section per theme, and a sources list. Keep it under 800 words.",
    },
    {
      name: "Quality pass",
      prompt:
        "Re-read the draft as a skeptical editor. Fix vague claims, ensure every section cites an input file, and tighten the writing.",
    },
  ],
  baseUpdatedAt: null,
};

function editorStateFromWorkflow(workflow: OpenworkWorkflowItem): EditorState {
  return {
    slug: workflow.slug,
    name: workflow.name,
    description: workflow.description ?? "",
    inputsText: workflow.inputs.join("\n"),
    steps: workflow.steps.map((step) => ({ name: step.name, prompt: step.prompt })),
    baseUpdatedAt: workflow.updatedAt,
  };
}

function workflowsQueryKey(workspaceId: string | null) {
  return ["openwork", "workflows", workspaceId];
}

function allRunsQueryKey(workspaceId: string | null) {
  return ["openwork", "workflow-runs", workspaceId, "all"];
}

function workflowRunsQueryKey(workspaceId: string | null, slug: string | null) {
  return ["openwork", "workflow-runs", workspaceId, slug];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function isConflictError(error: unknown): boolean {
  return error instanceof OpenworkServerError && error.status === 409;
}

function formatTimestamp(value: number): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function formatRelativeTime(value: number): string {
  if (!value) return "";
  const deltaMs = Date.now() - value;
  if (deltaMs < 45_000) return "just now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function runStatusBadge(status: OpenworkWorkflowRunStatus) {
  switch (status) {
    case "running":
      return <Badge variant="secondary">Running</Badge>;
    case "completed":
      return <Badge>Completed</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="outline">Pending</Badge>;
  }
}

export function WorkflowsView(props: WorkflowsViewProps) {
  const { client, workspaceId } = props;
  const queryClient = useQueryClient();

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorConflict, setEditorConflict] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OpenworkWorkflowItem | null>(null);
  const [runsTarget, setRunsTarget] = useState<OpenworkWorkflowItem | null>(null);
  const [launchingSlug, setLaunchingSlug] = useState<string | null>(null);

  const ready = Boolean(client && workspaceId);

  const workflowsQuery = useQuery({
    queryKey: workflowsQueryKey(workspaceId),
    queryFn: async () => {
      if (!client || !workspaceId) return { items: [] };
      return client.listWorkflows(workspaceId);
    },
    enabled: ready,
    // Live sync: collaborators' edits (and git pulls) show up within seconds.
    refetchInterval: LIVE_SYNC_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const allRunsQuery = useQuery({
    queryKey: allRunsQueryKey(workspaceId),
    queryFn: async () => {
      if (!client || !workspaceId) return { items: [] };
      return client.listAllWorkflowRuns(workspaceId);
    },
    enabled: ready,
    refetchInterval: LIVE_SYNC_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const runsQuery = useQuery({
    queryKey: workflowRunsQueryKey(workspaceId, runsTarget?.slug ?? null),
    queryFn: async () => {
      if (!client || !workspaceId || !runsTarget) return { items: [] };
      return client.listWorkflowRuns(workspaceId, runsTarget.slug);
    },
    enabled: ready && Boolean(runsTarget),
    refetchInterval: LIVE_SYNC_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const workflows = useMemo(() => workflowsQuery.data?.items ?? [], [workflowsQuery.data]);
  const runs = runsQuery.data?.items ?? [];

  const latestRunBySlug = useMemo(() => {
    const map = new Map<string, OpenworkWorkflowRun>();
    for (const run of allRunsQuery.data?.items ?? []) {
      const current = map.get(run.workflowSlug);
      if (!current || run.createdAt > current.createdAt) {
        map.set(run.workflowSlug, run);
      }
    }
    return map;
  }, [allRunsQuery.data]);

  /**
   * Co-editing awareness: if the workflow open in the editor has been saved
   * by someone else since we opened it, the live-sync poll will surface a
   * newer updatedAt and we warn before the user even hits save.
   */
  const remoteUpdate = useMemo(() => {
    if (!editor?.slug || editor.baseUpdatedAt === null) return null;
    const latest = workflows.find((item) => item.slug === editor.slug);
    if (latest && latest.updatedAt > editor.baseUpdatedAt) return latest;
    return null;
  }, [editor, workflows]);

  const invalidateWorkflows = () =>
    queryClient.invalidateQueries({ queryKey: workflowsQueryKey(workspaceId) });

  const openEditor = (state: EditorState) => {
    setEditorError(null);
    setEditorConflict(false);
    setEditor(state);
  };

  const closeEditor = () => {
    setEditor(null);
    setEditorError(null);
    setEditorConflict(false);
  };

  const loadLatestIntoEditor = (latest: OpenworkWorkflowItem) => {
    openEditor(editorStateFromWorkflow(latest));
    toast.info("Loaded the latest version");
  };

  const saveMutation = useMutation({
    mutationFn: async (state: EditorState) => {
      if (!client || !workspaceId) throw new Error("OpenWork server is not connected.");
      const inputs = state.inputsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const steps = state.steps
        .map((step) => ({ name: step.name.trim() || undefined, prompt: step.prompt.trim() }))
        .filter((step) => step.prompt.length > 0);
      if (!state.name.trim()) throw new Error("Workflow name is required.");
      if (steps.length === 0) throw new Error("Add at least one step with a prompt.");
      return client.upsertWorkflow(workspaceId, {
        name: state.name.trim(),
        slug: state.slug ?? undefined,
        description: state.description.trim() || undefined,
        inputs,
        steps,
        baseUpdatedAt: state.baseUpdatedAt,
      });
    },
    onSuccess: () => {
      closeEditor();
      toast.success("Workflow saved");
      void invalidateWorkflows();
    },
    onError: (error) => {
      if (isConflictError(error)) {
        setEditorConflict(true);
        setEditorError(null);
        return;
      }
      setEditorError(describeError(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (slug: string) => {
      if (!client || !workspaceId) throw new Error("OpenWork server is not connected.");
      return client.deleteWorkflow(workspaceId, slug);
    },
    onSuccess: () => {
      toast.success("Workflow deleted");
      void invalidateWorkflows();
    },
    onError: (error) => {
      toast.error(describeError(error));
    },
  });

  const runWorkflow = async (workflow: OpenworkWorkflowItem) => {
    if (!client || !workspaceId || launchingSlug) return;
    setLaunchingSlug(workflow.slug);
    try {
      const { run, prompt } = await client.createWorkflowRun(workspaceId, workflow.slug);
      const sessionId = await props.onLaunchRun({
        prompt,
        title: `Workflow: ${workflow.name}`,
      });
      if (!sessionId) {
        await client
          .updateWorkflowRun(workspaceId, workflow.slug, run.id, { status: "failed" })
          .catch(() => undefined);
        toast.error("Could not start an agent session for this run.");
        return;
      }
      await client
        .updateWorkflowRun(workspaceId, workflow.slug, run.id, { status: "running", sessionId })
        .catch(() => undefined);
      void queryClient.invalidateQueries({
        queryKey: workflowRunsQueryKey(workspaceId, workflow.slug),
      });
      void queryClient.invalidateQueries({ queryKey: allRunsQueryKey(workspaceId) });
      props.onOpenSession(sessionId);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setLaunchingSlug(null);
    }
  };

  const markRun = async (run: OpenworkWorkflowRun, status: OpenworkWorkflowRunStatus) => {
    if (!client || !workspaceId) return;
    try {
      await client.updateWorkflowRun(workspaceId, run.workflowSlug, run.id, { status });
      void queryClient.invalidateQueries({
        queryKey: workflowRunsQueryKey(workspaceId, run.workflowSlug),
      });
      void queryClient.invalidateQueries({ queryKey: allRunsQueryKey(workspaceId) });
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  const editorValid = useMemo(() => {
    if (!editor) return false;
    return Boolean(editor.name.trim()) && editor.steps.some((step) => step.prompt.trim());
  }, [editor]);

  const updateEditorStep = (index: number, patch: Partial<EditorStep>) => {
    setEditor((current) => {
      if (!current) return current;
      const steps = current.steps.map((step, i) => (i === index ? { ...step, ...patch } : step));
      return { ...current, steps };
    });
  };

  const moveEditorStep = (index: number, direction: -1 | 1) => {
    setEditor((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      const [step] = steps.splice(index, 1);
      steps.splice(target, 0, step);
      return { ...current, steps };
    });
  };

  const removeEditorStep = (index: number) => {
    setEditor((current) => {
      if (!current || current.steps.length <= 1) return current;
      return { ...current, steps: current.steps.filter((_, i) => i !== index) };
    });
  };

  const conflictLatest = editorConflict && editor?.slug
    ? workflows.find((item) => item.slug === editor.slug) ?? null
    : null;

  return (
    <section className="space-y-8 max-w-3xl w-full">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className={pageTitleClass}>Workflows</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-dls-secondary">
            Repeatable multi-step agent runs. Pick input files, write the step prompts once, and run
            them with a coding agent. Each run compiles its results into the workspace outbox so
            outputs are saved, versioned, and shareable.
          </p>
          {ready ? (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-dls-secondary">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Synced live
              <Users size={12} className="ml-1" />
              shared with everyone in this workspace, versioned with the project
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 lg:justify-end">
          <button
            type="button"
            onClick={() => void workflowsQuery.refetch()}
            disabled={!ready || workflowsQuery.isFetching}
            className={pillSecondaryClass}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => openEditor(emptyEditorState)}
            disabled={!ready || !props.canWrite || props.busy}
            className={pillPrimaryClass}
          >
            <Plus size={14} />
            New workflow
          </button>
        </div>
      </div>

      {!ready ? (
        <div className="rounded-[20px] border border-dls-border bg-dls-hover px-5 py-4 text-[13px] text-dls-secondary">
          Connect the OpenWork server for this workspace to manage workflows.
        </div>
      ) : null}

      {ready && workflowsQuery.isError ? (
        <div className="rounded-[20px] border border-red-7/20 bg-red-1/40 px-5 py-4 text-[13px] text-red-12">
          {describeError(workflowsQuery.error)}
        </div>
      ) : null}

      {ready && !workflowsQuery.isLoading && workflows.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-dls-border bg-dls-surface px-5 py-10 text-center">
          <WorkflowIcon size={28} className="mx-auto text-dls-secondary" />
          <p className="mt-3 text-[14px] font-medium text-dls-text">No workflows yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-dls-secondary">
            A workflow is a saved pipeline: context files in, prompt steps in order, build artifacts
            out. Create one for any task you find yourself re-prompting.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              className={pillSecondaryClass}
              onClick={() => openEditor(exampleEditorState)}
              disabled={!props.canWrite || props.busy}
            >
              <Sparkles size={14} />
              Start from an example
            </button>
            <button
              type="button"
              className={pillPrimaryClass}
              onClick={() => openEditor(emptyEditorState)}
              disabled={!props.canWrite || props.busy}
            >
              <Plus size={14} />
              New workflow
            </button>
          </div>
        </div>
      ) : null}

      {workflows.length > 0 ? (
        <div className="rounded-[24px] bg-dls-hover p-4">
          <div className="grid grid-cols-1 gap-4">
            {workflows.map((workflow) => {
              const latestRun = latestRunBySlug.get(workflow.slug) ?? null;
              return (
                <div key={workflow.slug} className={`${panelCardClass} flex flex-col gap-4`}>
                  <div className="flex min-w-0 gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
                      <WorkflowIcon size={20} className="text-dls-secondary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-[14px] font-semibold text-dls-text">{workflow.name}</h4>
                        {latestRun ? runStatusBadge(latestRun.status) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-dls-secondary">
                        {workflow.description || "No description"}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-dls-secondary">
                        <span className={tagClass}>
                          <ListChecks size={11} className="mr-1 inline" />
                          {workflow.steps.length} step{workflow.steps.length === 1 ? "" : "s"}
                        </span>
                        <span className={tagClass}>
                          <FileText size={11} className="mr-1 inline" />
                          {workflow.inputs.length} input{workflow.inputs.length === 1 ? "" : "s"}
                        </span>
                        <span className={`${tagClass} font-mono`} title={workflow.outputDir}>
                          outputs: {workflow.outputDir.replace(".opencode/openwork/outbox/", "outbox/")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dls-border pt-4">
                    <span className="text-[11px] text-dls-secondary">
                      {latestRun
                        ? `Last run ${formatRelativeTime(latestRun.createdAt)} · edited ${formatRelativeTime(workflow.updatedAt)}`
                        : `Edited ${formatRelativeTime(workflow.updatedAt)} · never run`}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {latestRun?.sessionId ? (
                        <button
                          type="button"
                          className={pillGhostClass}
                          onClick={() => {
                            if (latestRun.sessionId) props.onOpenSession(latestRun.sessionId);
                          }}
                          title="Open the session for the latest run"
                        >
                          <History size={14} />
                          Last session
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={pillGhostClass}
                        onClick={() => setRunsTarget(workflow)}
                        disabled={props.busy}
                      >
                        <History size={14} />
                        Runs
                      </button>
                      <button
                        type="button"
                        className={pillSecondaryClass}
                        onClick={() => openEditor(editorStateFromWorkflow(workflow))}
                        disabled={props.busy || !props.canWrite}
                      >
                        <Edit2 size={14} />
                        Edit
                      </button>
                      <button
                        type="button"
                        className={pillGhostClass}
                        onClick={() => setDeleteTarget(workflow)}
                        disabled={props.busy || !props.canWrite}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                      <button
                        type="button"
                        className={pillPrimaryClass}
                        onClick={() => void runWorkflow(workflow)}
                        disabled={props.busy || !props.canWrite || launchingSlug !== null}
                      >
                        {launchingSlug === workflow.slug ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Play size={14} />
                        )}
                        Run
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <Dialog
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent className="flex max-h-[90vh] min-h-0 w-full max-w-3xl flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editor?.slug ? "Edit workflow" : "New workflow"}</DialogTitle>
            <DialogDescription>
              Steps run in order inside one agent session. Outputs are written to the workspace
              outbox as shareable artifacts.
            </DialogDescription>
          </DialogHeader>

          {editor ? (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
              {editorConflict ? (
                <div
                  data-testid="workflow-conflict-banner"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-7/30 bg-amber-1/50 px-4 py-3 text-xs text-amber-12"
                >
                  <span>
                    Someone saved this workflow while you were editing. Your changes were not saved.
                  </span>
                  {conflictLatest ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => loadLatestIntoEditor(conflictLatest)}
                    >
                      Load latest
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {!editorConflict && remoteUpdate ? (
                <div
                  data-testid="workflow-remote-update-banner"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-7/30 bg-sky-1/50 px-4 py-3 text-xs text-sky-12"
                >
                  <span>
                    <Users size={12} className="mr-1 inline" />
                    A collaborator just updated this workflow ({formatRelativeTime(remoteUpdate.updatedAt)}).
                    Saving now will be blocked unless you load their version first.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => loadLatestIntoEditor(remoteUpdate)}
                  >
                    Load latest
                  </Button>
                </div>
              ) : null}

              {editorError ? (
                <div className="rounded-xl border border-red-7/20 bg-red-1/40 px-4 py-3 text-xs text-red-12">
                  {editorError}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label className={fieldLabelClass}>Name</label>
                <input
                  type="text"
                  value={editor.name}
                  onChange={(event) => {
                    const name = event.currentTarget.value;
                    setEditor((current) => (current ? { ...current, name } : current));
                  }}
                  placeholder="Weekly research digest"
                  className={textInputClass}
                />
              </div>

              <div className="space-y-1.5">
                <label className={fieldLabelClass}>Description (optional)</label>
                <input
                  type="text"
                  value={editor.description}
                  onChange={(event) => {
                    const description = event.currentTarget.value;
                    setEditor((current) => (current ? { ...current, description } : current));
                  }}
                  placeholder="What this workflow produces"
                  className={textInputClass}
                />
              </div>

              <div className="space-y-1.5">
                <label className={fieldLabelClass}>
                  Input files - one workspace-relative path per line (optional)
                </label>
                <textarea
                  value={editor.inputsText}
                  onChange={(event) => {
                    const inputsText = event.currentTarget.value;
                    setEditor((current) => (current ? { ...current, inputsText } : current));
                  }}
                  placeholder={"docs/notes.md\nresearch/sources/"}
                  className={textAreaClass}
                  spellCheck={false}
                />
                <p className="text-[11px] text-dls-secondary">
                  The agent reads these before starting. Drop files into the workspace (or the shared
                  inbox) to add new context.
                </p>
              </div>

              <div className="space-y-3">
                <label className={fieldLabelClass}>Steps</label>
                {editor.steps.map((step, index) => (
                  <div key={index} className="space-y-2 rounded-2xl border border-dls-border bg-dls-hover p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-dls-secondary">Step {index + 1}</span>
                      <input
                        type="text"
                        value={step.name}
                        onChange={(event) => updateEditorStep(index, { name: event.currentTarget.value })}
                        placeholder="Step name (optional)"
                        className={`${textInputClass} flex-1`}
                      />
                      <button
                        type="button"
                        className={pillGhostClass}
                        onClick={() => moveEditorStep(index, -1)}
                        disabled={index === 0}
                        title="Move up"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className={pillGhostClass}
                        onClick={() => moveEditorStep(index, 1)}
                        disabled={index === editor.steps.length - 1}
                        title="Move down"
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        className={pillGhostClass}
                        onClick={() => removeEditorStep(index)}
                        disabled={editor.steps.length <= 1}
                        title="Remove step"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <textarea
                      value={step.prompt}
                      onChange={(event) => updateEditorStep(index, { prompt: event.currentTarget.value })}
                      placeholder="Prompt for this step..."
                      className={textAreaClass}
                      spellCheck={false}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  className={pillSecondaryClass}
                  onClick={() =>
                    setEditor((current) =>
                      current ? { ...current, steps: [...current.steps, { name: "", prompt: "" }] } : current,
                    )
                  }
                >
                  <Plus size={14} />
                  Add step
                </button>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEditor}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!editorValid || saveMutation.isPending || editorConflict}
              onClick={() => {
                if (editor) saveMutation.mutate(editor);
              }}
            >
              {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
              Save workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(runsTarget)}
        onOpenChange={(open) => {
          if (!open) setRunsTarget(null);
        }}
      >
        <DialogContent className="flex max-h-[80vh] min-h-0 w-full max-w-2xl flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Runs - {runsTarget?.name}</DialogTitle>
            <DialogDescription>
              Each run executes in its own agent session and writes artifacts to{" "}
              <span className="font-mono">{runsTarget?.outputDir}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {runsQuery.isLoading ? (
              <div className="text-[13px] text-dls-secondary">Loading runs...</div>
            ) : runs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-dls-border px-4 py-6 text-[13px] text-dls-secondary">
                No runs yet. Hit Run to execute this workflow with an agent.
              </div>
            ) : (
              runs.map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dls-border bg-dls-surface px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {runStatusBadge(run.status)}
                      <span className="text-[12px] text-dls-secondary" title={formatTimestamp(run.createdAt)}>
                        {formatRelativeTime(run.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-dls-secondary" title={run.outputDir}>
                      {run.outputDir}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {run.status === "running" ? (
                      <>
                        <button
                          type="button"
                          className={pillGhostClass}
                          onClick={() => void markRun(run, "completed")}
                          disabled={!props.canWrite}
                        >
                          Mark completed
                        </button>
                        <button
                          type="button"
                          className={pillGhostClass}
                          onClick={() => void markRun(run, "failed")}
                          disabled={!props.canWrite}
                        >
                          Mark failed
                        </button>
                      </>
                    ) : null}
                    {run.sessionId ? (
                      <button
                        type="button"
                        className={pillSecondaryClass}
                        onClick={() => {
                          if (run.sessionId) props.onOpenSession(run.sessionId);
                        }}
                      >
                        Open session
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete workflow"
        message={`Delete "${deleteTarget?.name ?? ""}"? Past run outputs in the outbox are kept.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmButtonVariant="destructive"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) deleteMutation.mutate(target.slug);
        }}
      />
    </section>
  );
}
