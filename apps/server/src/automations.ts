/**
 * Inngest-powered automations for OpenWork server (v1).
 *
 * Provides an in-memory automation store, CRUD, trigger, update, and a
 * recurring scheduler that fires automations on their configured interval.
 */

import { Inngest } from "inngest";

// ── Inngest client ──────────────────────────────────────────────────────

export const inngest = new Inngest({ id: "openwork" });

// ── Types ───────────────────────────────────────────────────────────────

export type Automation = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  /** "manual" | intervalSeconds (e.g. "60") | cron expression */
  schedule: string;
  enabled: boolean;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastRunStatus: "pending" | "running" | "success" | "failed" | null;
  lastRunError: string | null;
  lastSessionId: string | null;
  runCount: number;
};

export type CreateAutomationInput = {
  name?: string;
  description?: string;
  prompt: string;
  schedule?: string;
};

export type UpdateAutomationInput = {
  name?: string;
  description?: string;
  prompt?: string;
  schedule?: string;
  enabled?: boolean;
};

// ── In-memory store ─────────────────────────────────────────────────────

const automations = new Map<string, Automation>();

function generateId() {
  return `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function listAutomations(workspaceId: string): Automation[] {
  const items: Automation[] = [];
  for (const auto of automations.values()) {
    if (auto.workspaceId === workspaceId) {
      items.push({ ...auto });
    }
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items;
}

export function getAutomation(id: string): Automation | null {
  const auto = automations.get(id);
  return auto ? { ...auto } : null;
}

export function createAutomation(workspaceId: string, input: CreateAutomationInput): Automation {
  const prompt = (input.prompt ?? "").trim();
  if (!prompt) {
    throw Object.assign(new Error("prompt is required"), { status: 400 });
  }

  const now = new Date().toISOString();
  const auto: Automation = {
    id: generateId(),
    name: (input.name ?? "").trim() || "Untitled Automation",
    description: (input.description ?? "").trim(),
    prompt,
    schedule: (input.schedule ?? "").trim() || "manual",
    enabled: true,
    workspaceId,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    lastSessionId: null,
    runCount: 0,
  };

  automations.set(auto.id, auto);
  return { ...auto };
}

export function updateAutomation(id: string, input: UpdateAutomationInput): Automation {
  const auto = automations.get(id);
  if (!auto) {
    throw Object.assign(new Error(`Automation not found: ${id}`), { status: 404 });
  }

  if (input.name !== undefined) auto.name = input.name.trim() || auto.name;
  if (input.description !== undefined) auto.description = input.description.trim();
  if (input.prompt !== undefined) {
    const p = input.prompt.trim();
    if (p) auto.prompt = p;
  }
  if (input.schedule !== undefined) auto.schedule = input.schedule.trim() || "manual";
  if (input.enabled !== undefined) auto.enabled = input.enabled;
  auto.updatedAt = new Date().toISOString();

  return { ...auto };
}

export function deleteAutomation(id: string): Automation {
  const auto = automations.get(id);
  if (!auto) {
    throw Object.assign(new Error(`Automation not found: ${id}`), { status: 404 });
  }
  automations.delete(id);
  return { ...auto };
}

// ── Trigger ─────────────────────────────────────────────────────────────

type FetchOpencodeJsonFn = (
  path: string,
  init: { method: string; body?: unknown },
) => Promise<unknown>;

export async function triggerAutomation(
  id: string,
  fetchOpencode: FetchOpencodeJsonFn,
): Promise<{ eventId: string; sessionId?: string }> {
  const auto = automations.get(id);
  if (!auto) {
    throw Object.assign(new Error(`Automation not found: ${id}`), { status: 404 });
  }

  auto.lastRunAt = new Date().toISOString();
  auto.lastRunStatus = "running";
  auto.lastRunError = null;
  auto.updatedAt = auto.lastRunAt;

  return triggerDirect(auto, fetchOpencode);
}

async function triggerDirect(
  auto: Automation,
  fetchOpencode: FetchOpencodeJsonFn,
): Promise<{ eventId: string; sessionId?: string }> {
  try {
    const sessionResult = await fetchOpencode("/session", {
      method: "POST",
      body: {},
    }) as { id?: string };

    const sessionId = sessionResult?.id;
    if (!sessionId) {
      throw new Error("Session creation did not return an ID");
    }

    try {
      await fetchOpencode(`/session/${sessionId}/prompt_async`, {
        method: "POST",
        body: { parts: [{ type: "text", text: auto.prompt }] },
      });
    } catch (err: unknown) {
      const status = (err as any)?.status ?? (err as any)?.details?.status;
      if (status !== 204) {
        throw err;
      }
    }

    auto.lastRunStatus = "success";
    auto.lastSessionId = sessionId;
    auto.lastRunError = null;
    auto.runCount += 1;
    auto.updatedAt = new Date().toISOString();

    return { eventId: "direct", sessionId };
  } catch (error: unknown) {
    auto.lastRunStatus = "failed";
    auto.lastRunError = error instanceof Error ? error.message : String(error);
    auto.updatedAt = new Date().toISOString();
    throw error;
  }
}

// ── Recurring scheduler ─────────────────────────────────────────────────

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerFetchOpencode: FetchOpencodeJsonFn | null = null;

/**
 * Parse the schedule field. Returns interval in seconds, or 0 for manual.
 */
function parseScheduleSeconds(schedule: string): number {
  if (!schedule || schedule === "manual") return 0;
  const num = Number(schedule);
  if (Number.isFinite(num) && num > 0) return num;
  return 0;
}

/**
 * Start the recurring scheduler. Checks every 10 seconds for automations
 * whose interval has elapsed and triggers them.
 */
export function startScheduler(fetchOpencode: FetchOpencodeJsonFn) {
  schedulerFetchOpencode = fetchOpencode;
  if (schedulerTimer) return;

  schedulerTimer = setInterval(() => {
    if (!schedulerFetchOpencode) return;
    const now = Date.now();

    for (const auto of automations.values()) {
      if (!auto.enabled) continue;
      if (auto.lastRunStatus === "running") continue;

      const intervalSec = parseScheduleSeconds(auto.schedule);
      if (intervalSec <= 0) continue;

      const lastRun = auto.lastRunAt ? new Date(auto.lastRunAt).getTime() : 0;
      const elapsed = (now - lastRun) / 1000;

      if (elapsed >= intervalSec) {
        console.log(`[scheduler] Firing recurring automation: ${auto.name} (${auto.id})`);
        triggerAutomation(auto.id, schedulerFetchOpencode).catch((err) => {
          console.error(`[scheduler] Automation ${auto.id} failed:`, err instanceof Error ? err.message : err);
        });
      }
    }
  }, 10_000);
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerFetchOpencode = null;
}

// ── Inngest functions (for Inngest serve endpoint) ──────────────────────

export const runAutomationFn = inngest.createFunction(
  {
    id: "run-automation",
    retries: 2,
    triggers: [{ event: "automation/run" }],
  },
  async ({ event, step }: any) => {
    const { prompt, workspaceId, serverBaseUrl, authToken } = event.data as {
      prompt: string;
      workspaceId: string;
      serverBaseUrl: string;
      authToken?: string;
    };

    const session = await step.run("create-session", async () => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      const res = await fetch(`${serverBaseUrl}/workspace/${workspaceId}/opencode/session`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
      return (await res.json()) as { id: string };
    });

    const sessionId = session?.id;
    if (!sessionId) throw new Error("No session ID returned");

    await step.run("send-prompt", async () => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      const res = await fetch(
        `${serverBaseUrl}/workspace/${workspaceId}/opencode/session/${sessionId}/prompt_async`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ parts: [{ type: "text", text: prompt }] }),
        },
      );
      if (!res.ok && res.status !== 204) throw new Error(`Failed: ${res.status}`);
      return { sent: true };
    });

    return { sessionId, prompt, workspaceId, completedAt: new Date().toISOString() };
  },
);

export const inngestFunctions = [runAutomationFn];
