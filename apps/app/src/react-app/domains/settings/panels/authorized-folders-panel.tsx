/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useReducer, type SetStateAction } from "react";
import { Folder, FolderLock, FolderSearch, X } from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "../../../design-system/button";
import type {
  OpenworkServerCapabilities,
  OpenworkServerClient,
  OpenworkServerStatus,
} from "../../../../app/lib/openwork-server";
import { pickDirectory } from "../../../../app/lib/desktop";
import {
  isDesktopRuntime,
  safeStringify,
} from "../../../../app/utils";
import {
  authorizedFoldersReducer,
  buildAuthorizedFoldersStatus,
  ensureRecord,
  initialAuthorizedFoldersState,
  mergeAuthorizedFoldersIntoExternalDirectory,
  normalizeAuthorizedFolderPath,
  readAuthorizedFoldersFromConfig,
  type AuthorizedFoldersState,
} from "./authorized-folders-panel-state";
import {
  SettingsSection,
  SettingsSectionHeader,
  SettingsSectionHeaderContent,
  SettingsSectionHeaderTitle,
  SettingsSectionHeaderDescription,
  SettingsInset,
  SettingsNotice,
} from "../settings-section";

export type AuthorizedFoldersPanelProps = {
  openworkServerClient: OpenworkServerClient | null;
  openworkServerStatus: OpenworkServerStatus;
  openworkServerCapabilities: OpenworkServerCapabilities | null;
  runtimeWorkspaceId: string | null;
  selectedWorkspaceRoot: string;
  activeWorkspaceType: "local" | "remote";
  onConfigUpdated: () => void;
};

