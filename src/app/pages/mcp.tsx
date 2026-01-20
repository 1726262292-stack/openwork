import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import type { McpServerEntry, McpStatusMap } from "../types";
import type { McpDirectoryInfo } from "../constants";
import { formatRelativeTime, isTauriRuntime, isWindowsPlatform } from "../utils";
import { readOpencodeConfig, type OpencodeConfigFile } from "../lib/tauri";

import Button from "../components/button";
import { CheckCircle2, CircleAlert, Loader2, PlugZap, Settings, TriangleAlert, ChevronDown, ChevronRight, ExternalLink, FolderOpen } from "lucide-solid";

export type McpViewProps = {
  mode: "host" | "client" | null;
  busy: boolean;
  activeWorkspaceRoot: string;
  mcpServers: McpServerEntry[];
  mcpStatus: string | null;
  mcpLastUpdatedAt: number | null;
  mcpStatuses: McpStatusMap;
  mcpConnectingName: string | null;
  selectedMcp: string | null;
  setSelectedMcp: (name: string | null) => void;
  quickConnect: McpDirectoryInfo[];
  connectMcp: (entry: McpDirectoryInfo) => void;
  showMcpReloadBanner: boolean;
  reloadMcpEngine: () => void;
};

const statusBadge = (status: "connected" | "needs_auth" | "needs_client_registration" | "failed" | "disabled" | "disconnected") => {
  switch (status) {
    case "connected":
      return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
    case "needs_auth":
    case "needs_client_registration":
      return "bg-amber-500/10 text-amber-300 border-amber-500/20";
    case "disabled":
      return "bg-zinc-800/60 text-zinc-400 border-zinc-700/50";
    case "disconnected":
      return "bg-zinc-900/80 text-zinc-200 border-zinc-700/50";
    default:
      return "bg-red-500/10 text-red-300 border-red-500/20";
  }
};

const statusLabel = (status: "connected" | "needs_auth" | "needs_client_registration" | "failed" | "disabled" | "disconnected") => {
  switch (status) {
    case "connected":
      return "Connected";
    case "needs_auth":
      return "Needs auth";
    case "needs_client_registration":
      return "Register client";
    case "disabled":
      return "Disabled";
    case "disconnected":
      return "Disconnected";
    default:
      return "Failed";
  }
};

