import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scheduledTaskWorkerClaimResponseSchema } from "@openwork/scheduled-tasks-den";
import {
  scheduledTaskPlacementIdentity,
  type ScheduledTaskExecutionResult,
} from "@openwork/scheduled-tasks";
import type { ServerConfig } from "../types.js";
import {
  resolveDenScheduledTaskWorkerConfig,
  runDenScheduledTaskWorkerOnce,
} from "./den-worker.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function workerConfig() {
  return resolveDenScheduledTaskWorkerConfig({
    DEN_SCHEDULED_TASKS_WORKER_ENABLED: "1",
    DEN_SCHEDULED_TASKS_API_BASE: "https://den.test",
    DEN_WORKER_ID: "worker-1",
    DEN_SCHEDULED_TASKS_EXECUTION_TOKEN: "execution-token-only",
    DEN_SCHEDULED_TASK_WORKSPACE_ID: "workspace-1",
    DEN_SCHEDULED_TASKS_HEARTBEAT_INTERVAL_MS: "100",
  });
}

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "client-token-must-not-leave-worker",
    hostToken: "host-token-must-not-leave-worker",
    approval: { mode: "auto", timeoutMs: 30_000 },
    corsOrigins: ["*"],
    workspaces: [{
      id: "local-workspace",
      name: "Worker workspace",
      path: root,
      preset: "starter",
      workspaceType: "local",
    }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: 0,
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
}

function claimBody(overrides?: { absoluteRoot?: string }) {
  const placement = {
    target: {
      kind: "den-worker" as const,
      organizationId: "organization-1",
      workerId: "worker-1",
      workspaceId: "workspace-1",
    },
    schedulerOwner: "den" as const,
    executionAvailability: "cloud" as const,
    executionPrincipal: {
      kind: "den-membership" as const,
      organizationId: "organization-1",
      membershipId: "membership-1",
    },
    capabilityReferences: [{
      id: "workspace.files.read",
      source: "openwork" as const,
      actionClass: "read" as const,
      reviewedVersion: "1",
      reviewedDigest: null,
    }],
  };
  return scheduledTaskWorkerClaimResponseSchema.parse({
    lease: {
      runId: "run-1",
      attemptId: "attempt-1",
      generation: 1,
      expiresAt: 60_000,
      token: "lease-token-with-at-least-thirty-two-bytes",
    },
    request: {
      runId: "run-1",
      attemptId: "attempt-1",
      idempotencyKey: "scheduled:task-1:one",
      placement,
      taskRevision: {
        id: "revision-1",
        taskId: "task-1",
        revision: 1,
        definition: {
          name: "Remote task",
          description: "",
          prompt: "Read the workspace.",
          workspaceId: "workspace-1",
          placement,
          schedule: { kind: "manual", timezone: "UTC" },
          model: { providerId: null, modelId: null, agent: null },
          maximumRuntimeMs: 10_000,
          overlapPolicy: "skip",
          retryPolicy: { maximumAttempts: 1, delayMs: 0 },
          missedRunPolicy: {
            kind: "skip",
            graceMs: 0,
            maximumRecoverableOccurrences: 1,
          },
        },
        createdAt: 1,
        createdBy: "membership-1",
        reviewedAt: 1,
        reviewedBy: "membership-1",
      },
      grantRevision: {
        id: "grant-1",
        taskId: "task-1",
        revision: 1,
        taskRevisionId: "revision-1",
        workspaceId: "workspace-1",
        placement,
        placementIdentity: scheduledTaskPlacementIdentity(placement),
        filesystemScope: {
          kind: "den-worker-relative-roots",
          roots: ["."],
        },
        authorizedWorkspaceRoots: overrides?.absoluteRoot ? [overrides.absoluteRoot] : [],
        capabilityIds: ["workspace.files.read"],
        actionClasses: ["read"],
        filesystem: { read: true, write: false },
        maximumRuntimeMs: 10_000,
        model: { providerId: null, modelId: null, agent: null },
        communicationPolicy: "deny",
        destructiveActionPolicy: "deny",
        selfModificationPolicy: "deny",
        grantor: "membership-1",
        reviewedAt: 1,
        expiresAt: null,
        revokedAt: null,
        revocationReason: null,
        createdAt: 1,
      },
    },
  });
}

