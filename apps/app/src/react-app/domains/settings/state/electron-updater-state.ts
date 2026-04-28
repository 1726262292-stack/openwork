/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";

import type { ReleaseChannel } from "../../../../app/types";
import { isElectronRuntime, safeStringify } from "../../../../app/utils";

export type SettingsUpdateStatus = {
  state: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  lastCheckedAt?: number | null;
  version?: string;
  date?: string;
  notes?: string;
  totalBytes?: number | null;
  downloadedBytes?: number;
  message?: string;
} | null;

type ElectronUpdaterBridge = NonNullable<Window["__OPENWORK_ELECTRON__"]>["updater"];

type UseElectronUpdaterStateOptions = {
  releaseChannel: ReleaseChannel;
  onReleaseChannelChange: (next: ReleaseChannel) => void;
  updateAutoDownload: boolean;
  setError: (message: string | null) => void;
};

function electronUpdaterBridge(): ElectronUpdaterBridge | null {
  if (typeof window === "undefined") return null;
  return window.__OPENWORK_ELECTRON__?.updater ?? null;
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  const serialized = safeStringify(error);
  return serialized && serialized !== "{}" ? serialized : String(error);
}

function releaseNotesToText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && "note" in entry) {
          return String((entry as { note?: unknown }).note ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n") || undefined;
  }
  return undefined;
}

export function useElectronUpdaterState(options: UseElectronUpdaterStateOptions) {
  const { releaseChannel, onReleaseChannelChange, updateAutoDownload, setError } = options;
  const [updateStatus, setUpdateStatus] = useState<SettingsUpdateStatus>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateEnv, setUpdateEnv] = useState<{ supported?: boolean; reason?: string | null } | null>(null);

  useEffect(() => {
    if (!isElectronRuntime()) return;
    const bridge = electronUpdaterBridge();
    if (!bridge?.getChannel) {
      setUpdateEnv({ supported: false, reason: "Electron updater bridge is unavailable." });
      return;
    }
    let cancelled = false;
    void bridge
      .getChannel()
      .then((state) => {
        if (cancelled) return;
        setAppVersion(state.currentVersion ?? null);
        if (state.channel && state.channel !== releaseChannel) {
          onReleaseChannelChange(state.channel);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUpdateEnv({ supported: false, reason: "Electron updater bridge is unavailable." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onReleaseChannelChange, releaseChannel]);

  const downloadUpdate = useCallback(async () => {
    const bridge = electronUpdaterBridge();
    if (!bridge?.download) {
      const message = "Electron updater downloads are available only in the Electron desktop app.";
      setUpdateStatus({ state: "error", message });
      setError(message);
      return;
    }

    setUpdateStatus((current) => ({
      ...(current ?? {}),
      state: "downloading",
      downloadedBytes: current?.downloadedBytes ?? 0,
      totalBytes: current?.totalBytes ?? null,
    }));
    const result = await bridge.download();
    if (!result?.ok) {
      setUpdateStatus({ state: "error", message: result?.reason ?? "Update download failed." });
      return;
    }
    setUpdateStatus((current) => ({
      ...(current ?? {}),
      state: "ready",
    }));
  }, [setError]);

  const checkForUpdates = useCallback(async () => {
    const bridge = electronUpdaterBridge();
    if (!bridge?.check) {
      const message = "Electron update checks are available only in the Electron desktop app.";
      setUpdateStatus({ state: "error", message });
      setError(message);
      return;
    }

    setUpdateStatus({ state: "checking" });
    try {
      const result = await bridge.check();
      setAppVersion(result.currentVersion ?? null);
      if (result.channel && result.channel !== releaseChannel) {
        onReleaseChannelChange(result.channel);
      }
      if (result.reason === "unavailable") {
        setUpdateStatus({
          state: "error",
          message: "Electron updater is available only in packaged Electron builds.",
        });
        return;
      }
      if (result.reason) {
        setUpdateStatus({ state: "error", message: result.reason });
        return;
      }

      const nextStatus: Exclude<SettingsUpdateStatus, null> = result.available
        ? {
            state: "available",
            lastCheckedAt: Date.now(),
            version: result.latestVersion ?? undefined,
            date: result.releaseDate ?? undefined,
            notes: releaseNotesToText(result.releaseNotes),
          }
        : {
            state: "idle",
            lastCheckedAt: Date.now(),
            version: result.latestVersion ?? undefined,
            date: result.releaseDate ?? undefined,
            notes: releaseNotesToText(result.releaseNotes),
          };
      setUpdateStatus(nextStatus);
      if (result.available && updateAutoDownload) {
        await downloadUpdate();
      }
    } catch (error) {
      setUpdateStatus({ state: "error", message: describeError(error) });
    }
  }, [downloadUpdate, onReleaseChannelChange, releaseChannel, setError, updateAutoDownload]);

  const installUpdateAndRestart = useCallback(async () => {
    const bridge = electronUpdaterBridge();
    if (!bridge?.installAndRestart) {
      const message = "Electron update install is available only in the Electron desktop app.";
      setUpdateStatus({ state: "error", message });
      setError(message);
      return;
    }
    const result = await bridge.installAndRestart();
    if (!result?.ok) {
      setUpdateStatus({ state: "error", message: result?.reason ?? "Update install failed." });
    }
  }, [setError]);

  const setReleaseChannel = useCallback(
    async (next: ReleaseChannel) => {
      onReleaseChannelChange(next);
      const bridge = electronUpdaterBridge();
      if (!bridge?.setChannel) return;
      try {
        const state = await bridge.setChannel(next);
        setAppVersion(state.currentVersion ?? null);
        if (state.channel && state.channel !== next) {
          onReleaseChannelChange(state.channel);
        }
        setUpdateStatus({ state: "idle", lastCheckedAt: null });
      } catch (error) {
        setUpdateStatus({ state: "error", message: describeError(error) });
      }
    },
    [onReleaseChannelChange],
  );

  return {
    appVersion,
    updateEnv,
    updateStatus,
    checkForUpdates,
    downloadUpdate,
    installUpdateAndRestart,
    setReleaseChannel,
  };
}