export default function McpView(props: McpViewProps) {
  const [showDangerousContent, setShowDangerousContent] = createSignal(true);

  const [configScope, setConfigScope] = createSignal<"project" | "global">("project");
  const [projectConfig, setProjectConfig] = createSignal<OpencodeConfigFile | null>(null);
  const [globalConfig, setGlobalConfig] = createSignal<OpencodeConfigFile | null>(null);
  const [configError, setConfigError] = createSignal<string | null>(null);
  const [revealBusy, setRevealBusy] = createSignal(false);

  const selectedEntry = createMemo(() =>
    props.mcpServers.find((entry) => entry.name === props.selectedMcp) ?? null,
  );

  const quickConnectList = createMemo(() =>
    props.quickConnect.filter((entry) => entry.oauth),
  );

  let configRequestId = 0;
  createEffect(() => {
    const root = props.activeWorkspaceRoot.trim();
    const nextId = (configRequestId += 1);

    if (!isTauriRuntime()) {
      setProjectConfig(null);
      setGlobalConfig(null);
      setConfigError(null);
      return;
    }

    void (async () => {
      try {
        setConfigError(null);

        const [project, global] = await Promise.all([
          root ? readOpencodeConfig("project", root) : Promise.resolve(null),
          readOpencodeConfig("global", root),
        ]);

        if (nextId !== configRequestId) return;
        setProjectConfig(project);
        setGlobalConfig(global);
      } catch (e) {
        if (nextId !== configRequestId) return;
        setProjectConfig(null);
        setGlobalConfig(null);
        setConfigError(e instanceof Error ? e.message : "Failed to load config path");
      }
    })();
  });

  const activeConfig = createMemo(() =>
    configScope() === "project" ? projectConfig() : globalConfig(),
  );

  const revealLabel = () => (isWindowsPlatform() ? "Open file" : "Reveal in Finder");

  const canRevealConfig = () => {
    if (!isTauriRuntime() || revealBusy()) return false;
    if (configScope() === "project" && !props.activeWorkspaceRoot.trim()) return false;
    return Boolean(activeConfig()?.exists);
  };

  const revealConfig = async () => {
    if (!isTauriRuntime()) return;
    if (revealBusy()) return;
    const root = props.activeWorkspaceRoot.trim();

    if (configScope() === "project" && !root) {
      setConfigError("Pick a workspace folder to reveal the project opencode.json.");
      return;
    }

    setRevealBusy(true);
    setConfigError(null);
    try {
      const resolved = await readOpencodeConfig(configScope(), root);

      const { openPath, revealItemInDir } = await import("@tauri-apps/plugin-opener");
      if (isWindowsPlatform()) {
        await openPath(resolved.path);
      } else {
        await revealItemInDir(resolved.path);
      }
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Failed to reveal config");
    } finally {
      setRevealBusy(false);
    }
  };

  // Convert name to slug (same logic used when adding MCPs)
  const toSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  // Look up status by slug, not display name
  const quickConnectStatus = (name: string) => {
    const slug = toSlug(name);
    return props.mcpStatuses[slug];
  };

  const isQuickConnectConnected = (name: string) => {
    const status = quickConnectStatus(name);
    return status?.status === "connected";
  };

  const canConnect = (entry: McpDirectoryInfo) =>
    props.mode === "host" && isTauriRuntime() && !props.busy && !!props.activeWorkspaceRoot.trim();

  return (
    <section class="space-y-6">
      <div class="space-y-4">
        <div class="space-y-1">
          <h2 class="text-lg font-semibold text-white">MCP (Alpha)</h2>
          <p class="text-sm text-zinc-400">
            MCP servers let you connect services with your own credentials.
          </p>
        </div>

        <div class="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 space-y-4">
          <div class="flex items-start gap-3">
            <TriangleAlert size={20} class="text-amber-400 shrink-0 mt-0.5" />
            <div class="space-y-3">
              <div class="text-sm font-medium text-amber-200">
                MCP is in alpha while we harden OAuth with OpenCode.
              </div>
              <div class="flex flex-col gap-2">
                <a
                  href="https://github.com/anomalyco/opencode/issues/9510"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 text-xs text-amber-400/80 hover:text-amber-400 underline decoration-amber-400/30 underline-offset-4 transition-colors"
                >
                  <ExternalLink size={12} />
                  View issue #9510 on GitHub
                </a>
                <p class="text-xs text-zinc-400 leading-relaxed">
                  If you want to help, open a PR and include a short video showing the OAuth flow works end to end.
                </p>
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowDangerousContent(!showDangerousContent())}
          class="flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors group"
        >
          <Show when={showDangerousContent()} fallback={<ChevronRight size={14} class="group-hover:translate-x-0.5 transition-transform" />}>
            <ChevronDown size={14} />
          </Show>
          {showDangerousContent() ? "Hide advanced settings" : "Show advanced settings"}
        </button>
      </div>

      <Show when={showDangerousContent()}>
        <div class="grid gap-6 lg:grid-cols-[1.5fr_1fr] animate-in fade-in slide-in-from-top-2 duration-300">
          <div class="space-y-6">
            <div class="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl p-5 space-y-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="text-sm font-medium text-white">MCPs</div>
                  <div class="text-xs text-zinc-500">
                    Connect MCP servers to expand what OpenWork can do.
                  </div>
                </div>
                <div class="text-xs text-zinc-500 text-right">
                  <div>{props.mcpServers.length} configured</div>
                  <Show when={props.mcpLastUpdatedAt}>
                    <div>Updated {formatRelativeTime(props.mcpLastUpdatedAt ?? Date.now())}</div>
                  </Show>
                </div>
              </div>
              <Show when={props.mcpStatus}>
                <div class="text-xs text-zinc-500">{props.mcpStatus}</div>
              </Show>
            </div>

            <Show when={props.showMcpReloadBanner}>
              <div class="bg-zinc-900/60 border border-zinc-800/70 rounded-2xl px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div class="text-sm font-medium text-white">Reload required</div>
                  <div class="text-xs text-zinc-500">
                    Changes need a quick reload to activate MCP tools.
                  </div>
                </div>
                <Button variant="secondary" onClick={() => props.reloadMcpEngine()}>
                  Reload Engine
                </Button>
              </div>
            </Show>

            <div class="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl p-5 space-y-4">
              <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-white">Quick connect</div>
                <div class="text-[11px] text-zinc-500">OAuth-only</div>
              </div>
              <div class="grid gap-3">
                <For each={quickConnectList()}>
                  {(entry) => (
                    <div class="rounded-2xl border border-zinc-800/70 bg-zinc-950/40 p-4 space-y-3">
                      <div class="flex items-start justify-between gap-4">
                        <div>
                          <div class="text-sm font-medium text-white">{entry.name}</div>
                          <div class="text-xs text-zinc-500 mt-1">{entry.description}</div>
                          <div class="text-xs text-zinc-600 font-mono mt-1">{entry.url}</div>
                        </div>
                        <div class="flex flex-col items-end gap-2">
                          <Show
                            when={!isQuickConnectConnected(entry.name)}
                            fallback={
                              <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                                <CheckCircle2 size={16} class="text-emerald-400" />
                                <span class="text-sm text-emerald-300">Connected</span>
                              </div>
                            }
                          >
                            <Button
                              variant="secondary"
                              onClick={() => props.connectMcp(entry)}
                              disabled={!canConnect(entry) || props.mcpConnectingName === entry.name}
                            >
                              {props.mcpConnectingName === entry.name ? (
                                <>
                                  <Loader2 size={16} class="animate-spin" />
                                  Connecting
                                </>
                              ) : (
                                <>
                                  <PlugZap size={16} />
                                  Connect
                                </>
                              )}
                            </Button>
                          </Show>
                          <Show when={quickConnectStatus(entry.name)}>
                            {(status) => (
                              <Show when={status().status !== "connected"}>
                                <div class={`text-[11px] px-2 py-1 rounded-full border ${statusBadge(status().status)}`}>
                                  {statusLabel(status().status)}
                                </div>
                              </Show>
                            )}
                          </Show>
                        </div>
                      </div>
                      <div class="text-[11px] text-zinc-500">No environment variables required.</div>
                    </div>
                  )}
                </For>
              </div>
            </div>

            <div class="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl p-5 space-y-4">
              <div class="flex items-center justify-between">
                <div class="text-sm font-medium text-white">Connected</div>
                <div class="text-[11px] text-zinc-500">From project opencode.json</div>
              </div>
              <Show
                when={props.mcpServers.length}
                fallback={
                  <div class="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4 text-sm text-zinc-500">
                    No MCP servers configured yet.
                  </div>
                }
              >
                <div class="grid gap-3">
                  <For each={props.mcpServers}>
                    {(entry) => {
                      const resolved = props.mcpStatuses[entry.name];
                      const status =
                        entry.config.enabled === false
                          ? "disabled"
                          : resolved?.status
                            ? resolved.status
                            : "disconnected";
                      return (
                        <button
                          type="button"
                          class={`text-left rounded-2xl border px-4 py-3 transition-all ${
                            props.selectedMcp === entry.name
                              ? "border-zinc-600 bg-zinc-900/70"
                              : "border-zinc-800/70 bg-zinc-950/40 hover:border-zinc-700"
                          }`}
                          onClick={() => props.setSelectedMcp(entry.name)}
                        >
                          <div class="flex items-center justify-between gap-3">
                            <div>
                              <div class="text-sm font-medium text-white">{entry.name}</div>
                              <div class="text-xs text-zinc-500 font-mono">
                                {entry.config.type === "remote" ? entry.config.url : entry.config.command?.join(" ")}
                              </div>
                            </div>
                            <div class={`text-[11px] px-2 py-1 rounded-full border ${statusBadge(status)}`}>
                              {statusLabel(status)}
                            </div>
                          </div>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>

            <div class="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl p-5 space-y-4">
              <div class="flex items-start justify-between gap-4">
                <div class="space-y-1">
                  <div class="text-sm font-medium text-white">Edit MCP config</div>
                  <div class="text-xs text-zinc-500">
                    MCP servers live in OpenCode&apos;s <span class="font-mono">opencode.json</span>.
                  </div>
                </div>
                <a
                  href="https://opencode.ai/docs/mcp-servers/"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 underline decoration-zinc-500/30 underline-offset-4 transition-colors"
                >
                  <ExternalLink size={12} />
                  Docs
                </a>
              </div>

              <div class="flex items-center gap-2">
                <button
                  class={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    configScope() === "project"
                      ? "bg-white/10 text-white border-white/20"
                      : "text-zinc-500 border-zinc-800 hover:text-white"
                  }`}
                  onClick={() => setConfigScope("project")}
                >
                  Project
                </button>
                <button
                  class={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    configScope() === "global"
                      ? "bg-white/10 text-white border-white/20"
                      : "text-zinc-500 border-zinc-800 hover:text-white"
                  }`}
                  onClick={() => setConfigScope("global")}
                >
                  Global
                </button>
              </div>

              <div class="flex flex-col gap-1 text-xs text-zinc-500">
                <div>Config</div>
                <div class="text-zinc-600 font-mono truncate">
                  {activeConfig()?.path ?? "Not loaded yet"}
                </div>
              </div>

              <div class="flex items-center justify-between gap-3">
                <Button
                  variant="secondary"
                  onClick={revealConfig}
                  disabled={!canRevealConfig()}
                >
                  <Show
                    when={revealBusy()}
                    fallback={
                      <>
                        <FolderOpen size={16} />
                        {revealLabel()}
                      </>
                    }
                  >
                    <Loader2 size={16} class="animate-spin" />
                    Opening
                  </Show>
                </Button>
                <Show when={activeConfig() && activeConfig()!.exists === false}>
                  <div class="text-[11px] text-zinc-600">File not found</div>
                </Show>
              </div>

              <Show when={configError()}>
                <div class="text-xs text-red-300">{configError()}</div>
              </Show>
            </div>
          </div>

          <div class="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl p-5 space-y-4 lg:sticky lg:top-6 self-start">
            <div class="flex items-center justify-between">
              <div class="text-sm font-medium text-white">Details</div>
              <div class="text-xs text-zinc-500">{selectedEntry()?.name ?? "Select a server"}</div>
            </div>

            <Show
              when={selectedEntry()}
              fallback={
                <div class="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4 text-sm text-zinc-500">
                  Select a server to review status and config.
                </div>
              }
            >
              {(entry) => (
                <div class="space-y-4">
                  <div class="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4 space-y-2">
                    <div class="flex items-center gap-2 text-sm text-white">
                      <Settings size={16} />
                      {entry().name}
                    </div>
                    <div class="text-xs text-zinc-500 font-mono break-all">
                      {entry().config.type === "remote" ? entry().config.url : entry().config.command?.join(" ")}
                    </div>
                    <div class="flex items-center gap-2">
                      {(() => {
                        const resolved = props.mcpStatuses[entry().name];
                        const status =
                          entry().config.enabled === false
                            ? "disabled"
                            : resolved?.status
                              ? resolved.status
                              : "disconnected";
                        return (
                          <span class={`inline-flex items-center gap-2 text-[11px] px-2 py-1 rounded-full border ${statusBadge(status)}`}>
                            {statusLabel(status)}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  <div class="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4 space-y-2">
                    <div class="text-xs text-zinc-400 uppercase tracking-wider">Capabilities</div>
                    <div class="flex flex-wrap gap-2">
                      <span class="text-[10px] uppercase tracking-wide bg-zinc-800/70 text-zinc-400 px-2 py-0.5 rounded-full">
                        Tools enabled
                      </span>
                      <span class="text-[10px] uppercase tracking-wide bg-zinc-800/70 text-zinc-400 px-2 py-0.5 rounded-full">
                        OAuth ready
                      </span>
                    </div>
                    <div class="text-xs text-zinc-500">
                      Use the MCP server name in prompts to target its tools.
                    </div>
                  </div>

                  <div class="rounded-xl border border-zinc-800/70 bg-zinc-950/40 p-4 space-y-2">
                    <div class="text-xs text-zinc-400 uppercase tracking-wider">Next steps</div>
                    <div class="flex items-center gap-2 text-xs text-zinc-500">
                      <CheckCircle2 size={14} />
                      Reload the engine after adding a server.
                    </div>
                    <div class="flex items-center gap-2 text-xs text-zinc-500">
                      <CircleAlert size={14} />
                      Run opencode mcp auth for OAuth servers if prompted.
                    </div>
                    {(() => {
                      const status = props.mcpStatuses[entry().name];
                      if (!status || status.status !== "failed") return null;
                      return (
                        <div class="text-xs text-red-300">
                          {"error" in status ? status.error : "Connection failed"}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
}
