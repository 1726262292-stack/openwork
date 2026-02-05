import { For, Show, createMemo, createSignal } from "solid-js";

import type { ScheduledJob } from "../types";
import { usePlatform } from "../context/platform";
import { formatRelativeTime, isTauriRuntime } from "../utils";

import Button from "../components/button";
import {
  BookOpen,
  Brain,
  Calendar,
  Clock,
  FolderOpen,
  MessageSquare,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  TrendingUp,
  Trophy,
  X,
} from "lucide-solid";

export type ScheduledTasksViewProps = {
  jobs: ScheduledJob[];
  source: "local" | "remote";
  sourceReady: boolean;
  status: string | null;
  busy: boolean;
  lastUpdatedAt: number | null;
  refreshJobs: (options?: { force?: boolean }) => void;
  deleteJob: (name: string) => Promise<void> | void;
  isWindows: boolean;
  activeWorkspaceRoot: string;
  createSessionAndOpen: () => void;
  setPrompt: (value: string) => void;
  newTaskDisabled: boolean;
};

const toRelative = (value?: string | null) => {
  if (!value) return "Never";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Never";
  return formatRelativeTime(parsed);
};

const taskSummary = (job: ScheduledJob) => {
  const run = job.run;
  if (run?.command) {
    const args = run.arguments ? ` ${run.arguments}` : "";
    return { label: "Command", value: `${run.command}${args}`, mono: true };
  }
  const prompt = run?.prompt ?? job.prompt;
  if (prompt) {
    return { label: "Prompt", value: prompt, mono: false };
  }
  return { label: "Task", value: "No prompt or command found.", mono: false };
};

const statusLabel = (status?: string | null) => {
  if (!status) return "Not run yet";
  if (status === "running") return "Running";
  if (status === "success") return "Success";
  if (status === "failed") return "Failed";
  return status;
};

const statusTone = (status?: string | null) => {
  if (status === "success") return "border-emerald-7/60 bg-emerald-3/60 text-emerald-11";
  if (status === "failed") return "border-red-7/60 bg-red-3/60 text-red-11";
  if (status === "running") return "border-amber-7/60 bg-amber-3/60 text-amber-11";
  return "border-gray-6 bg-gray-2 text-gray-9";
};

const statusIconTone = (status?: string | null) => {
  if (status === "success") return "border-emerald-6 text-emerald-10";
  if (status === "failed") return "border-red-6 text-red-10";
  if (status === "running") return "border-amber-6 text-amber-10";
  return "border-gray-6 text-gray-9";
};

const automationTemplates = [
  {
    icon: Calendar,
    description: "Scan recent commits and flag riskier diffs.",
    prompt: "Schedule a daily job at 9am to scan recent commits and flag riskier diffs.",
    tone: "text-red-9",
  },
  {
    icon: BookOpen,
    description: "Draft weekly release notes from merged PRs.",
    prompt: "Schedule a weekly job on Fridays at 4pm to draft release notes from merged PRs.",
    tone: "text-blue-9",
  },
  {
    icon: MessageSquare,
    description: "Summarize yesterday's git activity by repo.",
    prompt: "Schedule a daily job at 6pm to summarize yesterday's git activity by repo.",
    tone: "text-purple-9",
  },
  {
    icon: TrendingUp,
    description: "Watch CI failures and surface recurring flakes.",
    prompt: "Schedule a job every 6 hours to summarize CI failures and surface recurring flakes.",
    tone: "text-indigo-9",
  },
  {
    icon: Trophy,
    description: "Build a tiny classic game for a team demo.",
    prompt: "Schedule a weekly job on Mondays at 10am to build a tiny classic game for a team demo.",
    tone: "text-amber-9",
  },
  {
    icon: Brain,
    description: "Suggest the next skills to install for this workspace.",
    prompt: "Schedule a weekly job on Wednesdays at 2pm to suggest the next skills to install for this workspace.",
    tone: "text-pink-9",
  },
];