export function AuthorizedFoldersPanel(props: AuthorizedFoldersPanelProps) {
  const [folderState, dispatchFolderState] = useReducer(
    authorizedFoldersReducer,
    initialAuthorizedFoldersState,
  );
  const {
    folders: authorizedFolders,
    draft: authorizedFolderDraft,
    loading: authorizedFoldersLoading,
    saving: authorizedFoldersSaving,
    status: authorizedFoldersStatus,
    error: authorizedFoldersError,
  } = folderState;
  const setFolderState = <K extends keyof AuthorizedFoldersState>(
    key: K,
    value: SetStateAction<AuthorizedFoldersState[K]>,
  ) => dispatchFolderState({ type: "set", key, value });
  const setAuthorizedFolders = (value: SetStateAction<string[]>) => setFolderState("folders", value);
  const setAuthorizedFolderDraft = (value: SetStateAction<string>) => setFolderState("draft", value);
  const setAuthorizedFoldersSaving = (value: SetStateAction<boolean>) => setFolderState("saving", value);
  const setAuthorizedFoldersStatus = (value: SetStateAction<string | null>) => setFolderState("status", value);
  const setAuthorizedFoldersError = (value: SetStateAction<string | null>) => setFolderState("error", value);

  const openworkServerReady = props.openworkServerStatus === "connected";
  const openworkServerWorkspaceReady = Boolean(props.runtimeWorkspaceId);
  const canReadConfig =
    openworkServerReady &&
    openworkServerWorkspaceReady &&
    (props.openworkServerCapabilities?.config?.read ?? false);
  const canWriteConfig =
    openworkServerReady &&
    openworkServerWorkspaceReady &&
    (props.openworkServerCapabilities?.config?.write ?? false);

  const authorizedFoldersHint = useMemo(() => {
    if (!openworkServerReady) return t("context_panel.server_disconnected");
    if (!openworkServerWorkspaceReady) return t("context_panel.no_server_workspace");
    if (!canReadConfig) return t("context_panel.config_access_unavailable");
    if (!canWriteConfig) return t("context_panel.config_read_only");
    return null;
  }, [canReadConfig, canWriteConfig, openworkServerReady, openworkServerWorkspaceReady]);

  const canPickAuthorizedFolder =
    isDesktopRuntime() && canWriteConfig && props.activeWorkspaceType === "local";
  const workspaceRootFolder = props.selectedWorkspaceRoot.trim();
  const visibleAuthorizedFolders = useMemo(() => {
    const root = workspaceRootFolder;
    return root ? [root, ...authorizedFolders] : authorizedFolders;
  }, [authorizedFolders, workspaceRootFolder]);

  useEffect(() => {
    const openworkClient = props.openworkServerClient;
    const openworkWorkspaceId = props.runtimeWorkspaceId;

    if (!openworkClient || !openworkWorkspaceId || !canReadConfig) {
      dispatchFolderState({ type: "reset" });
      return;
    }

    let cancelled = false;
    dispatchFolderState({ type: "loadStart" });

    void (async () => {
      try {
        const config = await openworkClient.getConfig(openworkWorkspaceId);
        if (cancelled) return;
        const next = readAuthorizedFoldersFromConfig(ensureRecord(config.opencode));
        dispatchFolderState({
          type: "loadSuccess",
          folders: next.folders,
          status: buildAuthorizedFoldersStatus(Object.keys(next.hiddenEntries).length),
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : safeStringify(error);
        dispatchFolderState({ type: "loadError", message });
      } finally {
        if (!cancelled) dispatchFolderState({ type: "loadDone" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canReadConfig, props.openworkServerClient, props.runtimeWorkspaceId]);

  const persistAuthorizedFolders = useCallback(async (nextFolders: string[]) => {
    const openworkClient = props.openworkServerClient;
    const openworkWorkspaceId = props.runtimeWorkspaceId;
    if (!openworkClient || !openworkWorkspaceId || !canWriteConfig) {
      setAuthorizedFoldersError(t("context_panel.writable_workspace_required"));
      return false;
    }

    setAuthorizedFoldersSaving(true);
    setAuthorizedFoldersError(null);
    setAuthorizedFoldersStatus(t("context_panel.saving_folders"));

    try {
      const currentConfig = await openworkClient.getConfig(openworkWorkspaceId);
      const currentAuthorizedFolders = readAuthorizedFoldersFromConfig(
        ensureRecord(currentConfig.opencode),
      );
      const nextExternalDirectory = mergeAuthorizedFoldersIntoExternalDirectory(
        nextFolders,
        currentAuthorizedFolders.hiddenEntries,
      );

      await openworkClient.patchConfig(openworkWorkspaceId, {
        opencode: {
          permission: {
            external_directory: nextExternalDirectory,
          },
        },
      });
      setAuthorizedFolders(nextFolders);
      setAuthorizedFoldersStatus(
        buildAuthorizedFoldersStatus(
          Object.keys(currentAuthorizedFolders.hiddenEntries).length,
          t("context_panel.folders_updated"),
        ),
      );
      props.onConfigUpdated();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : safeStringify(error);
      setAuthorizedFoldersError(message);
      setAuthorizedFoldersStatus(null);
      return false;
    } finally {
      setAuthorizedFoldersSaving(false);
    }
  }, [canWriteConfig, props]);

  const addAuthorizedFolder = useCallback(async () => {
    const normalized = normalizeAuthorizedFolderPath(authorizedFolderDraft);
    const workspaceRoot = normalizeAuthorizedFolderPath(workspaceRootFolder);
    if (!normalized) return;
    if (workspaceRoot && normalized === workspaceRoot) {
      setAuthorizedFolderDraft("");
      setAuthorizedFoldersStatus(t("context_panel.workspace_root_available"));
      setAuthorizedFoldersError(null);
      return;
    }
    if (authorizedFolders.includes(normalized)) {
      setAuthorizedFolderDraft("");
      setAuthorizedFoldersStatus(t("context_panel.folder_already_authorized"));
      setAuthorizedFoldersError(null);
      return;
    }

    const ok = await persistAuthorizedFolders([...authorizedFolders, normalized]);
    if (ok) {
      setAuthorizedFolderDraft("");
    }
  }, [authorizedFolderDraft, authorizedFolders, persistAuthorizedFolders, workspaceRootFolder]);

  const removeAuthorizedFolder = useCallback(async (folder: string) => {
    const nextFolders = authorizedFolders.filter((entry) => entry !== folder);
    await persistAuthorizedFolders(nextFolders);
  }, [authorizedFolders, persistAuthorizedFolders]);

  const pickAuthorizedFolder = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    try {
      const selection = await pickDirectory({
        title: t("onboarding.authorize_folder"),
      });
      const folder =
        typeof selection === "string"
          ? selection
          : Array.isArray(selection)
            ? selection[0]
            : null;
      const normalized = normalizeAuthorizedFolderPath(folder);
      const workspaceRoot = normalizeAuthorizedFolderPath(workspaceRootFolder);
      if (!normalized) return;
      setAuthorizedFolderDraft(normalized);
      if (workspaceRoot && normalized === workspaceRoot) {
        setAuthorizedFolderDraft("");
        setAuthorizedFoldersStatus(t("context_panel.workspace_root_available"));
        setAuthorizedFoldersError(null);
        return;
      }
      if (authorizedFolders.includes(normalized)) {
        setAuthorizedFoldersStatus(t("context_panel.folder_already_authorized"));
        setAuthorizedFoldersError(null);
        return;
      }
      const ok = await persistAuthorizedFolders([...authorizedFolders, normalized]);
      if (ok) {
        setAuthorizedFolderDraft("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : safeStringify(error);
      setAuthorizedFoldersError(message);
    }
  }, [authorizedFolders, persistAuthorizedFolders, workspaceRootFolder]);

  return (
    <SettingsSection>
      <SettingsSectionHeader>
        <SettingsSectionHeaderContent>
          <SettingsSectionHeaderTitle>
            <FolderLock size={16} />
            {t("context_panel.authorized_folders")}
          </SettingsSectionHeaderTitle>
          <SettingsSectionHeaderDescription>
            {t("context_panel.authorized_folders_desc")}
          </SettingsSectionHeaderDescription>
        </SettingsSectionHeaderContent>
      </SettingsSectionHeader>

      {!canReadConfig ? (
        <SettingsNotice>
          {authorizedFoldersHint ?? t("context_panel.authorized_folders_no_access")}
        </SettingsNotice>
      ) : (
        <>
          {/* Folder list */}
          {visibleAuthorizedFolders.length > 0 ? (
            <div className="space-y-2">
              {visibleAuthorizedFolders.map((folder) => {
                const isWorkspaceRoot = folder === workspaceRootFolder;
                const folderName = folder.split(/[\/\\]/).filter(Boolean).pop() || folder;
                return (
                  <SettingsInset
                    key={folder}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Folder size={16} className="shrink-0 text-dls-secondary" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-dls-text">{folderName}</span>
                          {isWorkspaceRoot ? (
                            <span className="shrink-0 rounded-full border border-dls-border bg-dls-hover px-2 py-0.5 text-[10px] font-medium text-dls-secondary">
                              {t("context_panel.workspace_root_badge")}
                            </span>
                          ) : null}
                        </div>
                        <span className="truncate font-mono text-[10px] text-muted-foreground">{folder}</span>
                      </div>
                    </div>
                    {!isWorkspaceRoot ? (
                      <Button
                        variant="ghost"
                        className="size-7 shrink-0 !rounded-full !p-0 text-muted-foreground hover:text-red-11"
                        onClick={() => void removeAuthorizedFolder(folder)}
                        disabled={authorizedFoldersLoading || authorizedFoldersSaving || !canWriteConfig}
                        aria-label={t("context_panel.remove_folder", undefined, { name: folderName })}
                      >
                        <X size={14} />
                      </Button>
                    ) : (
                      <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                        {t("context_panel.always_available")}
                      </span>
                    )}
                  </SettingsInset>
                );
              })}
            </div>
          ) : (
            <SettingsInset className="flex flex-col items-center justify-center py-8 text-center">
              <Folder size={20} className="mb-2 text-muted-foreground" />
              <div className="text-sm font-medium text-dls-text">{t("context_panel.no_external_folders")}</div>
              <div className="mt-1 max-w-[40ch] text-[11px] text-muted-foreground">
                {t("context_panel.add_folder_hint")}
              </div>
            </SettingsInset>
          )}

          {/* Status / error */}
          {authorizedFoldersStatus ? (
            <SettingsNotice>{authorizedFoldersStatus}</SettingsNotice>
          ) : null}
          {authorizedFoldersError ? (
            <SettingsNotice tone="error">{authorizedFoldersError}</SettingsNotice>
          ) : null}

          {/* Input row */}
          <SettingsInset className="flex items-center gap-2 px-3 py-2.5">
            <input
              className="flex-1 rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.2)] disabled:opacity-50"
              value={authorizedFolderDraft}
              onChange={(event) => setAuthorizedFolderDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && authorizedFolderDraft.trim()) {
                  void addAuthorizedFolder();
                }
              }}
              placeholder={t("context_panel.input_placeholder")}
              disabled={authorizedFoldersLoading || authorizedFoldersSaving || !canWriteConfig}
            />
            {canPickAuthorizedFolder ? (
              <Button
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={() => void pickAuthorizedFolder()}
                disabled={authorizedFoldersLoading || authorizedFoldersSaving || !canWriteConfig}
              >
                <FolderSearch size={13} className="mr-1.5" />
                {t("context_panel.browse_button")}
              </Button>
            ) : null}
            <Button
              variant="primary"
              className="h-8 px-3 text-xs"
              onClick={() => void addAuthorizedFolder()}
              disabled={authorizedFoldersLoading || authorizedFoldersSaving || !canWriteConfig || !authorizedFolderDraft.trim()}
            >
              {authorizedFoldersSaving ? t("context_panel.adding_button") : t("context_panel.add_button")}
            </Button>
          </SettingsInset>
        </>
      )}
    </SettingsSection>
  );
}
