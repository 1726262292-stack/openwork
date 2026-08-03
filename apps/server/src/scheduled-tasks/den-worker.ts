import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  DEN_SCHEDULED_TASK_LEASE_HEADER,
  scheduledTaskWorkerClaimResponseSchema,
  scheduledTaskWorkerCompletionResponseSchema,
  scheduledTaskWorkerEventResponseSchema,
  scheduledTaskWorkerHeartbeatResponseSchema,
} from "@openwork/scheduled-tasks-den";
import {
  scheduledTaskPlacementIdentity,
  type ScheduledTaskExecutionEvent,
  type ScheduledTaskExecutionRequest,
  type ScheduledTaskExecutionResult,
  type ScheduledTaskExecutionTarget,
  type ScheduledTaskArtifactReference,
} from "@openwork/scheduled-tasks";
import { externalFetch } from "../server-fetch.js";
import { createWorkspaceOpencodeClient } from "../server.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { createOpencodeScheduledTaskExecutionAdapter } from "./opencode-execution-adapter.js";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 5 * 60_000;

type WorkerEnv = Record<string, string | undefined>;
type WorkerFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type DenScheduledTaskWorkerConfig = {
  enabled: boolean;
  apiBaseUrl: string;
  workerId: string;
  executionToken: string;
  logicalWorkspaceId: string | null;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
};

export type DenScheduledTaskWorkerLogger = {
  log: (
    level: "info" | "warn" | "error",
    message: string,
    attributes?: Record<string, unknown>,
  ) => void;
};

export type DenScheduledTaskWorkerHandle = { stop: () => void };

export type DenScheduledTaskExecutor = (input: {
  request: ScheduledTaskExecutionRequest;
  workspace: WorkspaceInfo;
  authorizedRoots: readonly string[];
  signal: AbortSignal;
  onEvent: (event: ScheduledTaskExecutionEvent) => Promise<void>;
}) => Promise<ScheduledTaskExecutionResult>;

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function interval(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.trunc(parsed)));
}

export function resolveDenScheduledTaskWorkerConfig(
  env: WorkerEnv = process.env,
): DenScheduledTaskWorkerConfig {
  const apiBaseUrl = env.DEN_SCHEDULED_TASKS_API_BASE?.trim() ?? "";
  const workerId = env.DEN_WORKER_ID?.trim() ?? "";
  const executionToken = env.DEN_SCHEDULED_TASKS_EXECUTION_TOKEN?.trim() ?? "";
  const requested = enabled(env.DEN_SCHEDULED_TASKS_WORKER_ENABLED);
  return {
    enabled: requested && Boolean(apiBaseUrl && workerId && executionToken),
    apiBaseUrl,
    workerId,
    executionToken,
    logicalWorkspaceId: env.DEN_SCHEDULED_TASK_WORKSPACE_ID?.trim() || null,
    pollIntervalMs: interval(
      env.DEN_SCHEDULED_TASKS_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    ),
    heartbeatIntervalMs: interval(
      env.DEN_SCHEDULED_TASKS_HEARTBEAT_INTERVAL_MS,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
    ),
  };
}

function endpoint(config: DenScheduledTaskWorkerConfig, suffix: string): string {
  return `${config.apiBaseUrl.replace(/\/$/u, "")}/v1/workers/${encodeURIComponent(config.workerId)}${suffix}`;
}

function workerHeaders(
  config: DenScheduledTaskWorkerConfig,
  leaseToken?: string,
): Headers {
  const headers = new Headers({
    Authorization: `Bearer ${config.executionToken}`,
    "Content-Type": "application/json",
  });
  if (leaseToken) headers.set(DEN_SCHEDULED_TASK_LEASE_HEADER, leaseToken);
  return headers;
}