const dayOptions = [
  { id: "mo", label: "Mo", cron: "1" },
  { id: "tu", label: "Tu", cron: "2" },
  { id: "we", label: "We", cron: "3" },
  { id: "th", label: "Th", cron: "4" },
  { id: "fr", label: "Fr", cron: "5" },
  { id: "sa", label: "Sa", cron: "6" },
  { id: "su", label: "Su", cron: "0" },
];

const normalizeSentence = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/[.!?]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
};

const buildCronFromDaily = (timeValue: string, days: string[]) => {
  const [hour, minute] = timeValue.split(":");
  if (!hour || !minute) return "";
  const hourValue = Number.parseInt(hour, 10);
  const minuteValue = Number.parseInt(minute, 10);
  if (!Number.isFinite(hourValue) || !Number.isFinite(minuteValue)) return "";
  if (!days.length) return "";
  if (days.length === dayOptions.length) {
    return `${minuteValue} ${hourValue} * * *`;
  }
  const daySpec = dayOptions
    .filter((day) => days.includes(day.id))
    .map((day) => day.cron)
    .join(",");
  if (!daySpec) return "";
  return `${minuteValue} ${hourValue} * * ${daySpec}`;
};

const buildCronFromInterval = (hours: number) => {
  if (!Number.isFinite(hours) || hours <= 0) return "";
  const interval = Math.max(1, Math.round(hours));
  return `0 */${interval} * * *`;
};

const buildAutomationPrompt = (options: {
  name: string;
  prompt: string;
  schedule: string;
  workdir: string;
}) => {
  const name = options.name.trim();
  const schedule = options.schedule.trim();
  const prompt = normalizeSentence(options.prompt);
  if (!schedule || !prompt) return "";
  const workdir = options.workdir.trim();
  const nameSegment = name ? ` named "${name}"` : "";
  const workdirSegment = workdir ? ` Run from ${workdir}.` : "";
  return `Schedule a job${nameSegment} with cron "${schedule}" to ${prompt}${workdirSegment}`.trim();
};

