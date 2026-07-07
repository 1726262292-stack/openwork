/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";

import type { DenExternalMcpConnection, DenOrgPlugin } from "@/app/lib/den";
import { readDenSettings } from "@/app/lib/den";
import { openDesktopUrl } from "@/app/lib/desktop";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { DenSignInSurface } from "@/react-app/domains/cloud/den-signin-surface";
import { useDenAuth, type DenAuthStatus } from "@/react-app/domains/cloud/den-auth-provider";
import {
  resolveOrgMcpConnectionCardState,
  useOrgMcpConnections,
} from "@/react-app/domains/connections/use-org-mcp-connections";
import { resolveMarketplaceDeliveryAction } from "@/react-app/domains/settings/connect-delivery";
import type { ExtensionItem } from "@/react-app/domains/settings/extension-items";
import { useConnectEnabled, useDesktopConfig } from "@/react-app/domains/cloud/desktop-config-provider";
import { ExtensionCard } from "@/react-app/design-system/extension-card";
import { useCloudSession } from "../cloud/cloud-session-provider";
import type { useDenSession } from "../cloud/use-den-session";
import {
  SettingsInset,
  SettingsNotice,
  SettingsSection,
  SettingsSectionHeader,
  SettingsSectionHeaderContent,
  SettingsSectionHeaderDescription,
  SettingsSectionHeaderTitle,
  SettingsStack,
} from "../settings-section";

export type ConnectViewState = "loading" | "signin" | "active" | "pitch";

export function resolveConnectViewState(input: {
  authStatus: DenAuthStatus;
  connectEnabled?: boolean;
  connectionsCount: number;
}): ConnectViewState {
  if (input.authStatus === "checking") return "loading";
  if (input.authStatus === "signed_out") return "signin";
  if (input.connectEnabled === true || input.connectionsCount > 0) return "active";
  return "pitch";
}

type ConnectSession = Pick<
  ReturnType<typeof useDenSession>,
  | "authBusy"
  | "authError"
  | "baseUrlDraft"
  | "baseUrlError"
  | "sessionBusy"
  | "onApplyBaseUrl"
  | "onBaseUrlDraftChange"
  | "onClearAuthError"
  | "onOpenBrowserAuth"
  | "onOpenControlPlane"
  | "onResetBaseUrl"
  | "onSubmitManualAuth"
>;

export type ConnectViewProps = {
  developerMode: boolean;
  session: ConnectSession;
  marketplaceItems?: ExtensionItem[];
  refreshMarketplaceItems?: () => Promise<unknown> | void;
};

type CloudMarketplaceItem = ExtensionItem & { plugin: DenOrgPlugin };

function denManageConnectionsUrl() {
  return new URL("/dashboard/mcp-connections", readDenSettings().baseUrl).toString();
}

function ManageInDenButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-fit"
      onClick={() => void openDesktopUrl(denManageConnectionsUrl())}
    >
      {t("connect.manage_in_den_web")}
      <ArrowUpRight size={13} />
    </Button>
  );
}

function ConnectIntro() {
  return (
    <SettingsSection>
      <SettingsSectionHeader>
        <SettingsSectionHeaderContent>
          <SettingsSectionHeaderTitle>{t("connect.header_title")}</SettingsSectionHeaderTitle>
          <SettingsSectionHeaderDescription>
            {t("connect.header_description")}
          </SettingsSectionHeaderDescription>
        </SettingsSectionHeaderContent>
      </SettingsSectionHeader>
    </SettingsSection>
  );
}

function ConnectLoadingPanel() {
  return (
    <SettingsSection>
      <SettingsNotice>{t("connect.loading")}</SettingsNotice>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </SettingsSection>
  );
}

function ConnectSignInPanel(props: ConnectViewProps) {
  const { baseUrl, statusMessage } = useCloudSession();
  const [manualAuthOpen, setManualAuthOpen] = useState(false);
  const [manualAuthInput, setManualAuthInput] = useState("");

  const submitManualAuth = async () => {
    const ok = await props.session.onSubmitManualAuth(manualAuthInput);
    if (!ok) return;
    setManualAuthInput("");
    setManualAuthOpen(false);
  };

  return (
    <DenSignInSurface
      variant="panel"
      developerMode={props.developerMode}
      baseUrl={baseUrl}
      baseUrlDraft={props.session.baseUrlDraft}
      baseUrlError={props.session.baseUrlError}
      statusMessage={statusMessage}
      authError={props.session.authError}
      authBusy={props.session.authBusy}
      baseUrlBusy={false}
      sessionBusy={props.session.sessionBusy}
      manualAuthOpen={manualAuthOpen}
      manualAuthInput={manualAuthInput}
      onBaseUrlDraftInput={props.session.onBaseUrlDraftChange}
      onResetBaseUrl={props.session.onResetBaseUrl}
      onApplyBaseUrl={props.session.onApplyBaseUrl}
      onOpenControlPlane={props.session.onOpenControlPlane}
      onOpenBrowserAuth={props.session.onOpenBrowserAuth}
      onToggleManualAuth={() => {
        props.session.onClearAuthError();
        setManualAuthOpen((current) => !current);
      }}
      onManualAuthInput={setManualAuthInput}
      onSubmitManualAuth={() => void submitManualAuth()}
    />
  );
}

