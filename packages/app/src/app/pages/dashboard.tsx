import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type {
  DashboardTab,
  McpServerEntry,
  McpStatusMap,
  OpencodeConnectStatus,
  PluginScope,
  ProviderListItem,
  SettingsTab,
  ScheduledJob,
  SkillCard,
  StartupPreference,
  View,
} from "../types";
import type { McpDirectoryInfo } from "../constants";
import { formatRelativeTime } from "../utils";
import type {
  OpenworkAuditEntry,
  OpenworkServerCapabilities,
  OpenworkServerDiagnostics,
  OpenworkServerSettings,
  OpenworkServerStatus,
} from "../lib/openwork-server";
import type { EngineInfo, OpenwrkStatus, OpenworkServerInfo, OwpenbotInfo, WorkspaceInfo } from "../lib/tauri";

import Button from "../components/button";
import McpView from "./mcp";
import PluginsView from "./plugins";
import ScheduledTasksView from "./scheduled";
import SettingsView from "./settings";
import SkillsView from "./skills";
import StatusBar from "../components/status-bar";
import ProviderAuthModal from "../components/provider-auth-modal";
import {
  Box,
  ChevronRight,
  Edit2,
  History,
  Layout,
  MoreHorizontal,
  Plus,
  Settings,
  Zap,
} from "lucide-solid";