const AutomationCard = (props: {
  icon: any;
  description: string;
  tone?: string;
  onClick?: () => void;
  disabled?: boolean;
}) => {
  const Icon = props.icon;
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      class={`flex min-h-[132px] w-full flex-col gap-4 rounded-2xl border border-gray-6 bg-white p-5 text-left transition-all hover:border-gray-7 hover:shadow-sm ${
        props.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <div class={`flex h-9 w-9 items-center justify-center rounded-xl border border-gray-4 bg-white ${props.tone ?? ""}`}>
        <Icon size={18} />
      </div>
      <p class="text-[13px] leading-relaxed text-gray-10">{props.description}</p>
    </button>
  );
};

const AutomationJobCard = (props: {
  job: ScheduledJob;
  supported: boolean;
  busy: boolean;
  onDelete: () => void;
}) => {
  const summary = () => taskSummary(props.job);
  const status = () => props.job.lastRunStatus;
  return (
    <div class="flex flex-col gap-4 rounded-2xl border border-gray-6 bg-white p-5 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex min-w-0 items-start gap-3">
          <div
            class={`flex h-9 w-9 items-center justify-center rounded-xl border bg-white ${statusIconTone(
              status()
            )}`}
          >
            <Calendar size={18} />
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold text-gray-12 truncate">{props.job.name}</h3>
              <span
                class={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone(
                  status()
                )}`}
              >
                {statusLabel(status())}
              </span>
            </div>
            <div class="mt-1 text-xs text-gray-9">
              Cron <span class="font-mono text-gray-12">{props.job.schedule}</span>
            </div>
            <div class="text-[11px] text-gray-8 font-mono">{props.job.slug}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={props.onDelete}
          disabled={!props.supported || props.busy}
          class={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            !props.supported || props.busy
              ? "border-gray-5 text-gray-8"
              : "border-red-6 text-red-10 hover:bg-red-3"
          }`}
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="rounded-xl border border-gray-6 bg-gray-2 px-3 py-3">
          <div class="text-[10px] uppercase tracking-wide text-gray-8">{summary().label}</div>
          <div
            class={`mt-1 text-sm text-gray-12 break-words ${summary().mono ? "font-mono" : ""}`}
          >
            {summary().value}
          </div>
        </div>
        <div class="rounded-xl border border-gray-6 bg-gray-2 px-3 py-3 space-y-2">
          <div class="text-[10px] uppercase tracking-wide text-gray-8">Run context</div>
          <div class="space-y-2 text-xs text-gray-9">
            <div class="flex items-center gap-2">
              <FolderOpen size={14} class="text-gray-8" />
              <span class="font-mono text-gray-12 break-all">
                {props.job.workdir ?? "Default"}
              </span>
            </div>
            <Show when={props.job.run?.attachUrl ?? props.job.attachUrl}>
              <div class="flex items-center gap-2">
                <Terminal size={14} class="text-gray-8" />
                <span class="font-mono text-gray-12 break-all">
                  {props.job.run?.attachUrl ?? props.job.attachUrl}
                </span>
              </div>
            </Show>
            <Show when={props.job.source}>
              <div class="text-[11px] text-gray-8">Source: {props.job.source}</div>
            </Show>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-4 text-xs text-gray-9">
        <div class="flex items-center gap-1">
          <Clock size={12} />
          Last run {toRelative(props.job.lastRunAt)}
        </div>
        <div>Created {toRelative(props.job.createdAt)}</div>
        <Show when={props.job.run?.agent}>
          <div>Agent {props.job.run?.agent}</div>
        </Show>
        <Show when={props.job.run?.model}>
          <div>Model {props.job.run?.model}</div>
        </Show>
      </div>
    </div>
  );
};

export default function ScheduledTasksView(props: ScheduledTasksViewProps) {
  const platform = usePlatform();
  const supported = createMemo(() => {
    if (props.source === "remote") return props.sourceReady;
    return isTauriRuntime() && !props.isWindows;
  });
  const supportNote = createMemo(() => {
    if (props.source === "remote") {
      return props.sourceReady ? null : "OpenWork server unavailable. Connect to sync scheduled tasks.";
    }
    if (!isTauriRuntime()) return "Scheduled tasks require the desktop app.";
    if (props.isWindows) return "Scheduler is not supported on Windows yet.";
    return null;
  });
  const sourceDescription = createMemo(() =>
    props.source === "remote"
      ? "Automations that run on a schedule from the connected OpenWork server."
      : "Automations that run on a schedule from this device."
  );
  const sourceLabel = createMemo(() =>
    props.source === "remote" ? "From OpenWork server" : "From local scheduler"
  );
  const schedulerLabel = createMemo(() => (props.source === "remote" ? "OpenWork server" : "Local"));
  const schedulerHint = createMemo(() =>
    props.source === "remote" ? "Remote instance" : "Launchd or systemd"
  );
  const schedulerUnavailableHint = createMemo(() =>
    props.source === "remote" ? "OpenWork server unavailable" : "Desktop-only"
  );
  const deleteDescription = createMemo(() =>
    props.source === "remote"
      ? "This removes the schedule and deletes the job definition from the connected OpenWork server."
      : "This removes the schedule and deletes the job definition from your machine."
  );

  const lastUpdatedLabel = createMemo(() => {
    if (!props.lastUpdatedAt) return "Not synced yet";
    return formatRelativeTime(props.lastUpdatedAt);
  });

  const [deleteTarget, setDeleteTarget] = createSignal<ScheduledJob | null>(null);
  const [deleteBusy, setDeleteBusy] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = createSignal(false);
  const [automationName, setAutomationName] = createSignal("Daily bug scan");
  const [automationProject, setAutomationProject] = createSignal(props.activeWorkspaceRoot);
  const [automationPrompt, setAutomationPrompt] = createSignal(
    "Scan recent commits and flag riskier diffs."
  );
  const [scheduleMode, setScheduleMode] = createSignal<"daily" | "interval">("daily");
  const [scheduleTime, setScheduleTime] = createSignal("09:00");
  const [scheduleDays, setScheduleDays] = createSignal(["mo", "tu", "we", "th", "fr"]);
  const [intervalHours, setIntervalHours] = createSignal(6);

  const confirmDelete = async () => {
    const target = deleteTarget();
    if (!target) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await props.deleteJob(target.slug);
      setDeleteTarget(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDeleteError(message || "Failed to delete job.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const cronExpression = createMemo(() => {
    if (scheduleMode() === "interval") {
      return buildCronFromInterval(intervalHours());
    }
    return buildCronFromDaily(scheduleTime(), scheduleDays());
  });

  const createPromptValue = createMemo(() =>
    buildAutomationPrompt({
      name: automationName(),
      prompt: automationPrompt(),
      schedule: cronExpression(),
      workdir: automationProject(),
    })
  );

  const canCreateAutomation = createMemo(() => !!createPromptValue());

  const openSchedulerDocs = () => {
    platform.openLink("https://github.com/anomalyco/opencode-scheduler");
  };

  const openCreateModal = () => {
    const root = props.activeWorkspaceRoot.trim();
    if (!automationProject().trim() && root) {
      setAutomationProject(root);
    }
    setCreateModalOpen(true);
  };

  const launchAutomationPrompt = (promptValue: string) => {
    if (!promptValue) return;
    const root = props.activeWorkspaceRoot.trim();
    const decorated = root ? `${promptValue}\n\nRun from ${root}.` : promptValue;
    props.setPrompt(decorated);
    props.createSessionAndOpen();
  };

  const handleCreateAutomation = () => {
    const promptValue = createPromptValue();
    if (!promptValue) return;
    props.setPrompt(promptValue);
    props.createSessionAndOpen();
    setCreateModalOpen(false);
  };

  const toggleDay = (id: string) => {
    setScheduleDays((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return Array.from(next);
    });
  };

  const updateIntervalHours = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    const bounded = Math.min(24, Math.max(1, parsed));
    setIntervalHours(bounded);
  };

  return (
    <section class="space-y-10">
      <div class="flex flex-wrap items-center justify-end gap-3 border-b border-gray-6 pb-4">
        <button
          type="button"
          onClick={openSchedulerDocs}
          class="text-xs font-medium text-gray-9 transition-colors hover:text-gray-12"
        >
          Learn more
        </button>
        <button
          type="button"
          onClick={() => props.refreshJobs({ force: true })}
          disabled={!supported() || props.busy}
          class={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
            !supported() || props.busy
              ? "text-gray-8"
              : "text-gray-9 hover:text-gray-12"
          }`}
        >
          <RefreshCw size={14} />
          {props.busy ? "Refreshing" : "Refresh"}
        </button>
        <button
          type="button"
          onClick={openCreateModal}
          disabled={props.newTaskDisabled}
          class={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            props.newTaskDisabled
              ? "bg-gray-3 text-gray-8"
              : "bg-gray-12 text-gray-1 hover:bg-gray-11"
          }`}
        >
          <Plus size={14} />
          New automation
        </button>
      </div>

      <div class="flex flex-col items-center text-center gap-3">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl border border-gray-6 bg-gray-2 shadow-sm">
          <Terminal size={28} class="text-gray-9" />
        </div>
        <div class="flex items-center gap-2">
          <h2 class="text-2xl font-semibold text-gray-12">Automations</h2>
          <span class="rounded-full border border-gray-6 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-9">
            Beta
          </span>
        </div>
        <p class="text-sm text-gray-9">{sourceDescription()}</p>
      </div>

      <div class="flex flex-wrap justify-center gap-3 text-xs text-gray-9">
        <div class="rounded-xl border border-gray-6 bg-gray-1 px-3 py-2">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-gray-8">Automations</div>
          <div class="text-sm font-semibold text-gray-12">{props.jobs.length}</div>
          <div class="text-[10px] text-gray-8">Active automations</div>
        </div>
        <div class="rounded-xl border border-gray-6 bg-gray-1 px-3 py-2">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-gray-8">Last sync</div>
          <div class="text-sm font-semibold text-gray-12">
            {supported() ? lastUpdatedLabel() : "Unavailable"}
          </div>
          <div class="text-[10px] text-gray-8">{sourceLabel()}</div>
        </div>
        <div class="rounded-xl border border-gray-6 bg-gray-1 px-3 py-2">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-gray-8">Scheduler</div>
          <div class="text-sm font-semibold text-gray-12">
            {supported() ? schedulerLabel() : "Unavailable"}
          </div>
          <div class="text-[10px] text-gray-8">
            {supported() ? schedulerHint() : schedulerUnavailableHint()}
          </div>
        </div>
      </div>

      <Show when={supportNote()}>
        <div class="rounded-xl border border-gray-6 bg-gray-2 px-5 py-4 text-sm text-gray-9">
          {supportNote()}
        </div>
      </Show>

      <Show when={props.status}>
        <div class="rounded-xl border border-red-7/40 bg-red-3/60 px-5 py-4 text-sm text-red-11">
          {props.status}
        </div>
      </Show>

      <Show when={deleteError()}>
        <div class="rounded-xl border border-red-7/40 bg-red-3/60 px-5 py-4 text-sm text-red-11">
          {deleteError()}
        </div>
      </Show>

      <Show
        when={props.jobs.length > 0}
        fallback={
          <div class="space-y-4">
            <div class="text-center text-sm text-gray-9">
              No automations yet. Pick a template or create your own automation prompt.
            </div>
            <div class="grid w-full grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <For each={automationTemplates}>
                {(card) => (
                  <AutomationCard
                    icon={card.icon}
                    description={card.description}
                    tone={card.tone}
                    onClick={() => launchAutomationPrompt(card.prompt)}
                    disabled={props.newTaskDisabled}
                  />
                )}
              </For>
            </div>
            <button
              type="button"
              onClick={openSchedulerDocs}
              class="mx-auto block text-xs text-gray-9 transition-colors hover:text-gray-12"
            >
              Explore more
            </button>
          </div>
        }
      >
        <div class="grid w-full grid-cols-1 gap-4">
          <For each={props.jobs}>
            {(job) => (
              <AutomationJobCard
                job={job}
                supported={supported()}
                busy={props.busy || deleteBusy()}
                onDelete={() => setDeleteTarget(job)}
              />
            )}
          </For>
        </div>
      </Show>

      <Show when={deleteTarget()}>
        <div class="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-center justify-center p-4">
          <div class="bg-white border border-gray-6 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div class="p-6 space-y-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <h3 class="text-lg font-semibold text-gray-12">Delete automation?</h3>
                  <p class="text-sm text-gray-9 mt-1">{deleteDescription()}</p>
                </div>
              </div>
              <div class="rounded-xl bg-gray-2 border border-gray-6 p-3 text-xs text-gray-9 font-mono break-all">
                {deleteTarget()?.name}
              </div>
              <div class="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteBusy()}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy()}>
                  {deleteBusy() ? "Deleting" : "Delete"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={createModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px] p-4">
          <div class="w-full max-w-2xl rounded-3xl bg-white shadow-2xl overflow-hidden border border-gray-6">
            <div class="p-8 space-y-6">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <h2 class="text-xl font-semibold text-gray-12">Create automation</h2>
                  <p class="text-xs text-gray-9 mt-2">
                    Automations are scheduled by running a prompt in a new thread. We’ll prefill
                    a prompt for you to send.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  class="rounded-full p-1 text-gray-8 transition-colors hover:bg-gray-2 hover:text-gray-12"
                >
                  <X size={18} />
                </button>
              </div>

              <div class="space-y-6">
                <div>
                  <label class="mb-2 block text-[11px] font-bold uppercase tracking-wider text-gray-8">
                    Name
                  </label>
                  <input
                    type="text"
                    value={automationName()}
                    onInput={(event) => setAutomationName(event.currentTarget.value)}
                    class="w-full rounded-xl border border-gray-6 bg-gray-2 px-3 py-2 text-sm text-gray-12 focus:outline-none focus:ring-1 focus:ring-gray-7"
                  />
                </div>
                <div>
                  <label class="mb-2 block text-[11px] font-bold uppercase tracking-wider text-gray-8">
                    Projects
                  </label>
                  <input
                    type="text"
                    value={automationProject()}
                    onInput={(event) => setAutomationProject(event.currentTarget.value)}
                    placeholder="Choose a folder"
                    class="w-full rounded-xl border border-gray-6 bg-gray-2 px-3 py-2 text-sm text-gray-12 focus:outline-none focus:ring-1 focus:ring-gray-7"
                  />
                </div>
                <div>
                  <label class="mb-2 block text-[11px] font-bold uppercase tracking-wider text-gray-8">
                    Prompt
                  </label>
                  <div class="rounded-xl border border-gray-6 bg-gray-2 p-3">
                    <textarea
                      rows={4}
                      value={automationPrompt()}
                      onInput={(event) => setAutomationPrompt(event.currentTarget.value)}
                      class="w-full resize-none bg-transparent text-sm text-gray-12 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <div class="mb-2 flex items-center justify-between">
                    <label class="block text-[11px] font-bold uppercase tracking-wider text-gray-8">
                      Schedule
                    </label>
                    <div class="flex rounded-lg bg-gray-2 p-0.5">
                      <button
                        type="button"
                        onClick={() => setScheduleMode("daily")}
                        class={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${
                          scheduleMode() === "daily"
                            ? "bg-white text-gray-12 shadow-sm"
                            : "text-gray-8"
                        }`}
                      >
                        Daily
                      </button>
                      <button
                        type="button"
                        onClick={() => setScheduleMode("interval")}
                        class={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${
                          scheduleMode() === "interval"
                            ? "bg-white text-gray-12 shadow-sm"
                            : "text-gray-8"
                        }`}
                      >
                        Interval
                      </button>
                    </div>
                  </div>
                  <Show
                    when={scheduleMode() === "daily"}
                    fallback={
                      <div class="flex flex-wrap items-center gap-3">
                        <div class="flex items-center gap-2 rounded-xl border border-gray-6 bg-gray-2 px-3 py-2 text-sm text-gray-12">
                          <span>Every</span>
                          <input
                            type="number"
                            min={1}
                            max={24}
                            value={intervalHours()}
                            onInput={(event) => updateIntervalHours(event.currentTarget.value)}
                            class="w-16 bg-transparent text-right focus:outline-none"
                          />
                          <span>hours</span>
                        </div>
                      </div>
                    }
                  >
                    <div class="flex flex-wrap items-center gap-3">
                      <div class="flex items-center justify-between rounded-xl border border-gray-6 bg-gray-2 px-3 py-2 text-sm text-gray-12">
                        <input
                          type="time"
                          value={scheduleTime()}
                          onInput={(event) => setScheduleTime(event.currentTarget.value)}
                          class="bg-transparent focus:outline-none"
                        />
                        <Clock size={16} class="text-gray-8" />
                      </div>
                      <div class="flex flex-wrap gap-1">
                        <For each={dayOptions}>
                          {(day) => (
                            <button
                              type="button"
                              onClick={() => toggleDay(day.id)}
                              class={`h-8 w-8 rounded-full text-[10px] font-bold transition-colors ${
                                scheduleDays().includes(day.id)
                                  ? "bg-gray-12 text-gray-1"
                                  : "bg-gray-2 text-gray-8"
                              }`}
                            >
                              {day.label}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                  <Show when={cronExpression()}>
                    <div class="mt-2 text-[11px] text-gray-8">
                      Cron: <span class="font-mono text-gray-12">{cronExpression()}</span>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
            <div class="flex items-center justify-between gap-4 border-t border-gray-6 bg-gray-2 px-8 py-4">
              <button
                type="button"
                onClick={openSchedulerDocs}
                class="text-xs font-medium text-gray-9 transition-colors hover:text-gray-12"
              >
                View scheduler docs
              </button>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  class="px-4 py-2 text-xs font-medium text-gray-8 transition-colors hover:text-gray-12"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateAutomation}
                  disabled={!canCreateAutomation() || props.newTaskDisabled}
                  class={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
                    !canCreateAutomation() || props.newTaskDisabled
                      ? "bg-gray-3 text-gray-8"
                      : "bg-gray-12 text-gray-1 hover:bg-gray-11"
                  }`}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
}
