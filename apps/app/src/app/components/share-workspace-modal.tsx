import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  ArrowLeft,
  Boxes,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderCode,
  MessageSquare,
  MonitorUp,
  Rocket,
  X,
} from "lucide-solid";

type ShareField = {
  label: string;
  value: string;
  secret?: boolean;
  placeholder?: string;
  hint?: string;
};

type ShareView = "chooser" | "template" | "access";

export default function ShareWorkspaceModal(props: {
  open: boolean;
  onClose: () => void;
  title?: string;
  workspaceName: string;
  workspaceDetail?: string | null;
  fields: ShareField[];
  note?: string | null;
  publisherBaseUrl?: string;
  onShareWorkspaceProfile?: () => void;
  shareWorkspaceProfileBusy?: boolean;
  shareWorkspaceProfileUrl?: string | null;
  shareWorkspaceProfileError?: string | null;
  shareWorkspaceProfileDisabledReason?: string | null;
  onShareSkillsSet?: () => void;
  onOpenSingleSkillShare?: () => void;
  shareSkillsSetBusy?: boolean;
  shareSkillsSetUrl?: string | null;
  shareSkillsSetError?: string | null;
  shareSkillsSetDisabledReason?: string | null;
  onExportConfig?: () => void;
  exportDisabledReason?: string | null;
  onOpenBots?: () => void;
}) {
  const [activeView, setActiveView] = createSignal<ShareView>("chooser");
  const [revealedByIndex, setRevealedByIndex] = createSignal<Record<number, boolean>>({});
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null);

  const title = createMemo(() => props.title ?? "Share workspace");
  const detail = createMemo(() => props.workspaceDetail?.trim() ?? "");
  const note = createMemo(() => props.note?.trim() ?? "");
  const avatarLetter = createMemo(() =>
    props.workspaceName ? props.workspaceName.charAt(0).toUpperCase() : "W",
  );

  createEffect(() => {
    if (!props.open) return;
    setActiveView("chooser");
    setRevealedByIndex({});
    setCopiedKey(null);
  });

  createEffect(() => {
    if (!props.open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (activeView() === "chooser") {
        props.onClose();
        return;
      }
      setActiveView("chooser");
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const handleCopy = async (value: string, key: string) => {
    const text = value?.trim() ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 2000);
    } catch {
      // ignore clipboard failures
    }
  };

  const renderGeneratedLink = (
    value: string | null | undefined,
    copyKey: string,
    regenerate: (() => void) | undefined,
    busy: boolean | undefined,
    createLabel: string,
    regenerateLabel: string,
    createAction: (() => void) | undefined,
    disabledReason: string | null | undefined,
  ) => (
    <Show
      when={value?.trim()}
      fallback={
        <button
          onClick={() => createAction?.()}
          disabled={Boolean(disabledReason) || !createAction || busy}
          class="w-full py-2.5 bg-gray-12 hover:bg-gray-11 text-gray-1 text-[13px] font-bold rounded-xl transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Publishing..." : createLabel}
        </button>
      }
    >
      <div class="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
        <input
          type="text"
          readonly
          value={value!}
          class="flex-1 bg-gray-2 border border-gray-6 rounded-lg py-2 px-3 text-[12px] font-mono text-gray-11 outline-none"
        />
        <button
          onClick={() => handleCopy(value ?? "", copyKey)}
          class="p-2 bg-gray-2 hover:bg-gray-3 text-gray-12 rounded-lg transition-colors border border-gray-6"
        >
          <Show when={copiedKey() === copyKey} fallback={<Copy size={16} />}>
            <Check size={16} class="text-emerald-10" />
          </Show>
        </button>
      </div>
      <button
        onClick={() => regenerate?.()}
        disabled={busy}
        class="mt-3 w-full py-2 bg-gray-2 hover:bg-gray-3 text-gray-11 hover:text-gray-12 text-[12px] font-bold rounded-lg transition-all"
      >
        {busy ? "Publishing..." : regenerateLabel}
      </button>
    </Show>
  );

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-gray-1/70 backdrop-blur-sm p-4 font-sans animate-in fade-in duration-200">
        <div
          class="bg-gray-1 w-full max-w-lg rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.45)] border border-gray-6 overflow-hidden animate-in fade-in zoom-in-95 duration-300 relative flex flex-col max-h-[90vh]"
          role="dialog"
          aria-modal="true"
        >
          <div class="px-6 pt-6 pb-4 relative border-b border-transparent shrink-0">
            <button
              onClick={props.onClose}
              class="absolute top-6 right-6 p-1.5 text-gray-9 hover:text-gray-12 hover:bg-gray-4 rounded-lg transition-all"
              aria-label="Close"
              title="Close"
            >
              <X size={20} stroke-width={2.5} />
            </button>

            <Show when={activeView() !== "chooser"}>
              <button
                onClick={() => setActiveView("chooser")}
                class="absolute top-6 left-6 p-1.5 text-gray-9 hover:text-gray-12 hover:bg-gray-4 rounded-lg transition-all"
                aria-label="Back"
                title="Back to share options"
              >
                <ArrowLeft size={20} stroke-width={2.5} />
              </button>
            </Show>

            <div class="flex items-center gap-3" classList={{ "ml-8": activeView() !== "chooser" }}>
              <div class="w-10 h-10 bg-gray-12 rounded-xl flex items-center justify-center text-gray-1 font-bold text-lg shrink-0">
                {avatarLetter()}
              </div>
              <div class="min-w-0">
                <h2 class="text-[17px] font-bold text-gray-12 tracking-tight truncate">
                  <Show when={activeView() === "chooser"}>{title()}</Show>
                  <Show when={activeView() === "template"}>Share a template</Show>
                  <Show when={activeView() === "access"}>Access this workspace from another computer or device</Show>
                </h2>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-[13px] font-semibold text-gray-11 truncate">{props.workspaceName}</span>
                  <Show when={detail()}>
                    <span class="w-1 h-1 rounded-full bg-gray-6 shrink-0" />
                    <span class="text-[12px] text-gray-9 truncate max-w-[180px] font-mono">{detail()}</span>
                  </Show>
                </div>
              </div>
            </div>
          </div>

          <div class="px-6 pb-8 flex-1 overflow-y-auto scrollbar-hide">
            <Show when={activeView() === "chooser"}>
              <div class="space-y-3 pt-2 animate-in fade-in slide-in-from-bottom-3 duration-300">
                <button
                  type="button"
                  onClick={() => setActiveView("template")}
                  class="w-full text-left bg-gray-1 border border-gray-6 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-gray-8 hover:bg-gray-2 transition-all group"
                >
                  <div class="flex items-start gap-4">
                    <div class="p-2.5 bg-gray-2 rounded-xl text-gray-11 group-hover:text-gray-12 group-hover:bg-gray-3 transition-colors shadow-sm border border-gray-4 shrink-0">
                      <Rocket size={22} stroke-width={2} />
                    </div>
                    <div class="flex-1">
                      <h3 class="text-[15px] font-bold text-gray-12">Share a template</h3>
                      <p class="text-[13px] text-gray-9 leading-snug mt-1 pr-4">
                        Share your setup, skills, MCP configuration, and defaults so someone else can start from the same environment.
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveView("access")}
                  class="w-full text-left bg-gray-1 border border-gray-6 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-gray-8 hover:bg-gray-2 transition-all group"
                >
                  <div class="flex items-start gap-4">
                    <div class="p-2.5 bg-gray-2 rounded-xl text-gray-11 group-hover:text-gray-12 group-hover:bg-gray-3 transition-colors shadow-sm border border-gray-4 shrink-0">
                      <MonitorUp size={22} stroke-width={2} />
                    </div>
                    <div class="flex-1">
                      <h3 class="text-[15px] font-bold text-gray-12">Access this workspace from another computer or device</h3>
                      <p class="text-[13px] text-gray-9 leading-snug mt-1 pr-4">
                        Copy the connection details needed to reach this live workspace from another machine or messaging surface.
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </Show>

            <Show when={activeView() === "template"}>
              <div class="space-y-4 pt-2 animate-in fade-in slide-in-from-right-4 duration-300">
                <div class="rounded-xl border border-gray-6 bg-gray-2/50 px-4 py-3 text-[13px] text-gray-10">
                  Share a reusable setup without granting live access to this running workspace.
                </div>

                <div class="bg-gray-1 border border-gray-6 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all group">
                  <div class="flex items-center gap-3 mb-3">
                    <div class="p-2 bg-gray-2 rounded-lg text-gray-9 group-hover:text-gray-12 group-hover:bg-gray-3 transition-colors">
                      <FolderCode size={18} />
                    </div>
                    <div class="flex-1">
                      <h3 class="text-[14px] font-bold text-gray-12">Workspace template</h3>
                      <p class="text-[12px] text-gray-9 leading-tight">Config, MCP setup, and workspace defaults.</p>
                    </div>
                  </div>

                  <Show when={props.shareWorkspaceProfileError?.trim()}>
                    <div class="rounded-lg border border-red-6 bg-red-2 p-2 mb-3 text-[12px] text-red-11">
                      {props.shareWorkspaceProfileError}
                    </div>
                  </Show>
                  <Show when={props.shareWorkspaceProfileDisabledReason?.trim()}>
                    <div class="text-[12px] text-gray-9 mb-3">{props.shareWorkspaceProfileDisabledReason}</div>
                  </Show>

                  {renderGeneratedLink(
                    props.shareWorkspaceProfileUrl,
                    "share-workspace-profile",
                    props.onShareWorkspaceProfile,
                    props.shareWorkspaceProfileBusy,
                    "Create Template Link",
                    "Regenerate Link",
                    props.onShareWorkspaceProfile,
                    props.shareWorkspaceProfileDisabledReason,
                  )}
                </div>

                <div class="bg-gray-1 border border-gray-6 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all group">
                  <div class="flex items-center gap-3 mb-3">
                    <div class="p-2 bg-gray-2 rounded-lg text-gray-9 group-hover:text-gray-12 group-hover:bg-gray-3 transition-colors">
                      <Boxes size={18} />
                    </div>
                    <div class="flex-1">
                      <h3 class="text-[14px] font-bold text-gray-12">Skills bundle</h3>
                      <p class="text-[12px] text-gray-9 leading-tight">Share the installed skills set as a reusable pack.</p>
                    </div>
                  </div>

                  <Show when={props.shareSkillsSetError?.trim()}>
                    <div class="rounded-lg border border-red-6 bg-red-2 p-2 mb-3 text-[12px] text-red-11">
                      {props.shareSkillsSetError}
                    </div>
                  </Show>
                  <Show when={props.shareSkillsSetDisabledReason?.trim()}>
                    <div class="text-[12px] text-gray-9 mb-3">{props.shareSkillsSetDisabledReason}</div>
                  </Show>

                  <Show
                    when={props.shareSkillsSetUrl?.trim()}
                    fallback={
                      <div class="space-y-2">
                        <button
                          onClick={() => props.onShareSkillsSet?.()}
                          disabled={Boolean(props.shareSkillsSetDisabledReason) || !props.onShareSkillsSet || props.shareSkillsSetBusy}
                          class="w-full py-2.5 bg-gray-2 hover:bg-gray-3 text-gray-12 text-[13px] font-bold rounded-xl transition-all disabled:opacity-50"
                        >
                          {props.shareSkillsSetBusy ? "Publishing..." : "Create Skills Link"}
                        </button>
                        <button
                          onClick={() => props.onOpenSingleSkillShare?.()}
                          disabled={!props.onOpenSingleSkillShare}
                          class="w-full py-2.5 bg-gray-1 border border-gray-6 hover:bg-gray-2 text-gray-11 hover:text-gray-12 text-[13px] font-bold rounded-xl transition-all disabled:opacity-50"
                        >
                          Share Single Skill
                        </button>
                      </div>
                    }
                  >
                    <div>
                      <div class="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
                        <input
                          type="text"
                          readonly
                          value={props.shareSkillsSetUrl!}
                          class="flex-1 bg-gray-2 border border-gray-6 rounded-lg py-2 px-3 text-[12px] font-mono text-gray-11 outline-none"
                        />
                        <button
                          onClick={() => handleCopy(props.shareSkillsSetUrl ?? "", "share-skills-set")}
                          class="p-2 bg-gray-2 hover:bg-gray-3 text-gray-12 rounded-lg transition-colors border border-gray-6"
                        >
                          <Show when={copiedKey() === "share-skills-set"} fallback={<Copy size={16} />}>
                            <Check size={16} class="text-emerald-10" />
                          </Show>
                        </button>
                      </div>
                      <div class="mt-3 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => props.onShareSkillsSet?.()}
                          disabled={props.shareSkillsSetBusy}
                          class="py-2 bg-gray-2 hover:bg-gray-3 text-gray-11 hover:text-gray-12 text-[12px] font-bold rounded-lg transition-all"
                        >
                          {props.shareSkillsSetBusy ? "Publishing..." : "Regenerate Link"}
                        </button>
                        <button
                          onClick={() => props.onOpenSingleSkillShare?.()}
                          disabled={!props.onOpenSingleSkillShare}
                          class="py-2 bg-gray-1 border border-gray-6 hover:bg-gray-2 text-gray-11 hover:text-gray-12 text-[12px] font-bold rounded-lg transition-all disabled:opacity-50"
                        >
                          Share Single Skill
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>

                <div class="pt-2 border-t border-gray-4">
                  <div class="flex items-center justify-between p-3 bg-gray-2 rounded-2xl group hover:bg-gray-3 transition-all border border-gray-6">
                    <div class="flex items-center gap-3">
                      <div class="p-2 bg-gray-1 rounded-lg text-gray-9 shadow-sm border border-gray-6">
                        <Download size={18} />
                      </div>
                      <div>
                        <h4 class="text-[13px] font-bold text-gray-12">Export config bundle</h4>
                        <p class="text-[12px] text-gray-10">
                          {props.exportDisabledReason?.trim() || "Export your local OpenWork setup files"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => props.onExportConfig?.()}
                      disabled={!props.onExportConfig || Boolean(props.exportDisabledReason)}
                      class="px-4 py-2 bg-gray-1 border border-gray-7 hover:border-gray-8 hover:text-gray-12 rounded-xl text-[12px] font-bold text-gray-11 transition-all shadow-sm disabled:opacity-50 disabled:hover:border-gray-7 disabled:hover:text-gray-11"
                    >
                      Export
                    </button>
                  </div>
                </div>
              </div>
            </Show>

            <Show when={activeView() === "access"}>
              <div class="space-y-6 pt-2 animate-in fade-in slide-in-from-right-4 duration-300">
                <div class="bg-amber-2 border border-amber-6 p-3 rounded-xl">
                  <p class="text-[13px] text-amber-11 leading-relaxed flex items-start gap-2">
                    <span class="mt-0.5">⚠️</span>
                    <span>Share with trusted people only. These credentials grant live access to this workspace.</span>
                  </p>
                </div>

                <div class="space-y-5">
                  <For each={props.fields}>
                    {(field, index) => {
                      const key = () => `${field.label}:${index()}`;
                      const isSecret = () => Boolean(field.secret);
                      const revealed = () => Boolean(revealedByIndex()[index()]);

                      return (
                        <div class="group">
                          <label class="text-[12px] font-bold text-gray-9 uppercase tracking-wider mb-2 block ml-1">
                            {field.label}
                          </label>
                          <div class="relative flex items-center">
                            <input
                              type={isSecret() && !revealed() ? "password" : "text"}
                              readonly
                              value={field.value || field.placeholder || ""}
                              class="w-full bg-gray-2 border border-gray-6 group-hover:border-gray-8 rounded-xl py-3 pl-4 pr-24 text-[13px] font-mono text-gray-12 transition-all outline-none focus:ring-2 focus:ring-gray-8/40 focus:bg-gray-1"
                            />
                            <div class="absolute right-2 flex items-center gap-1">
                              <Show when={isSecret()}>
                                <button
                                  onClick={() =>
                                    setRevealedByIndex((prev) => ({
                                      ...prev,
                                      [index()]: !prev[index()],
                                    }))
                                  }
                                  disabled={!field.value}
                                  class="p-2 text-gray-9 hover:text-gray-12 hover:bg-gray-4/50 rounded-lg transition-all disabled:opacity-50"
                                >
                                  <Show when={revealed()} fallback={<Eye size={16} />}>
                                    <EyeOff size={16} />
                                  </Show>
                                </button>
                              </Show>
                              <button
                                onClick={() => handleCopy(field.value, key())}
                                disabled={!field.value}
                                class="p-2 text-gray-9 hover:text-gray-12 hover:bg-gray-4/50 rounded-lg transition-all disabled:opacity-50"
                              >
                                <Show when={copiedKey() === key()} fallback={<Copy size={16} />}>
                                  <Check size={16} class="text-emerald-10" />
                                </Show>
                              </button>
                            </div>
                          </div>
                          <Show when={field.hint && field.hint.trim()}>
                            <p class="text-[12px] text-gray-9 mt-2 ml-1 italic">{field.hint}</p>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>

                <Show when={note()}>
                  <div class="rounded-xl border border-gray-6 bg-gray-2/40 px-4 py-3 text-[13px] text-gray-10">
                    {note()}
                  </div>
                </Show>

                <div class="pt-2 border-t border-gray-4">
                  <div class="flex items-center justify-between p-3 bg-gray-2 rounded-2xl group hover:bg-gray-3 transition-all border border-gray-6">
                    <div class="flex items-center gap-3">
                      <div class="p-2 bg-gray-1 rounded-lg text-gray-9 shadow-sm border border-gray-6">
                        <MessageSquare size={18} />
                      </div>
                      <div>
                        <h4 class="text-[13px] font-bold text-gray-12">Connect messaging</h4>
                        <p class="text-[12px] text-gray-10">Use this workspace from Slack, Telegram, and other connected surfaces.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => props.onOpenBots?.()}
                      disabled={!props.onOpenBots}
                      class="px-4 py-2 bg-gray-1 border border-gray-7 hover:border-gray-8 hover:text-gray-12 rounded-xl text-[12px] font-bold text-gray-11 transition-all shadow-sm disabled:opacity-50 disabled:hover:border-gray-7 disabled:hover:text-gray-11"
                    >
                      Setup
                    </button>
                  </div>
                </div>
              </div>
            </Show>
          </div>

          <div class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-1 to-transparent pointer-events-none rounded-b-2xl" />
        </div>
      </div>
    </Show>
  );
}