export type DashboardViewProps = {
  tab: DashboardTab;
  setTab: (tab: DashboardTab) => void;
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  providers: ProviderListItem[];
  providerConnectedIds: string[];
  providerAuthBusy: boolean;
  providerAuthModalOpen: boolean;
  providerAuthError: string | null;
  providerAuthMethods: Record<string, { type: "oauth" | "api"; label: string }[]>;
  openProviderAuthModal: () => Promise<void>;
  closeProviderAuthModal: () => void;
  startProviderAuth: (providerId?: string) => Promise<string>;
  submitProviderApiKey: (providerId: string, apiKey: string) => Promise<string | void>;
  view: View;
  setView: (view: View, sessionId?: string) => void;
  startupPreference: StartupPreference | null;
  baseUrl: string;
  clientConnected: boolean;
  busy: boolean;
  busyHint: string | null;
  busyLabel: string | null;
  newTaskDisabled: boolean;
  headerStatus: string;
  error: string | null;
  openworkServerStatus: OpenworkServerStatus;
  openworkServerUrl: string;
  openworkServerSettings: OpenworkServerSettings;
  openworkServerHostInfo: OpenworkServerInfo | null;
  openworkServerCapabilities: OpenworkServerCapabilities | null;
  openworkServerDiagnostics: OpenworkServerDiagnostics | null;
  openworkServerWorkspaceId: string | null;
  openworkAuditEntries: OpenworkAuditEntry[];
  openworkAuditStatus: "idle" | "loading" | "error";
  openworkAuditError: string | null;
  opencodeConnectStatus: OpencodeConnectStatus | null;
  engineInfo: EngineInfo | null;
  engineDoctorVersion: string | null;
  openwrkStatus: OpenwrkStatus | null;
  owpenbotInfo: OwpenbotInfo | null;
  updateOpenworkServerSettings: (next: OpenworkServerSettings) => void;
  resetOpenworkServerSettings: () => void;
  testOpenworkServerConnection: (next: OpenworkServerSettings) => Promise<boolean>;
  canReloadWorkspace: boolean;
  reloadWorkspaceEngine: () => Promise<void>;
  reloadBusy: boolean;
  reloadError: string | null;
  activeWorkspaceDisplay: WorkspaceInfo;
  exportWorkspaceConfig: () => void;
  exportWorkspaceBusy: boolean;
  sessions: Array<{
    id: string;
    slug?: string | null;
    title: string;
    time: { updated: number };
    directory?: string | null;
  }>;
  sessionStatusById: Record<string, string>;
  scheduledJobs: ScheduledJob[];
  scheduledJobsSource: "local" | "remote";
  scheduledJobsSourceReady: boolean;
  scheduledJobsStatus: string | null;
  scheduledJobsBusy: boolean;
  scheduledJobsUpdatedAt: number | null;
  refreshScheduledJobs: (options?: { force?: boolean }) => void;
  deleteScheduledJob: (name: string) => Promise<void> | void;
  activeWorkspaceRoot: string;
  refreshSkills: (options?: { force?: boolean }) => void;
  refreshPlugins: (scopeOverride?: PluginScope) => void;
  refreshMcpServers: () => void;
  skills: SkillCard[];
  skillsStatus: string | null;
  skillsAccessHint?: string | null;
  canInstallSkillCreator: boolean;
  canUseDesktopTools: boolean;
  importLocalSkill: () => void;
  installSkillCreator: () => void;
  revealSkillsFolder: () => void;
  uninstallSkill: (name: string) => void;
  pluginsAccessHint?: string | null;
  canEditPlugins: boolean;
  canUseGlobalPluginScope: boolean;
  pluginScope: PluginScope;
  setPluginScope: (scope: PluginScope) => void;
  pluginConfigPath: string | null;
  pluginList: string[];
  pluginInput: string;
  setPluginInput: (value: string) => void;
  pluginStatus: string | null;
  activePluginGuide: string | null;
  setActivePluginGuide: (value: string | null) => void;
  isPluginInstalled: (name: string, aliases?: string[]) => boolean;
  suggestedPlugins: Array<{
    name: string;
    packageName: string;
    description: string;
    tags: string[];
    aliases?: string[];
    installMode?: "simple" | "guided";
    steps?: Array<{
      title: string;
      description: string;
      command?: string;
      url?: string;
      path?: string;
      note?: string;
    }>;
  }>;
  addPlugin: (pluginNameOverride?: string) => void;
  mcpServers: McpServerEntry[];
  mcpStatus: string | null;
  mcpLastUpdatedAt: number | null;
  mcpStatuses: McpStatusMap;
  mcpConnectingName: string | null;
  selectedMcp: string | null;
  setSelectedMcp: (value: string | null) => void;
  quickConnect: McpDirectoryInfo[];
  connectMcp: (entry: McpDirectoryInfo) => void;
  showMcpReloadBanner: boolean;
  mcpReloadBlocked: boolean;
  reloadMcpEngine: () => void;
  createSessionAndOpen: () => void;
  setPrompt: (value: string) => void;
  selectSession: (sessionId: string) => Promise<void> | void;
  defaultModelLabel: string;
  defaultModelRef: string;
  openDefaultModelPicker: () => void;
  showThinking: boolean;
  toggleShowThinking: () => void;
  modelVariantLabel: string;
  editModelVariant: () => void;
  updateAutoCheck: boolean;
  toggleUpdateAutoCheck: () => void;
  themeMode: "light" | "dark" | "system";
  setThemeMode: (value: "light" | "dark" | "system") => void;
  updateStatus: {
    state: string;
    lastCheckedAt?: number | null;
    version?: string;
    date?: string;
    notes?: string;
    totalBytes?: number | null;
    downloadedBytes?: number;
    message?: string;
  } | null;
  updateEnv: { supported?: boolean; reason?: string | null } | null;
  appVersion: string | null;
  checkForUpdates: () => void;
  downloadUpdate: () => void;
  installUpdateAndRestart: () => void;
  anyActiveRuns: boolean;
  engineSource: "path" | "sidecar";
  setEngineSource: (value: "path" | "sidecar") => void;
  engineRuntime: "direct" | "openwrk";
  setEngineRuntime: (value: "direct" | "openwrk") => void;
  isWindows: boolean;
  toggleDeveloperMode: () => void;
  developerMode: boolean;
  stopHost: () => void;
  openResetModal: (mode: "onboarding" | "all") => void;
  resetModalBusy: boolean;
  onResetStartupPreference: () => void;
  pendingPermissions: unknown;
  events: unknown;
  safeStringify: (value: unknown) => string;
  repairOpencodeCache: () => void;
  cacheRepairBusy: boolean;
  cacheRepairResult: string | null;
  notionStatus: "disconnected" | "connecting" | "connected" | "error";
  notionStatusDetail: string | null;
  notionError: string | null;
  notionBusy: boolean;
  connectNotion: () => void;
};

