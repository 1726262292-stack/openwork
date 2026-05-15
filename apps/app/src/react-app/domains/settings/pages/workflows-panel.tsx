/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Edit2,
  Loader2,
  Play,
  Plus,
  Repeat,
  Trash2,
  Workflow,
  X,
  Zap,
} from "lucide-react";

/* ── Shared styles ───────────────────────────────────────────────────── */

const panelCardClass =
  "rounded-[20px] border border-dls-border bg-dls-surface p-5 transition-all hover:border-dls-border hover:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]";
const pillButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.18)] disabled:cursor-not-allowed disabled:opacity-60";
const pillPrimaryClass = `${pillButtonClass} bg-dls-accent text-white hover:bg-[var(--dls-accent-hover)]`;
const pillSecondaryClass = `${pillButtonClass} border border-dls-border bg-dls-surface text-dls-text hover:bg-dls-hover`;
const pillGhostClass = `${pillButtonClass} border border-dls-border bg-dls-surface text-dls-secondary hover:bg-dls-hover hover:text-dls-text`;
const tagClass =
  "inline-flex items-center rounded-md border border-dls-border bg-dls-hover px-2 py-1 text-[11px] text-dls-secondary";

/* ── Types ────────────────────────────────────────────────────────────── */

export type WorkflowAutomation = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastRunStatus: "pending" | "running" | "success" | "failed" | null;
  lastSessionId: string | null;
  runCount?: number;
};

export type WorkflowsPanelProps = {
  serverBaseUrl: string | null;
  workspaceId: string | null;
  authToken?: string | null;
  showToast?: (input: {
    title: string;
    tone?: "success" | "info" | "warning" | "error";
    description?: string | null;
  }) => void;
};

/* ── Helpers ──────────────────────────────────────────────────────────── */