function OrgConnectionCards(props: {
  connections: DenExternalMcpConnection[];
  connectingId: string | null;
  onConnect: (connectionId: string) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">
      {props.connections.map((connection) => {
        const state = resolveOrgMcpConnectionCardState(connection);
        const connecting = props.connectingId === connection.id;
        const canConnect = connection.credentialMode === "per_member" && !connection.connectedForMe;
        return (
          <div key={connection.id} data-testid="connect-org-mcp-card" data-connection-id={connection.id}>
            <ExtensionCard
              name={connection.name}
              description={t(state.descriptionKey)}
              kind="mcp"
              url={connection.url}
              connected={state.connected}
              connectedLabel={t(state.actionLabelKey)}
              beta
              connecting={connecting}
              actionLabel={connecting ? t("connect.waiting_for_browser") : t(state.actionLabelKey)}
              onClick={canConnect ? () => props.onConnect(connection.id) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

function isCloudMarketplaceItem(item: ExtensionItem): item is CloudMarketplaceItem {
  return Boolean(item.plugin);
}

function marketplaceResourceTypeLabel(type: string, count: number) {
  switch (type) {
    case "mcp":
      return t("connect.marketplace_resource_type_mcp", { count });
    case "skill":
      return t("connect.marketplace_resource_type_skill", { count });
    case "command":
      return t("connect.marketplace_resource_type_command", { count });
    case "tool":
      return t("connect.marketplace_resource_type_tool", { count });
    default:
      return type;
  }
}

function marketplaceResourceCountLabel(type: string, count: number) {
  return t("connect.marketplace_resource_count", {
    count,
    type: marketplaceResourceTypeLabel(type, count),
  });
}

function marketplaceResourceCounts(item: CloudMarketplaceItem) {
  const componentCounts = Object.entries(item.plugin.componentCounts).filter(([, count]) => count > 0);
  if (componentCounts.length > 0) {
    return componentCounts.map(([type, count]) => marketplaceResourceCountLabel(type, count));
  }

  const resourceCounts = new Map<string, number>();
  for (const resource of item.resources) {
    resourceCounts.set(resource.type, (resourceCounts.get(resource.type) ?? 0) + 1);
  }
  return [...resourceCounts.entries()].map(([type, count]) => marketplaceResourceCountLabel(type, count));
}

function ConnectMarketplaceCard(props: { item: CloudMarketplaceItem }) {
  const deliveryAction = resolveMarketplaceDeliveryAction({
    connectEnabled: true,
    importedLocally: Boolean(props.item.importedPlugin),
  });
  const localCopy = deliveryAction === "cloud_active_local_copy";
  const counts = marketplaceResourceCounts(props.item);
  const manifest = props.item.plugin.extension?.manifest;

  return (
    <div
      data-testid="connect-marketplace-plugin-card"
      className="rounded-xl border border-green-6 bg-green-2 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="min-w-0 break-words text-sm font-semibold text-dls-text">
              {props.item.name}
            </h4>
            <span className="shrink-0 rounded-md bg-green-3 px-1.5 py-0.5 text-[10px] font-medium text-green-11">
              {t("connect.marketplace_active_cloud_label")}
            </span>
            {localCopy ? (
              <span className="shrink-0 rounded-md bg-amber-3 px-1.5 py-0.5 text-[10px] font-medium text-amber-11">
                {t("connect.marketplace_local_copy_badge")}
              </span>
            ) : null}
          </div>
          <p className="line-clamp-2 text-xs text-dls-secondary">
            {props.item.description ?? t("connect.marketplace_no_description")}
          </p>
        </div>
        {manifest?.icon?.src ? (
          <img src={manifest.icon.src} alt="" className="size-8 rounded-lg" />
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {counts.length > 0 ? counts.map((label) => (
          <span key={label} className="rounded-md border border-green-6/40 bg-green-3/50 px-2 py-0.5 text-[11px] font-medium text-green-11">
            {label}
          </span>
        )) : (
          <span className="rounded-md border border-green-6/40 bg-green-3/50 px-2 py-0.5 text-[11px] font-medium text-green-11">
            {t("connect.marketplace_no_components")}
          </span>
        )}
      </div>
      {localCopy ? (
        <div className="mt-3 text-xs text-amber-11">
          {t("connect.marketplace_local_copy_note")}
        </div>
      ) : null}
    </div>
  );
}

function ConnectMarketplaceSection(props: { items: ExtensionItem[] }) {
  const pluginItems = props.items.filter(isCloudMarketplaceItem);

  return (
    <div data-testid="connect-marketplace-section" className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-semibold text-dls-text">{t("connect.marketplace_section_title")}</div>
        <div className="text-sm text-dls-secondary">{t("connect.marketplace_section_description")}</div>
      </div>

      {pluginItems.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">
          {pluginItems.map((item) => <ConnectMarketplaceCard key={item.id} item={item} />)}
        </div>
      ) : (
        <SettingsInset className="bg-dls-surface">
          <div className="text-sm text-dls-secondary">{t("connect.marketplace_empty")}</div>
        </SettingsInset>
      )}
    </div>
  );
}

function ConnectActivePanel(props: {
  connections: DenExternalMcpConnection[];
  marketplaceItems: ExtensionItem[];
  showMarketplace: boolean;
  loading: boolean;
  error: string | null;
  connectingId: string | null;
  onConnect: (connectionId: string) => void;
}) {
  const { activeOrganization } = useCloudSession();
  const activeOrgName = activeOrganization?.name.trim();

  return (
    <SettingsSection>
      <div
        data-testid="connect-org-status-row"
        className="flex items-center gap-2 rounded-2xl border border-green-6/30 bg-green-2 px-4 py-3 text-sm font-medium text-green-11"
      >
        <span className="size-2 rounded-full bg-green-9" />
        {activeOrgName
          ? t("connect.connected_to_org", { name: activeOrgName })
          : t("connect.connected_to_cloud")}
      </div>

      {props.error ? <SettingsNotice tone="error">{props.error}</SettingsNotice> : null}
      {props.loading ? <SettingsNotice>{t("connect.loading")}</SettingsNotice> : null}

      {props.connections.length > 0 ? (
        <OrgConnectionCards
          connections={props.connections}
          connectingId={props.connectingId}
          onConnect={props.onConnect}
        />
      ) : (
        <SettingsInset className="bg-dls-surface">
          <div className="space-y-1">
            <div className="text-sm font-medium text-dls-text">{t("connect.empty_title")}</div>
            <div className="text-sm text-dls-secondary">{t("connect.empty_body")}</div>
          </div>
        </SettingsInset>
      )}

      {props.showMarketplace ? <ConnectMarketplaceSection items={props.marketplaceItems} /> : null}

      <div className="flex justify-end">
        <ManageInDenButton />
      </div>
    </SettingsSection>
  );
}

function ConnectPitchPanel() {
  return (
    <SettingsSection>
      <SettingsInset className="space-y-4 bg-dls-surface">
        <div className="space-y-2">
          <div className="text-base font-semibold text-dls-text">{t("connect.pitch_title")}</div>
          <div className="max-w-[58ch] text-sm text-dls-secondary">{t("connect.pitch_body")}</div>
        </div>
        <ManageInDenButton />
      </SettingsInset>
    </SettingsSection>
  );
}

export function ConnectView(props: ConnectViewProps) {
  const denAuth = useDenAuth();
  const desktopConfig = useDesktopConfig();
  const connectEnabled = useConnectEnabled();
  const orgMcpConnections = useOrgMcpConnections();
  const marketplaceItems = props.marketplaceItems ?? [];
  const refreshMarketplaceItems = props.refreshMarketplaceItems;
  const connectionsCount = orgMcpConnections.connections.length;
  const signedInLoading = denAuth.status === "signed_in"
    && connectionsCount === 0
    && connectEnabled !== true
    && (desktopConfig.loading || orgMcpConnections.loading);
  const state = signedInLoading
    ? "loading"
    : resolveConnectViewState({
        authStatus: denAuth.status,
        connectEnabled,
        connectionsCount,
      });

  useEffect(() => {
    if (state !== "active" || connectEnabled !== true) return;
    void refreshMarketplaceItems?.();
  }, [connectEnabled, refreshMarketplaceItems, state]);

  return (
    <SettingsStack>
      <Separator />
      <ConnectIntro />
      {state === "loading" ? <ConnectLoadingPanel /> : null}
      {state === "signin" ? <ConnectSignInPanel {...props} /> : null}
      {state === "active" ? (
        <ConnectActivePanel
          connections={orgMcpConnections.connections}
          marketplaceItems={marketplaceItems}
          showMarketplace={connectEnabled === true}
          loading={orgMcpConnections.loading}
          error={orgMcpConnections.error}
          connectingId={orgMcpConnections.connectingId}
          onConnect={orgMcpConnections.connect}
        />
      ) : null}
      {state === "pitch" ? <ConnectPitchPanel /> : null}
    </SettingsStack>
  );
}
