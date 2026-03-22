import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import { Boxes, CheckCircle2, Folder, FolderPlus, Loader2, Rocket, Sparkles, X, XCircle } from "lucide-solid";
import { t, currentLocale } from "../../i18n";
import type { WorkspacePreset } from "../types";

import Button from "./button";

export default function CreateWorkspaceModal(props: {
  open: boolean;
  onClose: () => void;
  onConfirm: (preset: WorkspacePreset, folder: string | null) => void;
  onConfirmWorker?: (preset: WorkspacePreset, folder: string | null) => void;
  onPickFolder: () => Promise<string | null>;
  submitting?: boolean;
  inline?: boolean;
  showClose?: boolean;
  defaultPreset?: WorkspacePreset;
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
  workerLabel?: string;
  workerDisabled?: boolean;
  workerDisabledReason?: string | null;
  workerCtaLabel?: string;
  workerCtaDescription?: string;
  onWorkerCta?: () => void;
  workerRetryLabel?: string;
  onWorkerRetry?: () => void;
  workerDebugLines?: string[];
  workerSubmitting?: boolean;

  submittingProgress?: {
    runId: string;
    startedAt: number;
    stage: string;
    error: string | null;
    steps: Array<{ key: string; label: string; status: "pending" | "active" | "done" | "error"; detail?: string | null }>;
    logs: string[];
  } | null;
}) {
  let pickFolderRef: HTMLButtonElement | undefined;
  const translate = (key: string) => t(key, currentLocale());

  const [preset, setPreset] = createSignal<WorkspacePreset>("starter");
  const [selectedFolder, setSelectedFolder] = createSignal<string | null>(null);
  const [pickingFolder, setPickingFolder] = createSignal(false);

  createEffect(() => {
    if (props.open) {
      setPreset(props.defaultPreset ?? "starter");
      requestAnimationFrame(() => pickFolderRef?.focus());
    }
  });

  const options = () => [
    {
      id: "starter" as const,
      name: translate("dashboard.starter_workspace"),
      desc: translate("dashboard.starter_workspace_desc"),
      icon: Sparkles,
      badge: "Recommended",
    },
    {
      id: "minimal" as const,
      name: translate("dashboard.empty_workspace"),
      desc: translate("dashboard.empty_workspace_desc"),
      icon: Folder,
      badge: "Blank slate",
    },
    {
      id: "automation" as const,
      name: translate("dashboard.blueprints_workspace"),
      desc: translate("dashboard.blueprints_workspace_desc"),
      icon: Boxes,
      badge: "Reusable flows",
    },
  ];

  const folderLabel = () => {
    const folder = selectedFolder();
    if (!folder) return translate("dashboard.choose_folder");
    const parts = folder.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] ?? folder;
  };

  const folderSubLabel = () => {
    const folder = selectedFolder();
    if (!folder) return translate("dashboard.choose_folder_next");
    return folder;
  };

  const handlePickFolder = async () => {
    if (pickingFolder()) return;
    setPickingFolder(true);
    try {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const next = await props.onPickFolder();
      if (next) {
        setSelectedFolder(next);
      }
    } finally {
      setPickingFolder(false);
    }
  };

  const showClose = () => props.showClose ?? true;
  const title = () => props.title ?? translate("dashboard.create_workspace_title");
  const subtitle = () => props.subtitle ?? translate("dashboard.create_workspace_subtitle");
  const confirmLabel = () => props.confirmLabel ?? translate("dashboard.create_workspace_confirm");
  const workerLabel = () => props.workerLabel ?? translate("dashboard.create_sandbox_confirm");
  const isInline = () => props.inline ?? false;
  const submitting = () => props.submitting ?? false;
  const workerSubmitting = () => props.workerSubmitting ?? false;

  const progress = createMemo(() => props.submittingProgress ?? null);
  const provisioning = createMemo(() => submitting() && Boolean(progress()));
  const [showProgressDetails, setShowProgressDetails] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());

  createEffect(() => {
    if (!submitting()) {
      setShowProgressDetails(false);
      return;
    }

    const id = window.setInterval(() => setNow(Date.now()), 500);
    onCleanup(() => window.clearInterval(id));
  });

  const elapsedSeconds = createMemo(() => {
    const p = progress();
    if (!p?.startedAt) return 0;
    return Math.max(0, Math.floor((now() - p.startedAt) / 1000));
  });

  const workerDisabled = () => Boolean(props.workerDisabled);
  const workerDisabledReason = () => (props.workerDisabledReason ?? "").trim();
  const showWorkerCallout = () => Boolean(props.onConfirmWorker && workerDisabled() && workerDisabledReason());
  const workerDebugLines = createMemo(() => (props.workerDebugLines ?? []).map((line) => line.trim()).filter(Boolean));
  const hasSelectedFolder = createMemo(() => Boolean(selectedFolder()?.trim()));

  const content = (
    <div class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-dls-border bg-dls-surface shadow-[var(--dls-shell-shadow)]">
      <div class="border-b border-dls-border bg-dls-sidebar px-6 py-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="mb-2 inline-flex items-center gap-2 rounded-full border border-dls-border bg-dls-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-dls-secondary shadow-[var(--dls-card-shadow)]">
              <Rocket size={12} />
              Workspace setup
            </div>
            <h3 class="text-[28px] font-semibold tracking-[-0.02em] text-dls-text">{title()}</h3>
            <p class="mt-2 max-w-xl text-sm leading-6 text-dls-secondary">{subtitle()}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <div class="hidden rounded-full border border-dls-border bg-dls-surface px-3 py-1 text-[11px] font-medium text-dls-secondary md:block">
              Two quick steps
            </div>
            <Show when={showClose()}>
              <button
                onClick={props.onClose}
                disabled={submitting()}
                class={`flex h-10 w-10 items-center justify-center rounded-[16px] text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text ${submitting() ? "cursor-not-allowed opacity-50" : ""}`.trim()}
                aria-label="Close create workspace modal"
              >
                <X size={18} />
              </button>
            </Show>
          </div>
        </div>
      </div>

      <div class={`flex-1 overflow-y-auto px-6 py-6 transition-opacity duration-300 ${provisioning() ? "pointer-events-none opacity-40" : "opacity-100"}`}>
        <div class="grid gap-5">
          <div class="rounded-[20px] bg-dls-surface p-2 shadow-[var(--dls-card-shadow)]">
            <div class="group relative rounded-xl bg-gray-2/50 p-4 transition-colors">
              <div class="mb-3 flex items-center justify-between">
                <div class="text-[15px] font-medium text-dls-text">
                  Choose a folder
                </div>
                <Show when={hasSelectedFolder()}>
                  <div class="flex items-center gap-1.5 rounded border border-[rgba(var(--dls-accent-rgb),0.2)] bg-[rgba(var(--dls-accent-rgb),0.05)] px-2 py-1">
                    <div class="h-1.5 w-1.5 rounded-full bg-dls-accent" />
                    <span class="text-[10px] font-bold tracking-wider text-dls-accent">READY</span>
                  </div>
                </Show>
              </div>
              <div class="mb-4 text-[13px] text-dls-secondary">
                <Show when={hasSelectedFolder()} fallback="Select where your files will live.">
                  <span class="font-mono text-xs">{selectedFolder()}</span>
                </Show>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  ref={pickFolderRef}
                  onClick={handlePickFolder}
                  disabled={pickingFolder() || submitting()}
                  class="flex items-center gap-2 rounded-full bg-dls-text px-4 py-2 text-center text-xs font-medium text-dls-surface shadow-sm transition-colors hover:bg-gray-12 focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.2)] disabled:cursor-wait disabled:opacity-70"
                >
                  <Show when={pickingFolder()} fallback={<FolderPlus size={14} />}>
                    <Loader2 size={14} class="animate-spin" />
                  </Show>
                  {hasSelectedFolder() ? translate("dashboard.change") : "Select folder"}
                </button>
              </div>
            </div>
          </div>

          <div class="rounded-[20px] bg-dls-surface p-2 shadow-[var(--dls-card-shadow)]">
            <div class="mb-2 px-3 pt-2 text-[13px] font-medium text-dls-secondary">
              Start with a preset
            </div>
            <div class={`grid gap-1 ${!hasSelectedFolder() ? "pointer-events-none opacity-50" : ""}`.trim()}>
              <For each={options()}>
                {(opt) => (
                  <div
                    onClick={() => {
                      if (!hasSelectedFolder() || submitting()) return;
                      setPreset(opt.id);
                    }}
                    class={`group relative flex cursor-pointer items-center justify-between rounded-xl p-3 transition-colors ${
                      preset() === opt.id ? "bg-gray-2/50" : "hover:bg-gray-2/50"
                    }`.trim()}
                  >
                    <div class="flex items-center gap-3">
                      <div class={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${preset() === opt.id ? "bg-[rgba(var(--dls-accent-rgb),0.12)] text-dls-text" : "bg-gray-3 text-dls-secondary"}`}>
                        <opt.icon size={12} />
                      </div>
                      <div class={`text-[14px] font-medium transition-colors ${preset() === opt.id ? "text-dls-text" : "text-dls-secondary group-hover:text-dls-text"}`}>
                        {opt.name}
                      </div>
                    </div>
                    <div class="ml-4 flex shrink-0 items-center gap-3">
                      <div class="text-xs text-dls-secondary">{opt.desc}</div>
                      <Show when={preset() === opt.id} fallback={<div class="h-4 w-4 rounded-full border border-dls-border bg-dls-surface" />}>
                        <div class="flex h-4 w-4 items-center justify-center rounded-full bg-dls-accent text-white">
                          <CheckCircle2 size={10} />
                        </div>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-3 border-t border-dls-border bg-dls-sidebar px-6 py-5">
        <Show when={submitting() && progress()}>
          {(p) => (
            <div class="rounded-xl border border-gray-6 bg-gray-2/50 px-4 py-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-xs font-semibold text-gray-12 flex items-center gap-2">
                    <Show when={!p().error} fallback={<XCircle size={14} class="text-red-11" />}>
                      <Loader2 size={14} class="text-indigo-11 animate-spin" />
                    </Show>
                    Sandbox setup
                  </div>
                  <div class="mt-1 text-sm text-gray-11 leading-snug truncate">{p().stage}</div>
                  <div class="mt-1 text-[10px] text-gray-9 font-mono uppercase tracking-wider">{elapsedSeconds()}s</div>
                </div>
                <button
                  type="button"
                  class="shrink-0 text-xs text-gray-10 hover:text-gray-12 transition-colors px-2 py-1 hover:bg-gray-4 rounded"
                  onClick={() => setShowProgressDetails((prev) => !prev)}
                >
                  {showProgressDetails() ? "Hide logs" : "Show logs"}
                </button>
              </div>

              <Show when={p().error}>
                {(err) => (
                  <div class="mt-3 rounded-lg border border-red-7/30 bg-red-2/40 px-3 py-2 text-xs text-red-11 animate-in fade-in">
                    {err()}
                  </div>
                )}
              </Show>

              <div class="mt-4 grid gap-2.5">
                <For each={p().steps}>
                  {(step) => {
                    const icon = () => {
                      if (step.status === "done") return <CheckCircle2 size={16} class="text-emerald-10" />;
                      if (step.status === "active") return <Loader2 size={16} class="text-indigo-11 animate-spin" />;
                      if (step.status === "error") return <XCircle size={16} class="text-red-10" />;
                      return <div class="w-4 h-4 rounded-full border-2 border-gray-6" />;
                    };
                    
                    const textClass = () => {
                      if (step.status === "done") return "text-gray-11 font-medium";
                      if (step.status === "active") return "text-gray-12 font-semibold";
                      if (step.status === "error") return "text-red-11 font-medium";
                      return "text-gray-9";
                    };

                    return (
                      <div class="flex items-center gap-3">
                        <div class="shrink-0 flex items-center justify-center w-5 h-5">
                          {icon()}
                        </div>
                        <div class="min-w-0 flex-1 flex items-center justify-between gap-2">
                          <div class={`text-xs ${textClass()} transition-colors duration-200`.trim()}>{step.label}</div>
                          <Show when={(step.detail ?? "").trim()}>
                            <div class="text-[10px] text-gray-9 font-mono truncate max-w-[120px] bg-gray-3/50 px-1.5 py-0.5 rounded">
                              {step.detail}
                            </div>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>

              <Show when={showProgressDetails() && (p().logs?.length ?? 0) > 0}>
                <div class="mt-3 rounded-lg border border-gray-6 bg-black/5 px-3 py-2 animate-in fade-in">
                  <div class="flex justify-between items-center mb-2">
                    <div class="text-[10px] uppercase tracking-wide font-semibold text-gray-10">Live Logs</div>
                  </div>
                  <div class="space-y-0.5 max-h-[120px] overflow-y-auto scrollbar-thin">
                    <For each={p().logs.slice(-10)}>
                      {(line) => (
                        <div class="text-[10px] text-gray-11 font-mono break-all leading-tight">{line}</div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </Show>

        <Show when={showWorkerCallout()}>
          <div class="rounded-xl border border-amber-7/30 bg-amber-2/40 px-4 py-3 text-xs text-amber-11">
            <div class="font-semibold text-amber-12">{translate("dashboard.sandbox_get_ready_title")}</div>
            <Show when={props.workerCtaDescription?.trim() || workerDisabledReason()}>
              <div class="mt-1 text-amber-11 leading-relaxed">
                {workerDisabledReason() || props.workerCtaDescription?.trim()}
              </div>
            </Show>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <Show when={props.onWorkerCta && props.workerCtaLabel?.trim()}>
                <Button variant="outline" onClick={props.onWorkerCta} disabled={submitting()}>
                  {props.workerCtaLabel}
                </Button>
              </Show>
              <Show when={props.onWorkerRetry && props.workerRetryLabel?.trim()}>
                <Button variant="ghost" onClick={props.onWorkerRetry} disabled={submitting()}>
                  {props.workerRetryLabel}
                </Button>
              </Show>
            </div>
            <Show when={workerDebugLines().length > 0}>
              <details class="mt-3 rounded-lg border border-gray-6 bg-gray-2/60 px-3 py-2 text-[11px] text-gray-11">
                <summary class="cursor-pointer text-xs font-semibold text-gray-12">Docker debug details</summary>
                <div class="mt-2 space-y-1 font-mono break-words">
                  <For each={workerDebugLines()}>
                    {(line) => <div>{line}</div>}
                  </For>
                </div>
              </details>
            </Show>
          </div>
        </Show>

        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="text-xs text-dls-secondary">
          </div>
          <div class="flex justify-end gap-3">
            <Show when={showClose()}>
              <button
                type="button"
                onClick={props.onClose}
                disabled={submitting()}
                class="rounded-full border border-dls-border bg-dls-surface px-4 py-2 text-center text-xs font-medium text-dls-text shadow-sm transition-colors hover:bg-dls-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {translate("common.cancel")}
              </button>
            </Show>
            <Show when={props.onConfirmWorker}>
              <button
                type="button"
                onClick={() => props.onConfirmWorker?.(preset(), selectedFolder())}
                disabled={!selectedFolder() || submitting() || workerSubmitting() || workerDisabled()}
                title={(() => {
                  if (!selectedFolder()) return translate("dashboard.choose_folder_continue");
                  if (workerDisabled() && workerDisabledReason()) return workerDisabledReason();
                  return undefined;
                })()}
                class="rounded-full border border-dls-border bg-dls-surface px-4 py-2 text-center text-xs font-medium text-dls-text shadow-sm transition-colors hover:bg-dls-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Show when={workerSubmitting()} fallback={workerLabel()}>
                  <span class="inline-flex items-center gap-2">
                    <Loader2 size={16} class="animate-spin" />
                    {translate("dashboard.sandbox_checking_docker")}
                  </span>
                </Show>
              </button>
            </Show>
            <button
              type="button"
              onClick={() => props.onConfirm(preset(), selectedFolder())}
              disabled={!selectedFolder() || submitting()}
              title={!selectedFolder() ? translate("dashboard.choose_folder_continue") : undefined}
              class="rounded-full bg-dls-accent px-6 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-[var(--dls-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Show when={submitting()} fallback={confirmLabel()}>
                <span class="inline-flex items-center gap-2">
                  <Loader2 size={16} class="animate-spin" />
                  Creating...
                </span>
              </Show>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Show when={props.open || isInline()}>
      <div
        class={
          isInline()
            ? "w-full"
            : "fixed inset-0 z-50 flex items-center justify-center bg-gray-1/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        }
      >
        {content}
      </div>
    </Show>
  );
}
