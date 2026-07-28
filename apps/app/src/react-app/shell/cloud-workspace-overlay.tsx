/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { clearDenSession, createDenClient, readDenSettings } from "@/app/lib/den";
import { isOpenworkGatewayRuntime } from "@/app/lib/gateway-runtime";
import { denSettingsChangedEvent } from "@/app/lib/den-session-events";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import { mapCloudWorkspaceState } from "./cloud-workspace-status";
import type { DenCloudInstance } from "@/app/lib/den";

const readDenSettingsSnapshot = () => {
  const settings = readDenSettings();
  return JSON.stringify({
    baseUrl: settings.baseUrl,
    authToken: settings.authToken ?? "",
    activeOrgId: settings.activeOrgId ?? "",
  });
};

function subscribeToDenSettings(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(denSettingsChangedEvent, onStoreChange);
  return () => window.removeEventListener(denSettingsChangedEvent, onStoreChange);
}

function CloudWorkspaceOverlayInner() {
  const denAuth = useDenAuth();
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState<DenCloudInstance | null>(null);
  const [requestFailed, setRequestFailed] = useState(false);
  const [updating, setUpdating] = useState(false);
  const settingsSnapshot = useSyncExternalStore(
    subscribeToDenSettings,
    readDenSettingsSnapshot,
    readDenSettingsSnapshot,
  );
  const settings = useMemo(() => readDenSettings(), [settingsSnapshot]);
  const authToken = settings.authToken?.trim() ?? "";
  const orgId = settings.activeOrgId?.trim() ?? "";
  const denClient = useMemo(
    () => createDenClient({ baseUrl: settings.baseUrl, token: authToken }),
    [authToken, settings.baseUrl],
  );

  const refresh = useCallback(async () => {
    if (!authToken || !orgId) {
      setRequestFailed(true);
      return;
    }

    try {
      const next = await denClient.getCloudInstance(orgId);
      setInstance(next);
      setRequestFailed(false);
    } catch {
      setRequestFailed(true);
    }
  }, [authToken, denClient, orgId]);

  const viewModel = mapCloudWorkspaceState({ instance, updating, requestFailed });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!authToken || !orgId) return;
    const timeoutId = window.setTimeout(() => {
      void refresh();
    }, viewModel.pollMs);
    return () => window.clearTimeout(timeoutId);
  }, [authToken, instance, orgId, refresh, requestFailed, updating, viewModel.pollMs]);

  useEffect(() => {
    if (!updating) return;
    const nextModel = mapCloudWorkspaceState({ instance, updating: false, requestFailed });
    if (instance?.status === "ready" && !nextModel.updateAvailable) {
      setUpdating(false);
    }
  }, [instance, requestFailed, updating]);

  const signOut = useCallback(() => {
    if (authToken) {
      void denClient.signOut().catch(() => undefined);
    }
    clearDenSession();
    void denAuth.refresh();
    setOpen(false);
  }, [authToken, denAuth, denClient]);

  const updateNow = useCallback(() => {
    if (!orgId || updating) return;
    setUpdating(true);
    setRequestFailed(false);
    void denClient
      .updateCloudInstance(orgId)
      .then((result) => {
        if (!result.ok) {
          setUpdating(false);
          setRequestFailed(result.error === "flush_failed");
        }
        void refresh();
      })
      .catch(() => {
        setUpdating(false);
        setRequestFailed(true);
      });
  }, [denClient, orgId, refresh, updating]);

  if (!denAuth.isSignedIn && !authToken) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100]">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="cloud-workspace-pill"
              data-cloud-workspace-state={viewModel.variant}
              className={cn(
                "h-8 rounded-full border bg-popover/90 px-3 text-xs shadow-sm backdrop-blur-sm",
                viewModel.tone === "amber"
                  ? "border-amber-7/70 bg-amber-3 text-amber-12 hover:bg-amber-4"
                  : "border-border/80 text-muted-foreground hover:text-foreground",
              )}
              aria-label={`Open cloud workspace status: ${viewModel.label}`}
            >
              {viewModel.label}
            </Button>
          }
        />
        <PopoverContent align="end" side="top" sideOffset={8} className="w-80 gap-3 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium" data-testid="cloud-workspace-status-line">
              {viewModel.statusLine}
            </p>
            <p className="text-xs text-muted-foreground">{viewModel.versionLine}</p>
            <p className="text-xs text-muted-foreground">{viewModel.latestLine}</p>
            <p className="text-xs text-muted-foreground">{viewModel.backupsLine}</p>
          </div>
          {viewModel.showUpdate ? (
            <div className="rounded-2xl border border-border bg-muted/30 p-3">
              <Button type="button" size="sm" className="w-full" onClick={updateNow} disabled={updating}>
                Update now
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Takes about 30 seconds. Your files and sessions come along.
              </p>
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            {viewModel.showRetry ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function CloudWorkspaceOverlay() {
  if (!isOpenworkGatewayRuntime()) return null;
  return <CloudWorkspaceOverlayInner />;
}
