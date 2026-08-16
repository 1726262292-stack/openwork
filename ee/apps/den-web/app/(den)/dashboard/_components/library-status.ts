import type { LibraryConnectionItem, LibraryItem } from "./library-data";

/** Dot/chip colours shared by every library flow. */
export type FlowStatusTone = "success" | "warning" | "danger" | "info";

/**
 * Readiness groups. `available` folds into `ready` because nothing is blocking
 * the member, even though the icon dot still distinguishes the two.
 */
export type LibraryReadinessState = "needs_signin" | "needs_admin_setup" | "ready";

export const LIBRARY_READINESS_LABELS: Record<LibraryReadinessState, string> = {
  needs_signin: "Sign In to Use",
  needs_admin_setup: "Needs admin setup",
  ready: "Ready to use",
};

export const LIBRARY_READINESS_SECTION_TITLES: Record<LibraryReadinessState, string> = {
  needs_signin: "SIGN IN TO USE",
  needs_admin_setup: "NEEDS ADMIN SETUP",
  ready: "READY TO USE",
};

const CONNECTION_STATE_LABELS: Record<LibraryConnectionItem["state"], string> = {
  connected: "Ready to use",
  needs_signin: "Sign In to Use",
  needs_admin_setup: "Needs admin setup",
  available: "Available",
};

const CONNECTION_STATE_TONES: Record<LibraryConnectionItem["state"], FlowStatusTone> = {
  connected: "success",
  needs_signin: "warning",
  needs_admin_setup: "danger",
  available: "info",
};

export function getConnectionStatusLabel(state: LibraryConnectionItem["state"]): string {
  return CONNECTION_STATE_LABELS[state];
}

export function getConnectionStatusTone(state: LibraryConnectionItem["state"]): FlowStatusTone {
  return CONNECTION_STATE_TONES[state];
}

export function getReadinessState(item: LibraryItem): LibraryReadinessState {
  if (item.type !== "connection") return "ready";
  if (item.state === "needs_signin") return "needs_signin";
  if (item.state === "needs_admin_setup") return "needs_admin_setup";
  return "ready";
}
