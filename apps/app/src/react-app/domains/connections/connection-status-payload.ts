/**
 * Detects structured `connection_status` payloads inside OpenWork Cloud MCP
 * tool results (`*_search_capabilities` / `*_execute_capability`).
 *
 * The Den embeds these when a connector behind the capability gateway is
 * broken (expired OAuth grant, rejected token refresh, provider outage) so
 * the chat can render an actionable reconnect card instead of raw JSON.
 * The payload shape is the Den's MCP connection-status contract:
 * `{ matches: [{ kind: "connection_status", connectionStatus: {...} }] }`
 * for search results, or a top-level `connectionStatus` object.
 */

import type { DynamicToolUIPart, ToolUIPart } from "ai";

export type ConnectionStatusPayload = {
  connectionName: string;
  connectionId: string | null;
  state: string;
  credentialMode: "per_member" | "shared" | null;
  errorCode: string | null;
  message: string | null;
  actor: string | null;
  actionLabel: string | null;
  diagnosticReferenceId: string | null;
  serviceUrl: string | null;
  /** The member can attempt reconnect by re-running OAuth for their own account. */
  canAttemptReconnect: boolean;
};

const CLOUD_TOOL_SUFFIXES = ["_search_capabilities", "_execute_capability"];
const HEALTHY_STATES = new Set(["connected", "ok", "ready"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseCandidate(value: unknown, serviceUrl: string | null): ConnectionStatusPayload | null {
  if (!isRecord(value)) return null;
  const connectionName = asString(value.connectionName);
  const state = asString(value.state);
  if (!connectionName || !state) return null;
  if (HEALTHY_STATES.has(state)) return null;
  const credentialMode =
    value.credentialMode === "per_member" || value.credentialMode === "shared"
      ? value.credentialMode
      : null;
  const actor = asString(value.actor);
  const action = isRecord(value.action) ? value.action : null;
  const diagnostic = isRecord(value.diagnostic) ? value.diagnostic : null;
  return {
    connectionName,
    connectionId: asString(value.connectionId),
    state,
    credentialMode,
    errorCode: asString(value.errorCode),
    message: asString(value.message),
    actor,
    actionLabel: action ? asString(action.label) : null,
    diagnosticReferenceId: diagnostic ? asString(diagnostic.referenceId) : null,
    serviceUrl,
    canAttemptReconnect: credentialMode === "per_member" && state === "reauth_required",
  };
}

function findConnectionStatus(root: unknown): ConnectionStatusPayload | null {
  if (!isRecord(root)) return null;
  const direct = parseCandidate(root.connectionStatus, null);
  if (direct) return direct;
  const matches = Array.isArray(root.matches) ? root.matches : [];
  for (const match of matches) {
    if (!isRecord(match)) continue;
    if (match.kind !== "connection_status") continue;
    const parsed = parseCandidate(match.connectionStatus, asString(match.path));
    if (parsed) return parsed;
  }
  return null;
}

function parseJsonDocument(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    // Tool output text sometimes wraps the JSON document (prefix/suffix
    // prose). Fall back to the outermost braces.
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export function isCloudCapabilityToolName(toolName: string): boolean {
  return CLOUD_TOOL_SUFFIXES.some((suffix) => toolName.endsWith(suffix));
}

export function parseConnectionStatusPayload(output: unknown): ConnectionStatusPayload | null {
  if (typeof output === "string") {
    const document = parseJsonDocument(output);
    return document === null ? null : findConnectionStatus(document);
  }
  return findConnectionStatus(output);
}

/**
 * Guard for the chat tool renderer: returns the parsed payload when this
 * tool part is a Cloud capability call whose result carries a broken
 * connection status; `null` otherwise (renders as a plain tool part).
 */
export function getConnectionStatusFromToolPart(
  part: ToolUIPart | DynamicToolUIPart,
): ConnectionStatusPayload | null {
  if (part.type !== "dynamic-tool") return null;
  if (!isCloudCapabilityToolName(part.toolName)) return null;
  if (part.state === "output-available") return parseConnectionStatusPayload(part.output);
  if (part.state === "output-error") return parseConnectionStatusPayload(part.errorText);
  return null;
}