function completionRun(result: ScheduledTaskExecutionResult) {
  return {
    id: "run-1",
    taskId: "task-1",
    taskRevisionId: "revision-1",
    grantRevisionId: "grant-1",
    occurrenceId: "occurrence-1",
    trigger: "scheduled",
    status: result.status,
    scheduledFor: 1,
    claimedAt: 1,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    idempotencyKey: "scheduled:task-1:one",
    sessionId: result.sessionId,
    attemptCount: 1,
    boundedUsage: result.status === "completed"
      ? result.boundedUsage
      : { inputTokens: null, outputTokens: null, costMicros: null },
    error: result.status === "failed" || result.status === "cancelled" || result.status === "ambiguous"
      ? result.error
      : null,
    needsAttention: result.status === "needs-attention" ? result.attention : null,
    artifacts: result.status === "completed" ? result.artifacts : [],
    cancelRequestedAt: null,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("Den scheduled-task worker", () => {
  test("uses only the execution bearer and lease token, materializes roots, and sends ordered events", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-den-worker-"));
    roots.push(root);
    const canonicalRoot = await realpath(root);
    const localArtifact = join(canonicalRoot, "result.md");
    await writeFile(localArtifact, "portable result")
    const requests: Request[] = [];
    const claim = claimBody();
    const completedResults: ScheduledTaskExecutionResult[] = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      if (request.url.endsWith("/claim")) return Response.json(claim);
      if (request.url.endsWith("/heartbeat")) {
        return Response.json({ ok: true, leaseExpiresAt: 60_000, cancelRequestedAt: null });
      }
      if (request.url.endsWith("/events")) {
        return Response.json({ ok: true, duplicate: false });
      }
      const body = await request.json() as { result: ScheduledTaskExecutionResult };
      completedResults.push(body.result);
      return Response.json({
        ok: true,
        duplicate: false,
        run: completionRun(body.result),
      });
    };

    const outcome = await runDenScheduledTaskWorkerOnce({
      config: workerConfig(),
      serverConfig: serverConfig(root),
      fetchImpl,
      now: () => 10,
      execute: async ({ request, workspace, authorizedRoots, onEvent }) => {
        expect(request.taskRevision.definition.workspaceId).toBe("local-workspace");
        expect(request.grantRevision.authorizedWorkspaceRoots).toEqual([canonicalRoot]);
        expect(authorizedRoots).toEqual([canonicalRoot]);
        expect(workspace.path).toBe(canonicalRoot);
        await onEvent({ type: "session-created", at: 10, sessionId: "session-1" });
        await onEvent({ type: "running", at: 11, sessionId: "session-1" });
        return {
          status: "completed",
          sessionId: "session-1",
          artifacts: [{
            id: "artifact-1",
            kind: "file",
            value: localArtifact,
            name: null,
          }],
          boundedUsage: { inputTokens: 1, outputTokens: 2, costMicros: 3 },
        };
      },
    });

    expect(outcome).toEqual({ claimed: true });
    expect(completedResults[0]).toMatchObject({ status: "completed" });
    expect(completedResults[0]?.status === "completed" ? completedResults[0].artifacts : []).toEqual([{
      id: "artifact-1",
      kind: "file",
      value: "result.md",
      name: "result.md",
    }]);
    const bodies = await Promise.all(requests.map(async (request) => ({
      url: request.url,
      authorization: request.headers.get("authorization"),
      lease: request.headers.get("x-openwork-scheduled-task-lease"),
      body: await request.clone().json(),
    })));
    expect(bodies.every((request) => request.authorization === "Bearer execution-token-only")).toBe(true);
    expect(bodies.some((request) => request.authorization?.includes("host-token") ?? false)).toBe(false);
    expect(bodies.find((request) => request.url.endsWith("/claim"))?.lease).toBeNull();
    expect(bodies.filter((request) => !request.url.endsWith("/claim")).every(
      (request) => request.lease === "lease-token-with-at-least-thirty-two-bytes",
    )).toBe(true);
    expect(bodies.filter((request) => request.url.endsWith("/events")).map(
      (request) => (request.body as { sequence: number }).sequence,
    )).toEqual([1, 2]);
    expect(bodies.some((request) => request.url.endsWith("/heartbeat"))).toBe(true);
  });

  test("rejects local absolute roots from Den before invoking the executor", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-den-worker-invalid-"));
    roots.push(root);
    let invoked = false;
    const completedResults: ScheduledTaskExecutionResult[] = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/claim")) return Response.json(claimBody({ absoluteRoot: root }));
      const body = await request.json() as { result: ScheduledTaskExecutionResult };
      completedResults.push(body.result);
      return Response.json({
        ok: true,
        duplicate: false,
        run: completionRun(body.result),
      });
    };
    await runDenScheduledTaskWorkerOnce({
      config: workerConfig(),
      serverConfig: serverConfig(root),
      fetchImpl,
      execute: async () => {
        invoked = true;
        throw new Error("must not execute");
      },
    });
    expect(invoked).toBe(false);
    expect(completedResults[0]?.status).toBe("failed");
  });

  test("turns a lease heartbeat cancellation into a cancelled completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-den-worker-cancel-"));
    roots.push(root);
    const completedResults: ScheduledTaskExecutionResult[] = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/claim")) return Response.json(claimBody());
      if (request.url.endsWith("/heartbeat")) {
        return Response.json({ ok: true, leaseExpiresAt: 60_000, cancelRequestedAt: 20 });
      }
      const body = await request.json() as { result: ScheduledTaskExecutionResult };
      completedResults.push(body.result);
      return Response.json({
        ok: true,
        duplicate: false,
        run: completionRun(body.result),
      });
    };
    await runDenScheduledTaskWorkerOnce({
      config: workerConfig(),
      serverConfig: serverConfig(root),
      fetchImpl,
      now: () => 10,
      execute: async ({ signal }) => {
        if (!signal.aborted) {
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }));
        }
        return {
          status: "cancelled",
          sessionId: null,
          error: {
            code: "execution-failed",
            message: "Cancelled by Den.",
            retryable: false,
            ambiguous: false,
          },
        };
      },
    });
    expect(completedResults[0]?.status).toBe("cancelled");
    expect(completedResults[0]?.status === "cancelled" ? completedResults[0].error.code : null)
      .toBe("execution-failed");
  });

  test("aborts at the reviewed maximum runtime and reports a typed timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-den-worker-timeout-"));
    roots.push(root);
    const completedResults: ScheduledTaskExecutionResult[] = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/claim")) return Response.json(claimBody());
      if (request.url.endsWith("/heartbeat")) {
        return Response.json({ ok: true, leaseExpiresAt: 60_000, cancelRequestedAt: null });
      }
      const body = await request.json() as { result: ScheduledTaskExecutionResult };
      completedResults.push(body.result);
      return Response.json({
        ok: true,
        duplicate: false,
        run: completionRun(body.result),
      });
    };
    let scheduledDuration = 0;
    let timeoutCleared = false;
    let executorObservedAbort = false;

    await runDenScheduledTaskWorkerOnce({
      config: workerConfig(),
      serverConfig: serverConfig(root),
      fetchImpl,
      now: () => 10,
      scheduleExecutionTimeout(onTimeout, durationMs) {
        scheduledDuration = durationMs;
        queueMicrotask(onTimeout);
        return () => {
          timeoutCleared = true;
        };
      },
      execute: async ({ signal }) => {
        if (!signal.aborted) {
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }));
        }
        executorObservedAbort = signal.aborted;
        return {
          status: "cancelled",
          sessionId: "session-timeout",
          error: {
            code: "execution-failed",
            message: "Executor observed the abort.",
            retryable: false,
            ambiguous: false,
          },
        };
      },
    });

    expect(scheduledDuration).toBe(10_000);
    expect(executorObservedAbort).toBe(true);
    expect(timeoutCleared).toBe(true);
    expect(completedResults[0]).toEqual({
      status: "failed",
      sessionId: "session-timeout",
      error: {
        code: "execution-timed-out",
        message: "Scheduled task exceeded its maximum runtime",
        retryable: false,
        ambiguous: false,
      },
    });
  });
});
