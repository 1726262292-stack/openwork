export type PerfLogRecord = {
  id: number;
  at: string;
  ts: number;
  scope: string;
  event: string;
  payload?: Record<string, unknown>;
};

type PerfRoot = typeof globalThis & {
  __openworkPerfSeq?: number;
  __openworkPerfLogs?: PerfLogRecord[];
};

const PERF_LOG_LIMIT = 500;

export const perfNow = () => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const round = (value: number) => Math.round(value * 100) / 100;

export const recordPerfLog = (
  enabled: boolean,
  scope: string,
  event: string,
  payload?: Record<string, unknown>,
) => {
  if (!enabled) return;

  const root = globalThis as PerfRoot;
  const id = (root.__openworkPerfSeq ?? 0) + 1;
  root.__openworkPerfSeq = id;

  const entry: PerfLogRecord = {
    id,
    at: new Date().toISOString(),
    ts: Date.now(),
    scope,
    event,
    payload,
  };

  const logs = root.__openworkPerfLogs ?? [];
  logs.push(entry);
  if (logs.length > PERF_LOG_LIMIT) {
    logs.splice(0, logs.length - PERF_LOG_LIMIT);
  }
  root.__openworkPerfLogs = logs;

  try {
    if (payload === undefined) {
      console.log(`[OWPERF] ${scope}:${event}`);
      return;
    }
    console.log(`[OWPERF] ${scope}:${event}`, payload);
  } catch {
    // ignore
  }
};

export const readPerfLogs = (limit = 120) => {
  const root = globalThis as PerfRoot;
  const logs = root.__openworkPerfLogs ?? [];
  if (limit <= 0) return [];
  if (logs.length <= limit) return logs.slice();
  return logs.slice(logs.length - limit);
};

export const clearPerfLogs = () => {
  const root = globalThis as PerfRoot;
  root.__openworkPerfLogs = [];
  root.__openworkPerfSeq = 0;
};

export const finishPerf = (
  enabled: boolean,
  scope: string,
  event: string,
  startedAt: number,
  payload?: Record<string, unknown>,
) => {
  if (!enabled) return;
  recordPerfLog(enabled, scope, event, {
    ...(payload ?? {}),
    ms: round(perfNow() - startedAt),
  });
};
