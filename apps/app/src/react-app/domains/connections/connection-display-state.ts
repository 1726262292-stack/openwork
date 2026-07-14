import type { McpStatus } from "@/app/types";

export type ConnectionDisplayState =
  | "configured"
  | "auth_required"
  | "protocol_ready"
  | "error"
  | "disabled";

export type ConnectionDisplayStateLabelKey =
  | "mcp.friendly_status_offline"
  | "mcp.friendly_status_needs_signin"
  | "mcp.friendly_status_ready"
  | "mcp.friendly_status_issue"
  | "mcp.friendly_status_paused";

export type ConnectionDisplayTone = "neutral" | "warning" | "success" | "error";

export type ConnectionDisplayStateInput = {
  configured: boolean;
  enabled?: boolean;
  status?: McpStatus["status"] | null;
  needsAuth?: boolean;
  failed?: boolean;
};

export function connectionDisplayState(input: ConnectionDisplayStateInput): ConnectionDisplayState | null {
  if (input.enabled === false || input.status === "disabled") return "disabled";
  if (
    input.status === "needs_auth" ||
    input.status === "needs_client_registration" ||
    input.needsAuth === true
  ) return "auth_required";
  if (input.status === "connected") return "protocol_ready";
  if (input.status === "failed" || input.failed === true) return "error";
  if (input.configured) return "configured";
  return null;
}

export function connectionDisplayStateLabelKey(state: ConnectionDisplayState): ConnectionDisplayStateLabelKey {
  switch (state) {
    case "configured":
      return "mcp.friendly_status_offline";
    case "auth_required":
      return "mcp.friendly_status_needs_signin";
    case "protocol_ready":
      return "mcp.friendly_status_ready";
    case "error":
      return "mcp.friendly_status_issue";
    case "disabled":
      return "mcp.friendly_status_paused";
  }
}

export function connectionDisplayStateTone(state: ConnectionDisplayState): ConnectionDisplayTone {
  switch (state) {
    case "protocol_ready":
      return "success";
    case "auth_required":
      return "warning";
    case "error":
      return "error";
    case "configured":
    case "disabled":
      return "neutral";
  }
}
