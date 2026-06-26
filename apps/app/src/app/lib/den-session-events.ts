import type { DenSettings, DenUser } from "./den-types";

export const denSessionUpdatedEvent = "openwork-den-session-updated";
export const denSettingsChangedEvent = "openwork-den-settings-changed";
/**
 * Fired once after an agent-first install's prepared desktop bootstrap has
 * signed the user in, so the shell can route to the "You're ready" screen.
 * Shared constant so the emitter (den-auth-provider) and listener (app-root)
 * cannot drift.
 */
export const bootstrapPreparedReadyEvent = "openwork:bootstrap-prepared-ready";

export function dispatchBootstrapPreparedReady() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(bootstrapPreparedReadyEvent));
}

export type DenSessionUpdatedDetail = {
  status?: "success" | "error" | "signed_out";
  baseUrl?: string | null;
  token?: string | null;
  user?: DenUser | null;
  email?: string | null;
  message?: string | null;
};

export function dispatchDenSessionUpdated(detail: DenSessionUpdatedDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<DenSessionUpdatedDetail>(denSessionUpdatedEvent, {
      detail,
    }),
  );
}

export type DenSettingsChangedDetail = {
  settings: DenSettings;
};

export function dispatchDenSettingsChanged(detail: DenSettingsChangedDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<DenSettingsChangedDetail>(denSettingsChangedEvent, {
      detail,
    }),
  );
}
