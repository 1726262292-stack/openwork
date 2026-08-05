/** @jsxImportSource react */
import { useEffect, useRef } from "react";
import { PROVIDER_SYNC_TOKEN_TTL_SECONDS } from "@openwork/types/den/provider-sync";

import {
  mintProviderSyncToken,
  readDenSettings,
  type DenDesktopConfig,
} from "../../../app/lib/den";
import { createOpenworkServerClient } from "../../../app/lib/openwork-server";
import { resolveOpenworkConnection } from "../../shell/openwork-connection";

const PUSH_RETRY_DELAY_MS = 3_000;
const PUSH_MAX_ATTEMPTS = 20;
const TOKEN_REFRESH_WINDOW_MS = Math.min(
  2 * 60 * 60 * 1_000,
  Math.floor(PROVIDER_SYNC_TOKEN_TTL_SECONDS * 1_000 / 2),
);

type MintedProviderSyncToken = {
  token: string;
  expiresAt: string;
  orgId: string;
  denBaseUrl: string;
};

function tokenNeedsRefresh(token: MintedProviderSyncToken | null, now: number): boolean {
  if (!token) return true;
  const expiresAt = Date.parse(token.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt - now <= TOKEN_REFRESH_WINDOW_MS;
}

function enabledDeliveryKey(token: MintedProviderSyncToken): string {
  return `${token.orgId}\u0000${token.denBaseUrl}\u0000${token.expiresAt}`;
}

export function useProviderSyncStatePush(input: {
  config: DenDesktopConfig;
  loading: boolean;
  isSignedIn: boolean;
  refreshVersion: number;
}): void {
  const mintedTokenRef = useRef<MintedProviderSyncToken | null>(null);
  const lastDeliveredKeyRef = useRef<string | null>(null);
  const syncEnabled = input.config.orgProviderSyncEnabled === true;

  useEffect(() => {
    if (input.loading) return;
    // The refresh version intentionally re-runs this effect after the existing
    // hourly desktop-config fetch, even when none of the config values changed.
    void input.refreshVersion;

    const initialSettings = readDenSettings();
    const initialOrgId = initialSettings.activeOrgId?.trim() ?? "";
    const initialDenBaseUrl = initialSettings.apiBaseUrl?.trim() || initialSettings.baseUrl.trim();
    const shouldEnable = syncEnabled
      && input.isSignedIn
      && Boolean(initialSettings.authToken?.trim())
      && Boolean(initialOrgId)
      && Boolean(initialDenBaseUrl);

    if (!shouldEnable) {
      mintedTokenRef.current = null;
      if (lastDeliveredKeyRef.current === "disabled") return;
    } else {
      const minted = mintedTokenRef.current;
      if (
        minted
        && minted.orgId === initialOrgId
        && minted.denBaseUrl === initialDenBaseUrl
        && !tokenNeedsRefresh(minted, Date.now())
        && lastDeliveredKeyRef.current === enabledDeliveryKey(minted)
      ) {
        return;
      }
    }

    let cancelled = false;
    const wait = (delayMs: number) => new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));

    const deliver = async (): Promise<boolean> => {
      const settings = readDenSettings();
      const orgId = settings.activeOrgId?.trim() ?? "";
      const denBaseUrl = settings.apiBaseUrl?.trim() || settings.baseUrl.trim();
      const enable = syncEnabled
        && input.isSignedIn
        && Boolean(settings.authToken?.trim())
        && Boolean(orgId)
        && Boolean(denBaseUrl);
      const connection = await resolveOpenworkConnection();
      if (!connection.normalizedBaseUrl || !connection.resolvedHostToken) return false;
      const client = createOpenworkServerClient({
        baseUrl: connection.normalizedBaseUrl,
        token: connection.resolvedToken,
        hostToken: connection.resolvedHostToken,
      });

      if (!enable) {
        await client.setProviderSyncState({
          enabled: false,
          token: null,
          expiresAt: null,
          denBaseUrl: null,
          orgId: null,
        });
        lastDeliveredKeyRef.current = "disabled";
        return true;
      }

      let minted = mintedTokenRef.current;
      if (
        !minted
        || minted.orgId !== orgId
        || minted.denBaseUrl !== denBaseUrl
        || tokenNeedsRefresh(minted, Date.now())
      ) {
        const response = await mintProviderSyncToken(orgId);
        if (!response.token.trim() || !Number.isFinite(Date.parse(response.expiresAt))) {
          throw new Error("Invalid provider sync token response");
        }
        minted = { ...response, orgId, denBaseUrl };
        mintedTokenRef.current = minted;
      }

      await client.setProviderSyncState({
        enabled: true,
        token: minted.token,
        expiresAt: minted.expiresAt,
        denBaseUrl: minted.denBaseUrl,
        orgId: minted.orgId,
      });
      lastDeliveredKeyRef.current = enabledDeliveryKey(minted);
      return true;
    };

    void (async () => {
      for (let attempt = 0; attempt < PUSH_MAX_ATTEMPTS; attempt += 1) {
        if (cancelled) return;
        try {
          if (await deliver()) return;
        } catch {
          // Den or the local server may still be starting; retry below.
        }
        if (cancelled) return;
        await wait(PUSH_RETRY_DELAY_MS);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [input.isSignedIn, input.loading, input.refreshVersion, syncEnabled]);
}
