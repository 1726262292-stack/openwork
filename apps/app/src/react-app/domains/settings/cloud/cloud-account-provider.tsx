"use memo";

import * as React from "react";

import type { useDenSession } from "./use-den-session";

export type CloudAccountSession = Pick<
  ReturnType<typeof useDenSession>,
  | "authBusy"
  | "authError"
  | "baseUrlDraft"
  | "baseUrlError"
  | "needsOrgSelection"
  | "orgs"
  | "orgsBusy"
  | "orgsError"
  | "sessionBusy"
  | "summaryLabel"
  | "summaryTone"
  | "onActiveOrgChange"
  | "onApplyBaseUrl"
  | "onBaseUrlDraftChange"
  | "onClearAuthError"
  | "onOpenBrowserAuth"
  | "onOpenControlPlane"
  | "onRefreshOrgs"
  | "onResetBaseUrl"
  | "onSignOut"
  | "onSubmitManualAuth"
>;

interface CloudAccountContextValue {
  developerMode: boolean;
  error: string | null;
  isBusy: boolean;
  session: CloudAccountSession;
}

const CloudAccountContext = React.createContext<CloudAccountContextValue | null>(null);

interface CloudAccountProviderProps {
  children: React.ReactNode;
  developerMode: boolean;
  session: CloudAccountSession;
}

export function CloudAccountProvider({ children, developerMode, session }: CloudAccountProviderProps) {
  const value = React.useMemo(
    () => ({
      developerMode,
      error: session.baseUrlError ?? session.authError ?? session.orgsError,
      isBusy: session.authBusy || session.sessionBusy,
      session,
    }),
    [developerMode, session],
  );

  return <CloudAccountContext.Provider value={value}>{children}</CloudAccountContext.Provider>;
}

export function useCloudAccount() {
  const context = React.useContext(CloudAccountContext);

  if (!context) {
    throw new Error("useCloudAccount must be used within a CloudAccountProvider");
  }

  return context;
}
