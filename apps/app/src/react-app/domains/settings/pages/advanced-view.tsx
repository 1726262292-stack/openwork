/** @jsxImportSource react */
import { useReducer } from "react";

import { Separator } from "@/components/ui/separator";

import type { OpencodeConnectStatus } from "@/app/types";
import type { OpenworkServerStatus } from "@/app/lib/openwork-server";
import { t } from "@/i18n";
import { LayoutStack } from "../settings-layout";

import { advancedLocalReducer, initialAdvancedLocalState } from "./advanced-view-state";
import {
  AdvancedDeveloperSection,
  AdvancedRuntimeMigrationSection,
  AdvancedRuntimeSection,
} from "./advanced-view-sections";

export type AdvancedViewProps = {
  busy: boolean;
  clientConnected: boolean;
  opencodeConnectStatus: OpencodeConnectStatus | null;
  openworkServerStatus: OpenworkServerStatus;
  developerMode: boolean;
  toggleDeveloperMode: () => void;
  opencodeDevModeEnabled: boolean;
  openDebugDeepLink: (rawUrl: string) => Promise<{ ok: boolean; message: string }>;
  canMigrateRuntimeConfig: boolean;
  migrateRuntimeConfig: () => Promise<{ migrated: boolean; keys: string[] }>;
};

type AdvancedStatusTone = "ready" | "warning" | "error" | "neutral";

export function AdvancedView(props: AdvancedViewProps) {
  const [localState, dispatchLocal] = useReducer(
    advancedLocalReducer,
    initialAdvancedLocalState,
  );
  const {
    deepLinkOpen: debugDeepLinkOpen,
    deepLinkInput: debugDeepLinkInput,
    deepLinkBusy: debugDeepLinkBusy,
    deepLinkStatus: debugDeepLinkStatus,
    migrationBusy,
    migrationStatus,
  } = localState;

  const clientStatusLabel = (() => {
    const status = props.opencodeConnectStatus?.status;
    if (status === "connecting") return t("status.connecting");
    if (status === "error") return t("settings.connection_failed");
    return props.clientConnected ? t("status.connected") : t("config.status_not_connected");
  })();

  const clientTone: AdvancedStatusTone = (() => {
    const status = props.opencodeConnectStatus?.status;
    if (status === "connecting") return "warning";
    if (status === "error") return "error";
    return props.clientConnected ? "ready" : "neutral";
  })();

  const openworkStatusLabel = (() => {
    switch (props.openworkServerStatus) {
      case "connected":
        return t("config.status_connected");
      case "limited":
        return t("config.status_limited");
      default:
        return t("config.status_not_connected");
    }
  })();

  const openworkTone: AdvancedStatusTone = (() => {
    switch (props.openworkServerStatus) {
      case "connected":
        return "ready";
      case "limited":
        return "warning";
      default:
        return "neutral";
    }
  })();

  const submitDebugDeepLink = async () => {
    const rawUrl = debugDeepLinkInput.trim();
    if (!rawUrl || props.busy || debugDeepLinkBusy) return;
    dispatchLocal({ type: "deepLinkStart" });
    try {
      const result = await props.openDebugDeepLink(rawUrl);
      if (result.ok) {
        dispatchLocal({ type: "deepLinkSuccess", status: result.message });
      } else {
        dispatchLocal({ type: "deepLinkStatus", status: result.message });
      }
    } catch (error) {
      dispatchLocal({
        type: "deepLinkStatus",
        status: error instanceof Error ? error.message : t("settings.open_deeplink_failed"),
      });
    } finally {
      dispatchLocal({ type: "deepLinkDone" });
    }
  };

  const migrateRuntimeConfig = async () => {
    if (props.busy || migrationBusy || !props.canMigrateRuntimeConfig) return;
    dispatchLocal({ type: "migrationStart" });
    try {
      const result = await props.migrateRuntimeConfig();
      dispatchLocal({
        type: "migrationStatus",
        status: result.migrated
          ? `Migrated legacy runtime config: ${result.keys.join(", ")}.`
          : "No legacy runtime config found for this workspace.",
      });
    } catch (error) {
      dispatchLocal({
        type: "migrationStatus",
        status: error instanceof Error ? error.message : "Failed to migrate legacy runtime config.",
      });
    } finally {
      dispatchLocal({ type: "migrationDone" });
    }
  };

  return (
    <LayoutStack>
      <AdvancedRuntimeSection
        clientStatusLabel={clientStatusLabel}
        clientTone={clientTone}
        openworkStatusLabel={openworkStatusLabel}
        openworkTone={openworkTone}
      />

      <AdvancedRuntimeMigrationSection
        busy={props.busy}
        canMigrate={props.canMigrateRuntimeConfig}
        migrationBusy={migrationBusy}
        migrationStatus={migrationStatus}
        onMigrate={migrateRuntimeConfig}
      />

      <AdvancedDeveloperSection
        busy={props.busy}
        developerMode={props.developerMode}
        opencodeDevModeEnabled={props.opencodeDevModeEnabled}
        deepLinkOpen={debugDeepLinkOpen}
        deepLinkInput={debugDeepLinkInput}
        deepLinkBusy={debugDeepLinkBusy}
        deepLinkStatus={debugDeepLinkStatus}
        onToggleDeveloperMode={props.toggleDeveloperMode}
        onToggleDeepLink={() => dispatchLocal({ type: "toggleDeepLink" })}
        onDeepLinkInput={(input) => dispatchLocal({ type: "deepLinkInput", input })}
        onSubmitDeepLink={submitDebugDeepLink}
      />
    </LayoutStack>
  );
}