async function apiFetch<T>(
  base: string,
  path: string,
  options: RequestInit = {},
  authToken?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  const res = await fetch(`${base}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function scheduleLabel(schedule: string): string {
  if (!schedule || schedule === "manual") return "Manual";
  const num = Number(schedule);
  if (Number.isFinite(num) && num > 0) {
    if (num < 60) return `Every ${num}s`;
    if (num < 3600) return `Every ${Math.round(num / 60)}m`;
    return `Every ${Math.round(num / 3600)}h`;
  }
  return schedule;
}

const SCHEDULE_OPTIONS = [
  { label: "Manual", value: "manual" },
  { label: "Every 30 seconds (test)", value: "30" },
  { label: "Every 1 minute", value: "60" },
  { label: "Every 5 minutes", value: "300" },
  { label: "Every 15 minutes", value: "900" },
  { label: "Every hour", value: "3600" },
  { label: "Every 6 hours", value: "21600" },
  { label: "Every 24 hours", value: "86400" },
];

const WORKFLOW_PRESETS = [
  {
    name: "Open Chrome to Facebook",
    description: "Launch Google Chrome and navigate to facebook.com",
    prompt:
      "Use Google Chrome to open facebook.com. Navigate to the page and confirm it loaded successfully.",
  },
  {
    name: "Daily standup summary",
    description: "Summarize recent activity for a standup meeting",
    prompt:
      "Review my recent git commits and open tasks, then draft a concise standup summary with what I did, what I'm doing next, and any blockers.",
  },
  {
    name: "Code review scan",
    description: "Scan recent commits and flag risky changes",
    prompt:
      "Scan recent commits and flag riskier diffs with the most important follow-ups.",
  },
  {
    name: "Inbox triage",
    description: "Summarize unread messages and suggest priorities",
    prompt:
      "Summarize unread inbox messages, suggest priority order, and draft concise reply options for the top conversations.",
  },
];

/* ── Component ────────────────────────────────────────────────────────── */

export function WorkflowsPanel(props: WorkflowsPanelProps) {
  const { serverBaseUrl, workspaceId, authToken, showToast } = props;
  const [automations, setAutomations] = useState<WorkflowAutomation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggerBusy, setTriggerBusy] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formSchedule, setFormSchedule] = useState("manual");
  const [saveBusy, setSaveBusy] = useState(false);

  const available = Boolean(serverBaseUrl && workspaceId);

  const basePath = useMemo(
    () => (serverBaseUrl && workspaceId ? `/workspace/${workspaceId}/automations` : null),
    [serverBaseUrl, workspaceId],
  );

  /* ── Data fetching ──────────────────────────────────────────────────── */

  const refresh = useCallback(async () => {
    if (!serverBaseUrl || !basePath) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ items: WorkflowAutomation[] }>(
        serverBaseUrl, basePath, {}, authToken,
      );
      setAutomations(res?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, [serverBaseUrl, basePath, authToken]);

  useEffect(() => {
    if (available) void refresh();
  }, [available, refresh]);

  // Auto-refresh every 15s to pick up recurring run status changes
  useEffect(() => {
    if (!available) return;
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [available, refresh]);

  /* ── Modal helpers ──────────────────────────────────────────────────── */

  const openCreate = (preset?: (typeof WORKFLOW_PRESETS)[number]) => {
    setEditingId(null);
    setFormName(preset?.name ?? "");
    setFormDescription(preset?.description ?? "");
    setFormPrompt(preset?.prompt ?? "");
    setFormSchedule("manual");
    setModalOpen(true);
  };

  const openEdit = (auto: WorkflowAutomation) => {
    setEditingId(auto.id);
    setFormName(auto.name);
    setFormDescription(auto.description);
    setFormPrompt(auto.prompt);
    setFormSchedule(auto.schedule);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setSaveBusy(false);
  };

  /* ── Actions ────────────────────────────────────────────────────────── */

  const handleSave = async () => {
    if (!serverBaseUrl || !basePath || !formPrompt.trim()) return;
    setSaveBusy(true);
    try {
      if (editingId) {
        // Update existing
        await apiFetch(
          serverBaseUrl,
          `${basePath}/${editingId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name: formName.trim() || "Untitled",
              description: formDescription.trim(),
              prompt: formPrompt.trim(),
              schedule: formSchedule,
            }),
          },
          authToken,
        );
        showToast?.({ title: "Workflow updated", tone: "success" });
      } else {
        // Create new
        await apiFetch(
          serverBaseUrl,
          basePath,
          {
            method: "POST",
            body: JSON.stringify({
              name: formName.trim() || "Untitled",
              description: formDescription.trim(),
              prompt: formPrompt.trim(),
              schedule: formSchedule,
            }),
          },
          authToken,
        );
        showToast?.({ title: "Workflow created", tone: "success" });
      }
      closeModal();
      await refresh();
    } catch (err) {
      showToast?.({
        title: editingId ? "Failed to update" : "Failed to create",
        tone: "error",
        description: err instanceof Error ? err.message : null,
      });
    } finally {
      setSaveBusy(false);
    }
  };

  const handleTrigger = async (id: string) => {
    if (!serverBaseUrl || !basePath) return;
    setTriggerBusy(id);
    try {
      await apiFetch(
        serverBaseUrl,
        `${basePath}/${id}/trigger`,
        { method: "POST" },
        authToken,
      );
      showToast?.({ title: "Workflow triggered", tone: "success", description: "A new session has been created." });
      await refresh();
    } catch (err) {
      showToast?.({
        title: "Trigger failed",
        tone: "error",
        description: err instanceof Error ? err.message : null,
      });
    } finally {
      setTriggerBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!serverBaseUrl || !basePath) return;
    try {
      await apiFetch(serverBaseUrl, `${basePath}/${id}`, { method: "DELETE" }, authToken);
      showToast?.({ title: "Workflow deleted", tone: "info" });
      setAutomations((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      showToast?.({
        title: "Delete failed",
        tone: "error",
        description: err instanceof Error ? err.message : null,
      });
    }
  };

  /* ── Render ─────────────────────────────────────────────────────────── */

  if (!available) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Workflow size={20} className="text-dls-secondary" />
          <h3 className="text-[15px] font-medium tracking-[-0.2px] text-dls-text">Workflows</h3>
        </div>
        <div className="rounded-[20px] border border-dashed border-dls-border bg-dls-surface px-5 py-8 text-center text-[14px] text-dls-secondary">
          Connect to an OpenWork server to use workflows.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Workflow size={20} className="text-dls-secondary" />
          <h3 className="text-[15px] font-medium tracking-[-0.2px] text-dls-text">Workflows</h3>
          <span className={`${tagClass} border-violet-7/30 bg-violet-3/40 text-violet-11`}>
            Auto
          </span>
        </div>
        <button type="button" className={pillPrimaryClass} onClick={() => openCreate()}>
          <Plus size={14} />
          New Workflow
        </button>
      </div>

      {/* Error */}
      {error ? (
        <div className="flex items-center gap-2 rounded-[20px] border border-red-7/20 bg-red-1/40 px-5 py-4 text-[13px] text-red-11">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : null}

      {/* Presets (shown when no automations) */}
      {automations.length === 0 && !loading ? (
        <div className="space-y-3">
          <p className="text-[13px] text-dls-secondary">
            Quick-start: pick a preset or create your own workflow.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {WORKFLOW_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className={`${panelCardClass} cursor-pointer text-left`}
                onClick={() => openCreate(preset)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
                    <Zap size={16} className="text-dls-secondary" />
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold text-dls-text">{preset.name}</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-dls-secondary">
                      {preset.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-dls-secondary">
          <Loader2 size={20} className="animate-spin" />
          <span className="ml-2 text-[13px]">Loading workflows...</span>
        </div>
      ) : null}

      {/* Workflow list */}
      {automations.length > 0 ? (
        <div className="rounded-[24px] bg-dls-hover p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {automations.map((auto) => (
              <div key={auto.id} className={`${panelCardClass} flex flex-col gap-4`}>
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
                    <Workflow size={20} className="text-dls-secondary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-[14px] font-semibold text-dls-text">
                        {auto.name}
                      </h4>
                      {auto.lastRunStatus === "success" ? (
                        <span className="inline-flex items-center rounded-md border border-emerald-7/30 bg-emerald-3/40 px-2 py-1 text-[11px] text-emerald-11">
                          <CheckCircle size={10} className="mr-1" />
                          Success
                        </span>
                      ) : auto.lastRunStatus === "running" ? (
                        <span className="inline-flex items-center rounded-md border border-amber-7/30 bg-amber-3/40 px-2 py-1 text-[11px] text-amber-11">
                          <Loader2 size={10} className="mr-1 animate-spin" />
                          Running
                        </span>
                      ) : auto.lastRunStatus === "failed" ? (
                        <span className="inline-flex items-center rounded-md border border-red-7/30 bg-red-3/40 px-2 py-1 text-[11px] text-red-11">
                          <AlertCircle size={10} className="mr-1" />
                          Failed
                        </span>
                      ) : null}
                    </div>
                    {auto.description ? (
                      <p className="mt-1 line-clamp-1 text-[13px] text-dls-secondary">
                        {auto.description}
                      </p>
                    ) : null}
                    <p className="mt-2 line-clamp-2 rounded-lg border border-dls-border bg-dls-hover px-3 py-2 font-mono text-[12px] text-dls-secondary">
                      {auto.prompt}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-dls-secondary">
                      <span className={auto.schedule !== "manual"
                        ? "inline-flex items-center rounded-md border border-violet-7/30 bg-violet-3/40 px-2 py-1 text-[11px] text-violet-11"
                        : tagClass}>
                        {auto.schedule !== "manual" ? <Repeat size={10} className="mr-1" /> : <Clock size={10} className="mr-1" />}
                        {scheduleLabel(auto.schedule)}
                      </span>
                      {auto.lastRunAt ? (
                        <span className={tagClass}>Last run: {relativeTime(auto.lastRunAt)}</span>
                      ) : null}
                      {(auto.runCount ?? 0) > 0 ? (
                        <span className={tagClass}>Runs: {auto.runCount}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-dls-border pt-4">
                  <button
                    type="button"
                    className={pillGhostClass}
                    onClick={() => openEdit(auto)}
                  >
                    <Edit2 size={14} />
                    Edit
                  </button>
                  <button
                    type="button"
                    className={pillSecondaryClass}
                    onClick={() => void handleTrigger(auto.id)}
                    disabled={triggerBusy === auto.id}
                  >
                    {triggerBusy === auto.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    Run
                  </button>
                  <button
                    type="button"
                    className={pillGhostClass}
                    onClick={() => void handleDelete(auto.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Create / Edit modal */}
      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-dls-border bg-dls-surface shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-dls-border px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-dls-text">
                  {editingId ? "Edit Workflow" : "New Workflow"}
                </div>
                <p className="mt-1 text-xs text-dls-secondary">
                  {editingId
                    ? "Update the workflow name, prompt, or schedule."
                    : "Create a workflow that runs a prompt in OpenCode."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full p-1 text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-dls-text">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.currentTarget.value)}
                  placeholder="e.g. Morning Facebook check"
                  className="w-full rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-[14px] text-dls-text placeholder:text-dls-secondary/50 focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.12)]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-dls-text">Description</label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.currentTarget.value)}
                  placeholder="A short description of what this does"
                  className="w-full rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-[14px] text-dls-text placeholder:text-dls-secondary/50 focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.12)]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-dls-text">Prompt</label>
                <textarea
                  rows={4}
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.currentTarget.value)}
                  placeholder="What should the agent do? e.g. Use Google Chrome to open facebook.com every morning"
                  className="w-full resize-none rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-[14px] text-dls-text placeholder:text-dls-secondary/50 focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.12)]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-dls-text">Schedule</label>
                <select
                  value={formSchedule}
                  onChange={(e) => setFormSchedule(e.currentTarget.value)}
                  className="w-full rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-[14px] text-dls-text focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.12)]"
                >
                  {SCHEDULE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {formSchedule !== "manual" ? (
                  <p className="text-[12px] text-dls-secondary">
                    The server will automatically trigger this workflow on the selected interval.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-dls-border px-5 py-4">
              <div className="flex items-center gap-2 text-[12px] text-dls-secondary">
                <Zap size={14} />
                OpenWork Workflows
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={pillGhostClass}
                  onClick={closeModal}
                  disabled={saveBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={pillPrimaryClass}
                  onClick={() => void handleSave()}
                  disabled={saveBusy || !formPrompt.trim()}
                >
                  {saveBusy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : editingId ? (
                    <Edit2 size={14} />
                  ) : (
                    <Plus size={14} />
                  )}
                  {editingId ? "Save Changes" : "Create & Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