export default function DashboardView(props: DashboardViewProps) {
  const title = createMemo(() => {
    switch (props.tab) {
      case "scheduled":
        return "Automations";
      case "skills":
        return "Skills";
      case "plugins":
        return "Plugins";
      case "mcp":
        return "Apps";
      case "settings":
        return "Settings";
      default:
        return "Automations";
    }
  });

  const workspaceStatus = createMemo(() => {
    switch (props.openworkServerStatus) {
      case "connected":
        return { label: "Live", className: "bg-emerald-3 text-emerald-11" };
      case "limited":
        return { label: "Limited", className: "bg-amber-3 text-amber-11" };
      case "disconnected":
      default:
        return { label: "Offline", className: "bg-red-3 text-red-11" };
    }
  });
  const workspaceTypeLabel = createMemo(() =>
    props.activeWorkspaceDisplay.workspaceType === "remote" ? "Remote" : "Local"
  );

  const openSessionFromList = (sessionId: string) => {
    // Defer view switch to avoid click-through on the same event frame.
    window.setTimeout(() => {
      void props.selectSession(sessionId);
      props.setView("session", sessionId);
    }, 0);
  };

  // Track last refreshed tab to avoid duplicate calls
  const [lastRefreshedTab, setLastRefreshedTab] = createSignal<string | null>(null);
  const [refreshInProgress, setRefreshInProgress] = createSignal(false);
  const [providerAuthActionBusy, setProviderAuthActionBusy] = createSignal(false);
  const [sessionsExpanded, setSessionsExpanded] = createSignal(true);
  const [showAllSessions, setShowAllSessions] = createSignal(false);
  const visibleSessions = createMemo(() =>
    showAllSessions() ? props.sessions : props.sessions.slice(0, 5)
  );

  const handleProviderAuthSelect = async (providerId: string) => {
    if (providerAuthActionBusy()) return;
    setProviderAuthActionBusy(true);
    try {
      await props.startProviderAuth(providerId);
      props.closeProviderAuthModal();
    } catch {
      // Errors are surfaced in the modal.
    } finally {
      setProviderAuthActionBusy(false);
    }
  };

  const handleProviderAuthApiKey = async (providerId: string, apiKey: string) => {
    if (providerAuthActionBusy()) return;
    setProviderAuthActionBusy(true);
    try {
      await props.submitProviderApiKey(providerId, apiKey);
      props.closeProviderAuthModal();
    } catch {
      // Errors are surfaced in the modal.
    } finally {
      setProviderAuthActionBusy(false);
    }
  };

  onCleanup(() => {
    // no-op
  });

  createEffect(() => {
    const currentTab = props.tab;

    // Skip if we already refreshed this tab or a refresh is in progress
    if (lastRefreshedTab() === currentTab || refreshInProgress()) {
      return;
    }

    // Track that we're refreshing this tab
    setRefreshInProgress(true);
    setLastRefreshedTab(currentTab);

    // Use a cancelled flag to prevent stale updates after navigation
    let cancelled = false;

    const doRefresh = async () => {
      try {
        if (currentTab === "skills" && !cancelled) {
          await props.refreshSkills();
        }
        if (currentTab === "plugins" && !cancelled) {
          await props.refreshPlugins();
        }
        if (currentTab === "mcp" && !cancelled) {
          await props.refreshMcpServers();
        }
        if (currentTab === "scheduled" && !cancelled) {
          await props.refreshScheduledJobs();
        }
      } catch {
        // Ignore errors during navigation
      } finally {
        if (!cancelled) {
          setRefreshInProgress(false);
        }
      }
    };

    doRefresh();

    onCleanup(() => {
      cancelled = true;
      setRefreshInProgress(false);
    });
  });

  const navItem = (t: DashboardTab, label: any, icon: any) => {
    const active = () => props.tab === t;
    return (
      <button
        class={`w-full h-10 flex items-center gap-3 px-3 rounded-lg text-sm font-medium transition-colors ${
          active()
            ? "bg-dls-active text-dls-text"
            : "text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
        }`}
        onClick={() => props.setTab(t)}
      >
        {icon}
        {label}
      </button>
    );
  };

  const openSettings = (tab: SettingsTab = "general") => {
    props.setSettingsTab(tab);
    props.setTab("settings");
  };

  return (
    <div class="flex h-screen w-full bg-dls-surface text-dls-text font-sans overflow-hidden">
      <aside class="w-64 hidden md:flex flex-col bg-dls-sidebar border-r border-dls-border p-4">
        <div class="space-y-0.5 mb-6 pt-2">
          {navItem("scheduled", "Automations", <History size={18} />)}
          {navItem("skills", "Skills", <Zap size={18} />)}
          {navItem("mcp", "Apps", <Box size={18} />)}
        </div>

        <div class="space-y-2 mb-6">
          <div class="flex items-center justify-between text-[11px] font-bold text-dls-secondary uppercase px-3 tracking-tight">
            <span>Workspace</span>
            <button
              type="button"
              aria-label="Workspace settings"
              onClick={() => openSettings("general")}
              class="text-dls-secondary hover:text-dls-text"
            >
              <Settings size={14} />
            </button>
          </div>
          <div class="rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
            <div class="text-sm font-semibold text-dls-text truncate">
              {props.activeWorkspaceDisplay.name}
            </div>
            <div class="mt-1 flex items-center gap-2 text-xs text-dls-secondary">
              <span>{workspaceTypeLabel()}</span>
              <span>{workspaceStatus().label}</span>
            </div>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto">
          <div class="flex items-center justify-between text-[11px] font-bold text-dls-secondary uppercase px-3 mb-3 tracking-tight">
            <span>Sessions</span>
            <div class="flex gap-2 text-dls-secondary">
              <button type="button" class="hover:text-dls-text" aria-label="Session layout">
                <Layout size={14} />
              </button>
              <button
                type="button"
                class="hover:text-dls-text"
                aria-label="New session"
                onClick={props.createSessionAndOpen}
                disabled={props.newTaskDisabled}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div class="mb-2">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSessionsExpanded((current) => !current)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setSessionsExpanded((current) => !current);
              }}
              class="group flex items-center justify-between h-8 px-3 rounded-lg cursor-pointer text-dls-text transition-colors hover:bg-dls-hover"
            >
              <div class="flex items-center gap-2">
                <ChevronRight
                  size={14}
                  class={`text-dls-secondary transition-transform ${
                    sessionsExpanded() ? "rotate-90" : ""
                  }`}
                />
                <span class="text-sm font-medium">{props.activeWorkspaceDisplay.name}</span>
              </div>
              <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  class="p-1 hover:bg-dls-active rounded-md text-dls-secondary transition-colors"
                  onClick={(event) => event.stopPropagation()}
                  aria-label="Workspace options"
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </div>

            <Show when={sessionsExpanded()}>
              <div class="mt-0.5 space-y-0.5 border-l border-dls-border ml-4">
                <Show
                  when={props.sessions.length > 0}
                  fallback={
                    <div class="px-3 py-2 text-xs text-dls-secondary">
                      No sessions yet.
                    </div>
                  }
                >
                  <For each={visibleSessions()}>
                    {(session) => (
                      <div
                        role="button"
                        tabIndex={0}
                        class="group flex items-center justify-between h-8 px-3 hover:bg-dls-hover rounded-lg cursor-pointer relative overflow-hidden ml-5 w-[calc(100%-1.25rem)]"
                        onClick={() => openSessionFromList(session.id)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          openSessionFromList(session.id);
                        }}
                      >
                        <span class="text-sm text-dls-text truncate mr-2 font-medium group-hover:pr-14 transition-all">
                          {session.title}
                        </span>
                        <span class="text-xs text-dls-secondary whitespace-nowrap group-hover:opacity-0 transition-opacity">
                          {formatRelativeTime(session.time.updated)}
                        </span>
                        <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            class="p-1 hover:bg-dls-active rounded-md text-dls-text transition-colors"
                            onClick={(event) => event.stopPropagation()}
                            aria-label="Session options"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          <button
                            type="button"
                            class="p-1 hover:bg-dls-active rounded-md text-dls-text transition-colors"
                            onClick={(event) => event.stopPropagation()}
                            aria-label="Rename session"
                          >
                            <Edit2 size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>

          <Show when={props.sessions.length > 5}>
            <button
              type="button"
              onClick={() => setShowAllSessions((current) => !current)}
              class="px-3 py-1.5 text-xs text-dls-secondary hover:text-dls-text font-medium"
            >
              {showAllSessions() ? "Show less" : "Show more"}
            </button>
          </Show>
        </div>

        <div class="pt-4 border-t border-dls-border">
          <button
            type="button"
            onClick={() => openSettings("general")}
            class="flex items-center gap-3 px-3 py-2 rounded-lg text-dls-secondary hover:bg-dls-hover transition-colors"
          >
            <Settings size={18} />
            <span class="text-sm font-medium">Settings</span>
          </button>
        </div>
      </aside>

      <main class="flex-1 overflow-y-auto relative pb-24 md:pb-12 bg-dls-surface">
        <header class="h-14 flex items-center justify-between px-6 md:px-10 border-b border-dls-border sticky top-0 bg-dls-surface z-10">
          <div class="flex items-center gap-3">
            <div class="px-3 py-1.5 rounded-xl bg-dls-hover text-xs text-dls-secondary font-medium">
              {props.activeWorkspaceDisplay.name}
            </div>
            <h1 class="text-lg font-medium">{title()}</h1>
            <Show when={props.developerMode}>
              <span class="text-xs text-dls-secondary">{props.headerStatus}</span>
            </Show>
            <Show when={props.busyHint}>
              <span class="text-xs text-dls-secondary">{props.busyHint}</span>
            </Show>
          </div>
          <div class="flex items-center gap-2" />
        </header>

        <div class="p-6 md:p-10 max-w-5xl mx-auto space-y-10">
          <Switch>
            <Match when={props.tab === "scheduled"}>
              <ScheduledTasksView
                jobs={props.scheduledJobs}
                source={props.scheduledJobsSource}
                sourceReady={props.scheduledJobsSourceReady}
                status={props.scheduledJobsStatus}
                busy={props.scheduledJobsBusy}
                lastUpdatedAt={props.scheduledJobsUpdatedAt}
                refreshJobs={props.refreshScheduledJobs}
                deleteJob={props.deleteScheduledJob}
                isWindows={props.isWindows}
              />
            </Match>
            <Match when={props.tab === "skills"}>
              <SkillsView
                busy={props.busy}
                canInstallSkillCreator={props.canInstallSkillCreator}
                canUseDesktopTools={props.canUseDesktopTools}
                accessHint={props.skillsAccessHint}
                refreshSkills={props.refreshSkills}
                skills={props.skills}
                skillsStatus={props.skillsStatus}
                importLocalSkill={props.importLocalSkill}
                installSkillCreator={props.installSkillCreator}
                revealSkillsFolder={props.revealSkillsFolder}
                uninstallSkill={props.uninstallSkill}
              />
            </Match>

            <Match when={props.tab === "plugins"}>
              <PluginsView
                busy={props.busy}
                activeWorkspaceRoot={props.activeWorkspaceRoot}
                canEditPlugins={props.canEditPlugins}
                canUseGlobalScope={props.canUseGlobalPluginScope}
                accessHint={props.pluginsAccessHint}
                pluginScope={props.pluginScope}
                setPluginScope={props.setPluginScope}
                pluginConfigPath={props.pluginConfigPath}
                pluginList={props.pluginList}
                pluginInput={props.pluginInput}
                setPluginInput={props.setPluginInput}
                pluginStatus={props.pluginStatus}
                activePluginGuide={props.activePluginGuide}
                setActivePluginGuide={props.setActivePluginGuide}
                isPluginInstalled={props.isPluginInstalled}
                suggestedPlugins={props.suggestedPlugins}
                refreshPlugins={props.refreshPlugins}
                addPlugin={props.addPlugin}
              />
            </Match>

            <Match when={props.tab === "mcp"}>
              <McpView
                busy={props.busy}
                activeWorkspaceRoot={props.activeWorkspaceRoot}
                mcpServers={props.mcpServers}
                mcpStatus={props.mcpStatus}
                mcpLastUpdatedAt={props.mcpLastUpdatedAt}
                mcpStatuses={props.mcpStatuses}
                mcpConnectingName={props.mcpConnectingName}
                selectedMcp={props.selectedMcp}
                setSelectedMcp={props.setSelectedMcp}
                quickConnect={props.quickConnect}
                connectMcp={props.connectMcp}
                showMcpReloadBanner={props.showMcpReloadBanner}
                reloadBlocked={props.mcpReloadBlocked}
                reloadMcpEngine={props.reloadMcpEngine}
              />
            </Match>

            <Match when={props.tab === "settings"}>
                <SettingsView
                  startupPreference={props.startupPreference}
                  baseUrl={props.baseUrl}
                  headerStatus={props.headerStatus}
                  busy={props.busy}
                  settingsTab={props.settingsTab}
                  setSettingsTab={props.setSettingsTab}
                  providers={props.providers}
                  providerConnectedIds={props.providerConnectedIds}
                  providerAuthBusy={props.providerAuthBusy}
                  openProviderAuthModal={props.openProviderAuthModal}
                  openworkServerStatus={props.openworkServerStatus}
                  openworkServerUrl={props.openworkServerUrl}
                  openworkServerSettings={props.openworkServerSettings}
                  openworkServerHostInfo={props.openworkServerHostInfo}
                  openworkServerCapabilities={props.openworkServerCapabilities}
                  openworkServerDiagnostics={props.openworkServerDiagnostics}
                  openworkServerWorkspaceId={props.openworkServerWorkspaceId}
                  clientConnected={props.clientConnected}
                  canReloadWorkspace={props.canReloadWorkspace}
                  reloadWorkspaceEngine={props.reloadWorkspaceEngine}
                  reloadBusy={props.reloadBusy}
                  reloadError={props.reloadError}
                  openworkAuditEntries={props.openworkAuditEntries}
                  openworkAuditStatus={props.openworkAuditStatus}
                  openworkAuditError={props.openworkAuditError}
                  opencodeConnectStatus={props.opencodeConnectStatus}
                  engineInfo={props.engineInfo}
                  openwrkStatus={props.openwrkStatus}
                  owpenbotInfo={props.owpenbotInfo}
                  engineDoctorVersion={props.engineDoctorVersion}
                  updateOpenworkServerSettings={props.updateOpenworkServerSettings}
                  resetOpenworkServerSettings={props.resetOpenworkServerSettings}
                  testOpenworkServerConnection={props.testOpenworkServerConnection}
                  developerMode={props.developerMode}
                  toggleDeveloperMode={props.toggleDeveloperMode}
                  stopHost={props.stopHost}
                  engineSource={props.engineSource}
                  setEngineSource={props.setEngineSource}
                  engineRuntime={props.engineRuntime}
                  setEngineRuntime={props.setEngineRuntime}
                  isWindows={props.isWindows}
                  defaultModelLabel={props.defaultModelLabel}
                  defaultModelRef={props.defaultModelRef}
                  openDefaultModelPicker={props.openDefaultModelPicker}
                  showThinking={props.showThinking}
                  toggleShowThinking={props.toggleShowThinking}
                  modelVariantLabel={props.modelVariantLabel}
                  editModelVariant={props.editModelVariant}
                  updateAutoCheck={props.updateAutoCheck}
                  toggleUpdateAutoCheck={props.toggleUpdateAutoCheck}
                  themeMode={props.themeMode}
                  setThemeMode={props.setThemeMode}
                  updateStatus={props.updateStatus}
                  updateEnv={props.updateEnv}
                  appVersion={props.appVersion}
                  checkForUpdates={props.checkForUpdates}
                  downloadUpdate={props.downloadUpdate}
                  installUpdateAndRestart={props.installUpdateAndRestart}
                  anyActiveRuns={props.anyActiveRuns}
                  onResetStartupPreference={props.onResetStartupPreference}
                  openResetModal={props.openResetModal}
                  resetModalBusy={props.resetModalBusy}
                  pendingPermissions={props.pendingPermissions}
                  events={props.events}
                  safeStringify={props.safeStringify}
                  repairOpencodeCache={props.repairOpencodeCache}
                  cacheRepairBusy={props.cacheRepairBusy}
                  cacheRepairResult={props.cacheRepairResult}
                  notionStatus={props.notionStatus}
                  notionStatusDetail={props.notionStatusDetail}
                  notionError={props.notionError}
                  notionBusy={props.notionBusy}
                  connectNotion={props.connectNotion}
                />

            </Match>
          </Switch>
        </div>

        <Show when={props.error}>
          <div class="mx-auto max-w-5xl px-6 md:px-10 pb-24 md:pb-10">
            <div class="rounded-2xl bg-red-1/40 px-5 py-4 text-sm text-red-12 border border-red-7/20 space-y-3">
              <div>{props.error}</div>
              <Show when={props.developerMode}>
                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    class="text-xs h-8 py-0 px-3"
                    onClick={props.repairOpencodeCache}
                    disabled={props.cacheRepairBusy || !props.developerMode}
                  >
                    {props.cacheRepairBusy ? "Repairing cache" : "Repair cache"}
                  </Button>
                  <Button
                    variant="outline"
                    class="text-xs h-8 py-0 px-3"
                    onClick={props.stopHost}
                    disabled={props.busy}
                  >
                    Retry
                  </Button>
                  <Show when={props.cacheRepairResult}>
                    <span class="text-xs text-red-12/80">
                      {props.cacheRepairResult}
                    </span>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </Show>

        <ProviderAuthModal
          open={props.providerAuthModalOpen}
          loading={props.providerAuthBusy}
          submitting={providerAuthActionBusy()}
          error={props.providerAuthError}
          providers={props.providers}
          connectedProviderIds={props.providerConnectedIds}
          authMethods={props.providerAuthMethods}
          onSelect={handleProviderAuthSelect}
          onSubmitApiKey={handleProviderAuthApiKey}
          onClose={props.closeProviderAuthModal}
        />

        <div class="fixed bottom-0 left-0 right-0">
          <StatusBar
            clientConnected={props.clientConnected}
            openworkServerStatus={props.openworkServerStatus}
            developerMode={props.developerMode}
            onOpenSettings={() => openSettings("general")}
            onOpenMessaging={() => openSettings("messaging")}
            onOpenProviders={() => props.openProviderAuthModal()}
            onOpenMcp={() => props.setTab("mcp")}
            providerConnectedIds={props.providerConnectedIds}
            mcpStatuses={props.mcpStatuses}
          />
          <nav class="md:hidden border-t border-dls-border bg-dls-surface">
            <div class="mx-auto max-w-5xl px-4 py-3 grid grid-cols-3 gap-2">
              <button
                class={`flex flex-col items-center gap-1 text-xs ${
                  props.tab === "scheduled" ? "text-gray-12" : "text-gray-10"
                }`}
                onClick={() => props.setTab("scheduled")}
              >
                <History size={18} />
                Automations
              </button>
              <button
                class={`flex flex-col items-center gap-1 text-xs ${
                  props.tab === "skills" ? "text-gray-12" : "text-gray-10"
                }`}
                onClick={() => props.setTab("skills")}
              >
                <Zap size={18} />
                Skills
              </button>
              <button
                class={`flex flex-col items-center gap-1 text-xs ${
                  props.tab === "mcp" ? "text-gray-12" : "text-gray-10"
                }`}
                onClick={() => props.setTab("mcp")}
              >
                <Box size={18} />
                Apps
              </button>
            </div>
          </nav>
        </div>
      </main>
    </div>
  );
}
