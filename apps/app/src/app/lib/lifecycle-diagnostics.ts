import { recordInspectorEvent } from "./app-inspector";
import {
  DEFAULT_OPENWORK_SERVER_PORT,
  normalizeOpenworkServerUrl,
  readOpenworkServerSettings,
} from "./openwork-server";

let flushTimer: number | null = null;
let queue: Array<Record<string, unknown>> = [];

function resolveDiagnosticServerUrl(): string {
  const settings = readOpenworkServerSettings();
  const explicit = normalizeOpenworkServerUrl(settings.urlOverride ?? "");
  if (explicit) return explicit;
  const port = typeof settings.portOverride === "number" && Number.isFinite(settings.portOverride)
    ? settings.portOverride
    : DEFAULT_OPENWORK_SERVER_PORT;
  return `http://127.0.0.1:${port}`;
}

function scheduleFlush(): void {
  if (typeof window === "undefined") return;
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushLifecycleDiagnostics();
  }, 500);
}

async function flushLifecycleDiagnostics(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await fetch(`${resolveDiagnosticServerUrl()}/dev/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
      keepalive: true,
    });
  } catch {
    // Keep diagnostics best-effort; failed writes should not feed the reload loop.
  }
}

export function recordLifecycleDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  const entry = {
    at: new Date().toISOString(),
    event,
    ...details,
  };
  recordInspectorEvent(`lifecycle.${event}`, entry);
  queue.push({
    level: "info",
    source: "lifecycle",
    message: event,
    extra: entry,
  });
  if (queue.length > 100) queue.splice(0, queue.length - 100);
  scheduleFlush();
  try {
    console.info("[openwork-lifecycle]", entry);
  } catch {
    // Diagnostics must never affect the app path they are observing.
  }
}