async function workerFetch(
  fetchImpl: WorkerFetch,
  config: DenScheduledTaskWorkerConfig,
  suffix: string,
  body: unknown,
  leaseToken?: string,
): Promise<Response> {
  return fetchImpl(endpoint(config, suffix), {
    method: "POST",
    headers: workerHeaders(config, leaseToken),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function normalizeArtifacts(input: {
  workspace: WorkspaceInfo;
  artifacts: readonly ScheduledTaskArtifactReference[];
}): Promise<ScheduledTaskArtifactReference[]> {
  const workspaceRoot = path.normalize(await realpath(input.workspace.path));
  const normalized: ScheduledTaskArtifactReference[] = [];
  const seen = new Set<string>();
  for (const artifact of input.artifacts.slice(0, 200)) {
    if (artifact.kind === "url") {
      try {
        const url = new URL(artifact.value);
        if ((url.protocol === "https:" || url.protocol === "http:") && !seen.has(url.href)) {
          seen.add(url.href);
          normalized.push({ ...artifact, value: url.href });
        }
      } catch {
        // Malformed and local file URLs never cross the worker boundary.
      }
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(artifact.value)) continue;
    try {
      const canonical = path.normalize(await realpath(path.resolve(workspaceRoot, artifact.value)));
      if (!containsPath(workspaceRoot, canonical) || !(await stat(canonical)).isFile()) continue;
      const relative = path.relative(workspaceRoot, canonical).split(path.sep).join("/");
      if (!relative || seen.has(relative)) continue;
      seen.add(relative);
      normalized.push({
        ...artifact,
        value: relative,
        name: artifact.name ?? path.basename(canonical),
      });
    } catch {
      // Missing files and workspace escapes grant no portable artifact.
    }
  }
  return normalized;
}

function assertRemotePlacement(
  request: ScheduledTaskExecutionRequest,
  config: DenScheduledTaskWorkerConfig,
): ScheduledTaskExecutionTarget & { kind: "den-worker" } {
  const placements = [
    request.placement,
    request.taskRevision.definition.placement,
    request.grantRevision.placement,
  ];
  if (placements.some((placement) => !placement)) {
    throw new Error("remote_placement_missing");
  }
  const [placement, revisionPlacement, grantPlacement] = placements;
  if (!placement || !revisionPlacement || !grantPlacement) {
    throw new Error("remote_placement_missing");
  }
  const identity = scheduledTaskPlacementIdentity(placement);
  if (
    scheduledTaskPlacementIdentity(revisionPlacement) !== identity
    || scheduledTaskPlacementIdentity(grantPlacement) !== identity
    || request.grantRevision.placementIdentity !== identity
  ) {
    throw new Error("remote_placement_mismatch");
  }
  if (
    placement.target.kind !== "den-worker"
    || placement.schedulerOwner !== "den"
    || placement.executionAvailability !== "cloud"
    || placement.executionPrincipal.kind !== "den-membership"
    || placement.target.workerId !== config.workerId
    || placement.executionPrincipal.organizationId !== placement.target.organizationId
  ) {
    throw new Error("remote_placement_unauthorized");
  }
  const target = placement.target;
  if (
    config.logicalWorkspaceId
    && target.workspaceId !== config.logicalWorkspaceId
  ) {
    throw new Error("remote_workspace_mismatch");
  }
  if (
    request.taskRevision.definition.workspaceId !== target.workspaceId
    || request.grantRevision.workspaceId !== target.workspaceId
  ) {
    throw new Error("remote_workspace_mismatch");
  }
  return target;
}

function selectLocalWorkspace(
  serverConfig: ServerConfig,
  logicalWorkspaceId: string,
): WorkspaceInfo {
  const exact = serverConfig.workspaces.find(
    (workspace) => workspace.id === logicalWorkspaceId && workspace.workspaceType === "local",
  );
  if (exact) return exact;
  const local = serverConfig.workspaces.filter(
    (workspace) => workspace.workspaceType === "local",
  );
  if (local.length === 1 && local[0]) return local[0];
  throw new Error("remote_workspace_unavailable");
}

async function materializeRemoteRequest(input: {
  request: ScheduledTaskExecutionRequest;
  config: DenScheduledTaskWorkerConfig;
  serverConfig: ServerConfig;
}): Promise<{
  request: ScheduledTaskExecutionRequest;
  workspace: WorkspaceInfo;
  authorizedRoots: string[];
}> {
  const target = assertRemotePlacement(input.request, input.config);
  if (input.request.grantRevision.authorizedWorkspaceRoots.length > 0) {
    throw new Error("remote_absolute_roots_forbidden");
  }
  const scope = input.request.grantRevision.filesystemScope;
  if (!scope || scope.kind !== "den-worker-relative-roots") {
    throw new Error("remote_filesystem_scope_missing");
  }
  const workspace = selectLocalWorkspace(input.serverConfig, target.workspaceId);
  const workspaceRoot = path.normalize(await realpath(workspace.path));
  const roots: string[] = [];
  for (const relativeRoot of scope.roots) {
    if (
      relativeRoot.includes("\\")
      || relativeRoot.startsWith("/")
      || /^[A-Za-z]:/u.test(relativeRoot)
      || relativeRoot.split("/").some((part) => part === "..")
    ) {
      throw new Error("remote_filesystem_scope_invalid");
    }
    const candidate = path.resolve(workspaceRoot, relativeRoot);
    if (!containsPath(workspaceRoot, candidate)) {
      throw new Error("remote_filesystem_scope_invalid");
    }
    const canonical = path.normalize(await realpath(candidate));
    if (!containsPath(workspaceRoot, canonical)) {
      throw new Error("remote_filesystem_scope_invalid");
    }
    roots.push(canonical);
  }
  const localRequest: ScheduledTaskExecutionRequest = {
    ...input.request,
    taskRevision: {
      ...input.request.taskRevision,
      definition: {
        ...input.request.taskRevision.definition,
        workspaceId: workspace.id,
      },
    },
    grantRevision: {
      ...input.request.grantRevision,
      workspaceId: workspace.id,
      authorizedWorkspaceRoots: [...new Set(roots)],
    },
  };
  return {
    request: localRequest,
    workspace: { ...workspace, path: workspaceRoot },
    authorizedRoots: [...new Set(roots)],
  };
}

function failedResult(message: string): ScheduledTaskExecutionResult {
  return {
    status: "failed",
    sessionId: null,
    error: {
      code: "invalid-grant",
      message,
      retryable: false,
      ambiguous: false,
    },
  };
}

function ambiguousResult(): ScheduledTaskExecutionResult {
  return {
    status: "ambiguous",
    sessionId: null,
    error: {
      code: "ambiguous-outcome",
      message: "The remote scheduled-task execution could not be reconciled.",
      retryable: true,
      ambiguous: true,
    },
  };
}

function timedOutResult(sessionId: string | null): ScheduledTaskExecutionResult {
  return {
    status: "failed",
    sessionId,
    error: {
      code: "execution-timed-out",
      message: "Scheduled task exceeded its maximum runtime",
      retryable: false,
      ambiguous: false,
    },
  };
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function createDefaultExecutor(
  serverConfig: ServerConfig,
): DenScheduledTaskExecutor {
  return async ({ request, workspace, authorizedRoots, signal, onEvent }) => {
    const adapter = createOpencodeScheduledTaskExecutionAdapter({
      authorizedRoots,
      resolveWorkspace: async (workspaceId) => {
        if (workspaceId !== workspace.id) throw new Error("workspace_not_found");
        return workspace;
      },
      createClient: (resolvedWorkspace) =>
        createWorkspaceOpencodeClient(serverConfig, resolvedWorkspace),
      resolveArtifacts: async ({ workspace: resolvedWorkspace, candidates }) =>
        normalizeArtifacts({
          workspace: resolvedWorkspace,
          artifacts: candidates.map((candidate) => ({
            id: `artifact_${createHash("sha256").update(candidate).digest("hex").slice(0, 24)}`,
            kind: "file",
            value: candidate,
            name: null,
          })),
        }),
    });
    return adapter.execute(request, { signal, onEvent });
  };
}

export async function runDenScheduledTaskWorkerOnce(input: {
  config: DenScheduledTaskWorkerConfig;
  serverConfig: ServerConfig;
  fetchImpl?: WorkerFetch;
  execute?: DenScheduledTaskExecutor;
  now?: () => number;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  scheduleExecutionTimeout?: (
    onTimeout: () => void,
    durationMs: number,
  ) => () => void;
}): Promise<{ claimed: boolean }> {
  if (!input.config.enabled) return { claimed: false };
  const fetchImpl = input.fetchImpl
    ?? ((request: string | URL | Request, init?: RequestInit) =>
      externalFetch(String(request), init));
  const claim = await workerFetch(
    fetchImpl,
    input.config,
    "/scheduled-task-runs/claim",
    {},
  );
  if (claim.status === 204) return { claimed: false };
  if (!claim.ok) throw new Error(`den_scheduled_task_claim_failed:${claim.status}`);
  const claimed = scheduledTaskWorkerClaimResponseSchema.parse(await claim.json());
  if (
    claimed.request.runId !== claimed.lease.runId
    || claimed.request.attemptId !== claimed.lease.attemptId
  ) {
    throw new Error("den_scheduled_task_lease_mismatch");
  }

  let prepared: Awaited<ReturnType<typeof materializeRemoteRequest>> | null = null;
  let result: ScheduledTaskExecutionResult = failedResult(
    "The Den execution placement or filesystem grant is invalid.",
  );
  try {
    prepared = await materializeRemoteRequest({
      request: claimed.request,
      config: input.config,
      serverConfig: input.serverConfig,
    });
  } catch {}

  if (prepared) {
    const executionController = new AbortController();
    const heartbeatController = new AbortController();
    const now = input.now ?? Date.now;
    const delay = input.delay ?? abortableDelay;
    let sessionId: string | null = null;
    let sequence = 0;
    let heartbeatFailure: unknown = null;
    let cancelledByDen = false;
    let runtimeTimedOut = false;

    const heartbeat = async () => {
      while (!heartbeatController.signal.aborted) {
        if (claimed.lease.expiresAt <= now()) {
          heartbeatFailure = new Error("den_scheduled_task_lease_expired");
          executionController.abort();
          return;
        }
        try {
          const response = await workerFetch(
            fetchImpl,
            input.config,
            `/scheduled-task-attempts/${encodeURIComponent(claimed.lease.attemptId)}/heartbeat`,
            { sessionId },
            claimed.lease.token,
          );
          if (!response.ok) throw new Error(`heartbeat_failed:${response.status}`);
          const body = scheduledTaskWorkerHeartbeatResponseSchema.parse(await response.json());
          claimed.lease.expiresAt = body.leaseExpiresAt;
          if (body.cancelRequestedAt !== null) {
            cancelledByDen = true;
            executionController.abort();
          }
        } catch (error) {
          heartbeatFailure = error;
          executionController.abort();
          return;
        }
        await delay(input.config.heartbeatIntervalMs, heartbeatController.signal);
      }
    };
    const heartbeatPromise = heartbeat();
    const scheduleExecutionTimeout = input.scheduleExecutionTimeout
      ?? ((onTimeout: () => void, durationMs: number) => {
        const timer = setTimeout(onTimeout, durationMs);
        return () => clearTimeout(timer);
      });
    const cancelRuntimeTimeout = scheduleExecutionTimeout(() => {
      if (cancelledByDen || heartbeatFailure) return;
      runtimeTimedOut = true;
      executionController.abort();
    }, Math.min(
      prepared.request.taskRevision.definition.maximumRuntimeMs,
      prepared.request.grantRevision.maximumRuntimeMs,
    ));
    try {
      result = await (input.execute ?? createDefaultExecutor(input.serverConfig))({
        ...prepared,
        signal: executionController.signal,
        onEvent: async (event) => {
          if (event.type === "session-created") sessionId = event.sessionId;
          sequence += 1;
          const response = await workerFetch(
            fetchImpl,
            input.config,
            `/scheduled-task-attempts/${encodeURIComponent(claimed.lease.attemptId)}/events`,
            { sequence, event },
            claimed.lease.token,
          );
          if (!response.ok) throw new Error(`event_failed:${response.status}`);
          scheduledTaskWorkerEventResponseSchema.parse(await response.json());
        },
      });
      if (runtimeTimedOut) result = timedOutResult(result.sessionId ?? sessionId);
      else if (heartbeatFailure) result = ambiguousResult();
    } catch {
      result = runtimeTimedOut ? timedOutResult(sessionId) : ambiguousResult();
    } finally {
      cancelRuntimeTimeout();
      heartbeatController.abort();
      await heartbeatPromise;
    }
  }

  if (prepared && result.status === "completed") {
    result = {
      ...result,
      artifacts: await normalizeArtifacts({
        workspace: prepared.workspace,
        artifacts: result.artifacts,
      }),
    };
  }

  const completion = await workerFetch(
    fetchImpl,
    input.config,
    `/scheduled-task-attempts/${encodeURIComponent(claimed.lease.attemptId)}/complete`,
    { result },
    claimed.lease.token,
  );
  if (!completion.ok) {
    throw new Error(`den_scheduled_task_completion_failed:${completion.status}`);
  }
  scheduledTaskWorkerCompletionResponseSchema.parse(await completion.json());
  return { claimed: true };
}

export function startDenScheduledTaskWorker(
  serverConfig: ServerConfig,
  logger: DenScheduledTaskWorkerLogger,
  options?: {
    env?: WorkerEnv;
    fetchImpl?: WorkerFetch;
    execute?: DenScheduledTaskExecutor;
  },
): DenScheduledTaskWorkerHandle | null {
  const config = resolveDenScheduledTaskWorkerConfig(options?.env);
  if (!config.enabled) return null;
  const controller = new AbortController();
  logger.log("info", "Den scheduled-task worker enabled", {
    workerId: config.workerId,
    pollIntervalMs: config.pollIntervalMs,
  });
  const loop = async () => {
    while (!controller.signal.aborted) {
      try {
        const outcome = await runDenScheduledTaskWorkerOnce({
          config,
          serverConfig,
          fetchImpl: options?.fetchImpl,
          execute: options?.execute,
        });
        if (!outcome.claimed) {
          await abortableDelay(config.pollIntervalMs, controller.signal);
        }
      } catch (error) {
        logger.log("warn", "Den scheduled-task worker cycle failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
        await abortableDelay(config.pollIntervalMs, controller.signal);
      }
    }
  };
  void loop();
  return { stop: () => controller.abort() };
}
