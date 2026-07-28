/**
 * Scheduled Tasks end-to-end proof.
 *
 * The flow starts from a real chat request, crosses the disabled proposal
 * receipt and human authority boundary, then proves run receipts,
 * idempotent deterministic ticks, restart recovery, needs-attention, and
 * pause behavior against server ground truth.
 */
import { mkdir } from "node:fs/promises";

import { defineFlow, type FlowContext } from "../runner/flow.ts";

const REQUEST = [
  "Propose a Scheduled Task draft named EVAL daily workspace report.",
  "Run it daily at 09:00 in Europe/Berlin.",
  "Use a fresh session to inspect this workspace and write a concise report to scheduled-task-eval-report.md.",
  "Do not approve authority or enable it.",
].join(" ");

type FlowState = {
  workspaceId: string;
  taskId: string;
  runId: string;
  manualSessionId: string;
  manualArtifactId: string;
  firstScheduledRunCount: number;
  deterministicNow: number;
};

const state: FlowState = {
  workspaceId: "",
  taskId: "",
  runId: "",
  manualSessionId: "",
  manualArtifactId: "",
  firstScheduledRunCount: 0,
  deterministicNow: 0,
};

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is missing.`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} is missing.`);
  }
  return value;
}

async function serverRead(ctx: FlowContext, path: string): Promise<unknown> {
  return ctx.eval(`(async () => {
    const override = localStorage.getItem("openwork.server.urlOverride");
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token") || "";
    const baseUrl = (override || (port ? "http://127.0.0.1:" + port : "")).replace(/\\/+$/, "");
    if (!baseUrl) throw new Error("OpenWork server URL is unavailable");
    const response = await fetch(baseUrl + ${JSON.stringify(path)}, {
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) throw new Error("GET ${path} failed: " + response.status + " " + text);
    return payload;
  })()`, { awaitPromise: true });
}

async function serverDownload(
  ctx: FlowContext,
  path: string,
): Promise<{ status: number; text: string }> {
  return ctx.eval(`(async () => {
    const override = localStorage.getItem("openwork.server.urlOverride");
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token") || "";
    const baseUrl = (override || (port ? "http://127.0.0.1:" + port : "")).replace(/\\/+$/, "");
    if (!baseUrl) throw new Error("OpenWork server URL is unavailable");
    const response = await fetch(baseUrl + ${JSON.stringify(path)}, {
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
    return {
      status: response.status,
      text: await response.text(),
    };
  })()`, { awaitPromise: true }) as Promise<{
    status: number;
    text: string;
  }>;
}

function recordValue(record: unknown, key: string): unknown {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return undefined;
  return Reflect.get(record, key);
}

function arrayValue(record: unknown, key: string): unknown[] {
  const value = recordValue(record, key);
  return Array.isArray(value) ? value : [];
}

async function readDetail(ctx: FlowContext): Promise<unknown> {
  return serverRead(
    ctx,
    `/workspace/${encodeURIComponent(state.workspaceId)}/scheduled-tasks/${encodeURIComponent(state.taskId)}`,
  );
}

async function waitForRunCount(
  ctx: FlowContext,
  predicate: (runs: unknown[]) => boolean,
  label: string,
  timeoutMs = 180_000,
): Promise<unknown[]> {
  const deadline = Date.now() + timeoutMs;
  let runs: unknown[] = [];
  while (Date.now() < deadline) {
    const detail = await readDetail(ctx);
    runs = arrayValue(detail, "runs");
    if (predicate(runs)) return runs;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${label}: ${JSON.stringify(runs)}`);
}

function runStatus(run: unknown) {
  const status = recordValue(run, "status");
  return typeof status === "string" ? status : "";
}

function runTrigger(run: unknown) {
  const trigger = recordValue(run, "trigger");
  return typeof trigger === "string" ? trigger : "";
}

async function finishPendingWorkspaceOnboarding(ctx: FlowContext) {
  const providerStep = await ctx.eval(`Boolean([...document.querySelectorAll("button")]
    .find((button) => button.textContent?.includes("Skip and use the free model")))`);
  if (providerStep) {
    await ctx.clickText("Skip and use the free model", {
      selector: "button",
      timeoutMs: 10_000,
    });
    await ctx.waitFor(`location.hash.includes("/workspace/")
      || [...document.querySelectorAll("button")]
        .some((button) => button.textContent?.trim() === "Skip")`, {
      timeoutMs: 10_000,
      label: "attribution step after provider selection",
    });
  }

  const attributionStep = await ctx.eval(`Boolean([...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "Skip"))`);
  if (attributionStep) {
    await ctx.clickText("Skip", {
      selector: "button",
      timeoutMs: 10_000,
    });
  }
}

export default defineFlow({
  id: "scheduled-tasks-e2e",
  title: "Scheduled Tasks are proposed, reviewed, run, recovered, and paused safely",
  kind: "user-facing",
  spec: "SCHEDULED-TASKS",
  requiredEnv: ["OPENWORK_EVAL_WORKSPACE_PATH"],
  requiresApp: true,
  steps: [
    {
      name: "A workspace conversation and semantic control surface are ready",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", {
          timeoutMs: 30_000,
          label: "OpenWork semantic control",
        });
        const workspacePath = requireString(
          ctx.env.OPENWORK_EVAL_WORKSPACE_PATH,
          "OPENWORK_EVAL_WORKSPACE_PATH",
        );
        await mkdir(workspacePath, { recursive: true });
        await finishPendingWorkspaceOnboarding(ctx);

        let workspaceId = await ctx.eval(`(() => {
          const context = window.__openworkControl.context();
          return context.screen.workspaceId || context.resources
            .find((resource) => resource.kind === "workspace")?.ref.replace(/^workspace:/, "") || "";
        })()`);
        if (!workspaceId) {
          const welcomeInput = 'input[placeholder="/workspace/my-project"]';
          const onWelcome = await ctx.eval(
            `Boolean(document.querySelector(${JSON.stringify(welcomeInput)}))`,
          );
          if (onWelcome) {
            await ctx.fill(welcomeInput, workspacePath);
            await ctx.clickText("Use this folder", {
              selector: "button",
              timeoutMs: 10_000,
            });
          } else {
            await ctx.waitFor(
              "window.__openworkControl.listActions().some((action) => action.id === 'workspace.create' && !action.disabled)",
              { timeoutMs: 30_000, label: "workspace.create" },
            );
            await ctx.control("workspace.create", {
              path: workspacePath,
              projectLabel: "Scheduled Tasks eval",
            });
          }
          await ctx.waitFor(`location.hash.includes("/workspace/")
            || [...document.querySelectorAll("button")]
              .some((button) => button.textContent?.includes("Skip and use the free model"))`, {
            timeoutMs: 60_000,
            label: "Scheduled Tasks workspace or provider step",
          });
          await finishPendingWorkspaceOnboarding(ctx);
          await ctx.waitFor("location.hash.includes('/workspace/')", {
            timeoutMs: 60_000,
            label: "Scheduled Tasks eval workspace route",
          });
          workspaceId = await ctx.waitFor(`(() => {
            const context = window.__openworkControl.context();
            return context.screen.workspaceId || context.resources
              .find((resource) => resource.kind === "workspace")?.ref.replace(/^workspace:/, "") || null;
          })()`, {
            timeoutMs: 60_000,
            label: "Scheduled Tasks eval workspace context",
          });
        }
        state.workspaceId = requireString(workspaceId, "workspaceId");
        const composerReady = await ctx.eval(
          "window.__openworkControl.listActions().some((action) => action.id === 'composer.set_text' && !action.disabled)",
        );
        if (!composerReady) {
          await ctx.waitFor(
            "window.__openworkControl.listActions().some((action) => action.id === 'session.create_task' && !action.disabled)",
            { timeoutMs: 30_000, label: "session.create_task" },
          );
          await ctx.control("session.create_task");
        }
        await ctx.waitFor(
          "window.__openworkControl.listActions().some((action) => action.id === 'composer.set_text' && !action.disabled)",
          { timeoutMs: 60_000, label: "composer.set_text" },
        );
      },
    },
    {
      name: "Plain language creates only a disabled proposal receipt",
      run: async (ctx) => {
        await ctx.prove("Natural language creates a disabled Scheduled Task draft without crossing the authority boundary", {
          action: async () => {
            await ctx.control("composer.set_text", { text: REQUEST });
            await ctx.control("composer.send");
            await ctx.waitFor(
              "Boolean(document.querySelector('[data-openwork-scheduled-task-proposal-card]'))",
              { timeoutMs: 180_000, label: "Scheduled Task proposal receipt" },
            );
            const taskId = await ctx.eval(
              "document.querySelector('[data-openwork-scheduled-task-proposal-card]')?.getAttribute('data-scheduled-task-id')",
            );
            state.taskId = requireString(taskId, "proposal taskId");
          },
          assert: async () => {
            const detail = await readDetail(ctx);
            const task = recordValue(detail, "task");
            ctx.assert(recordValue(task, "state") === "draft", "Proposal must remain a draft.");
            ctx.assert(recordValue(task, "enabled") === false, "Proposal must remain disabled.");
            ctx.assert(recordValue(detail, "grant") === null, "Proposal must not create an authority grant.");
          },
          screenshot: {
            name: "scheduled-task-proposal",
            requireText: [
              "Scheduled Task draft proposed",
              "Disabled",
              "Review required",
              "Runs while OpenWork is running.",
            ],
            rejectText: ["Enabled"],
          },
        });
      },
    },
    {
      name: "The draft exposes the complete review and five-occurrence preview",
      run: async (ctx) => {
        await ctx.trustedClick(`[data-open-scheduled-task-proposal="${state.taskId}"]`);
        await ctx.waitFor(
          `Boolean(document.querySelector('[data-testid="scheduled-task-detail"]')) && location.hash.includes(${JSON.stringify(state.taskId)})`,
          { timeoutMs: 30_000, label: "Scheduled Task detail" },
        );
        await ctx.waitFor(
          "document.querySelectorAll('[data-testid=\"scheduled-task-detail-preview\"] > li').length === 5",
          { timeoutMs: 30_000, label: "five schedule preview occurrences" },
        );
        await ctx.prove("Review shows schedule, timezone, prompt, model/agent, timeout, authority, and the running-app limitation", {
          action: async () => {
            await ctx.fill(
              "[data-testid='scheduled-task-capabilities']",
              "workspace.files.read\nworkspace.files.write",
            );
            await ctx.trustedClick("[data-action-class='write']");
            await ctx.trustedClick("[data-filesystem-write]");
            await ctx.trustedClick("[data-testid='scheduled-task-review-authority']");
            await ctx.waitFor(
              "!document.querySelector('[data-testid=\"scheduled-task-enable\"]')?.disabled",
              { timeoutMs: 30_000, label: "enable after authority review" },
            );
          },
          assert: async () => {
            const detail = await readDetail(ctx);
            ctx.assert(recordValue(detail, "grant") !== null, "Authority review must create a grant.");
            const task = recordValue(detail, "task");
            ctx.assert(recordValue(task, "enabled") === false, "Authority review must not implicitly enable.");
            const previewCount = await ctx.eval(
              "document.querySelectorAll('[data-testid=\"scheduled-task-detail-preview\"] > li').length",
            );
            ctx.assert(previewCount === 5, `Expected five preview occurrences, got ${String(previewCount)}`);
          },
          screenshot: {
            name: "scheduled-task-authority-review",
            requireText: [
              "Europe/Berlin",
              "Authority review",
              "Communication",
              "Denied",
              "Runs while OpenWork is running.",
            ],
          },
        });
      },
    },
    {
      name: "Run once creates a fresh session and durable receipt links",
      run: async (ctx) => {
        const before = arrayValue(await readDetail(ctx), "runs").length;
        await ctx.trustedClick("[data-testid='scheduled-task-run-once']");
        const runs = await waitForRunCount(
          ctx,
          (items) => items.length === before + 1,
          "Manual run was not created",
        );
        const run = runs[0];
        state.runId = requireString(recordValue(run, "id"), "manual runId");
        await ctx.waitFor(
          `Boolean(document.querySelector('[data-scheduled-task-run="${state.runId}"]'))`,
          { timeoutMs: 30_000, label: "manual run history row" },
        );
        await ctx.prove("Run once is bound to its exact fresh session, status timeline, and artifacts", {
          assert: async () => {
            const latestRuns = await waitForRunCount(
              ctx,
              (items) => items.some(
                (item) =>
                  recordValue(item, "id") === state.runId
                  && runStatus(item) === "completed",
              ),
              "Manual run did not complete",
            );
            const latest = latestRuns.find((item) => recordValue(item, "id") === state.runId);
            state.manualSessionId = requireString(
              recordValue(latest, "sessionId"),
              "manual sessionId",
            );
            const receipt = await serverRead(
              ctx,
              `/workspace/${encodeURIComponent(state.workspaceId)}/scheduled-tasks/${encodeURIComponent(state.taskId)}/runs/${encodeURIComponent(state.runId)}`,
            );
            ctx.assert(recordValue(receipt, "taskRevision") !== null, "Receipt must bind the task revision.");
            ctx.assert(recordValue(receipt, "grantRevision") !== null, "Receipt must bind the grant revision.");
            const attempts = arrayValue(receipt, "attempts");
            ctx.assert(attempts.length >= 1, "Receipt must bind at least one immutable attempt.");
            ctx.assert(
              typeof recordValue(recordValue(receipt, "run"), "idempotencyKey") === "string",
              "Receipt must bind the idempotency identity.",
            );
            const artifacts = arrayValue(receipt, "artifacts");
            ctx.assert(artifacts.length >= 1, "Receipt must include a produced artifact.");
            const artifact = artifacts.find(
              (candidate) =>
                recordValue(candidate, "kind") === "file"
                && String(recordValue(candidate, "value")).endsWith(
                  "scheduled-task-eval-report.md",
                ),
            );
            state.manualArtifactId = requireString(
              recordValue(artifact, "id"),
              "manual artifactId",
            );
            ctx.assert(
              recordValue(artifact, "name") === "scheduled-task-eval-report.md",
              "The immutable receipt must preserve the reviewed artifact filename.",
            );

            const transcript = await serverRead(
              ctx,
              `/workspace/${encodeURIComponent(state.workspaceId)}/sessions/${encodeURIComponent(state.manualSessionId)}/messages`,
            );
            ctx.assert(
              arrayValue(transcript, "items").some(
                (message) => recordValue(recordValue(message, "info"), "role") === "assistant",
              ),
              "The linked fresh session must contain an assistant transcript.",
            );

            await ctx.trustedClick(
              `[data-open-scheduled-task-session="${state.manualSessionId}"]`,
            );
            await ctx.waitFor(
              `location.hash.includes(${JSON.stringify(state.manualSessionId)})`,
              { timeoutMs: 30_000, label: "linked Scheduled Task session" },
            );
            await ctx.navigateHash(
              workspaceScheduledRoute(state.workspaceId, state.taskId),
            );
            await ctx.waitFor(
              "Boolean(document.querySelector('[data-testid=\"scheduled-task-detail\"]'))",
              { timeoutMs: 30_000, label: "Scheduled Task detail after transcript" },
            );

            const artifactPath =
              `/workspace/${encodeURIComponent(state.workspaceId)}`
              + `/scheduled-tasks/${encodeURIComponent(state.taskId)}`
              + `/runs/${encodeURIComponent(state.runId)}`
              + `/artifacts/${encodeURIComponent(state.manualArtifactId)}`;
            const downloaded = await serverDownload(ctx, artifactPath);
            ctx.assert(downloaded.status === 200, "The exact receipt artifact must download.");
            ctx.assert(downloaded.text.trim().length > 0, "The downloaded artifact must not be empty.");
            await ctx.trustedClick(
              `[data-scheduled-task-artifact="${state.manualArtifactId}"]`,
            );
          },
          screenshot: {
            name: "scheduled-task-run-receipt",
            requireText: ["Run history and timeline", "Claimed"],
          },
        });
      },
    },
    {
      name: "Enable and deterministic tick claim exactly one occurrence",
      run: async (ctx) => {
        await ctx.trustedClick("[data-testid='scheduled-task-enable']");
        await ctx.waitFor(
          "document.body.innerText.includes('Enabled')",
          { timeoutMs: 30_000, label: "enabled state" },
        );
        const detail = await readDetail(ctx);
        const task = recordValue(detail, "task");
        state.deterministicNow = requireNumber(recordValue(task, "nextRunAt"), "nextRunAt");
        const beforeRuns = arrayValue(detail, "runs");
        state.firstScheduledRunCount = beforeRuns.filter((run) => runTrigger(run) === "scheduled").length;

        const tick = await ctx.control("eval.scheduled_tasks.tick", { now: state.deterministicNow });
        const claimed = arrayValue(tick, "claimedRunIds");
        ctx.assert(claimed.length === 1, `Expected exactly one claimed run, got ${JSON.stringify(claimed)}`);
        const scheduledRuns = await waitForRunCount(
          ctx,
          (runs) =>
            runs.filter(
              (run) =>
                runTrigger(run) === "scheduled"
                && runStatus(run) === "completed",
            ).length === state.firstScheduledRunCount + 1,
          "Scheduled occurrence did not complete",
        );
        const completedScheduled = scheduledRuns.find(
          (run) =>
            runTrigger(run) === "scheduled"
            && runStatus(run) === "completed",
        );
        const scheduledSessionId = requireString(
          recordValue(completedScheduled, "sessionId"),
          "scheduled sessionId",
        );
        ctx.assert(
          scheduledSessionId !== state.manualSessionId,
          "Each attempt must own a fresh session.",
        );
        ctx.assert(
          arrayValue(completedScheduled, "artifacts").length >= 1,
          "The scheduled execution must persist its produced artifact.",
        );

        await ctx.control("eval.scheduled_tasks.tick", { now: state.deterministicNow });
        const afterRepeat = arrayValue(await readDetail(ctx), "runs");
        ctx.assert(
          afterRepeat.filter((run) => runTrigger(run) === "scheduled").length === state.firstScheduledRunCount + 1,
          "Repeating the same deterministic tick created a duplicate.",
        );
      },
    },
    {
      name: "Restart preserves idempotency and the exact durable task state",
      run: async (ctx) => {
        try {
          await ctx.control("eval.app.relaunch");
        } catch (error) {
          ctx.log(
            `eval.app.relaunch disconnected during the expected Electron handoff: ${String(error)}`,
          );
        }
        await ctx.reconnect({ timeoutMs: 60_000 });
        await ctx.navigateHash(workspaceScheduledRoute(state.workspaceId, state.taskId));
        await ctx.waitFor(
          "Boolean(window.__openworkControl) && Boolean(document.querySelector('[data-testid=\"scheduled-task-detail\"]'))",
          { timeoutMs: 60_000, label: "Scheduled Task after restart" },
        );
        await ctx.control("eval.scheduled_tasks.tick", { now: state.deterministicNow });
        const runs = arrayValue(await readDetail(ctx), "runs");
        ctx.assert(
          runs.filter((run) => runTrigger(run) === "scheduled").length === state.firstScheduledRunCount + 1,
          "Restart replay created a duplicate occurrence.",
        );
      },
    },
    {
      name: "Denied unattended approval becomes needs-attention and pause blocks claims",
      run: async (ctx) => {
        await ctx.fill(
          "[data-testid='scheduled-task-capabilities']",
          "workspace.files.read",
        );
        await ctx.trustedClick("[data-action-class='write']");
        await ctx.trustedClick("[data-filesystem-write]");
        await ctx.trustedClick("[data-testid='scheduled-task-review-authority']");
        const existingRunIds = new Set(
          arrayValue(await readDetail(ctx), "runs")
            .map((run) => recordValue(run, "id"))
            .filter((id): id is string => typeof id === "string"),
        );
        await ctx.trustedClick("[data-testid='scheduled-task-run-once']");
        const runs = await waitForRunCount(
          ctx,
          (items) => items.some(
            (run) =>
              runStatus(run) === "needs-attention"
              && typeof recordValue(run, "id") === "string"
              && !existingRunIds.has(recordValue(run, "id") as string),
          ),
          "Expected the write request under read-only authority to require attention",
        );
        ctx.assert(
          runs.some(
            (run) =>
              runStatus(run) === "needs-attention"
              && typeof recordValue(run, "id") === "string"
              && !existingRunIds.has(recordValue(run, "id") as string),
          ),
          "The newly denied unattended run must become needs-attention.",
        );
        await ctx.screenshot("scheduled-task-needs-attention", {
          claim:
            "A denied unattended workspace write stops the run and asks the owner to repair authority.",
          requireText: [
            "Needs attention",
            "Runs while OpenWork is running.",
          ],
        });

        await ctx.fill(
          "[data-testid='scheduled-task-capabilities']",
          "workspace.files.read\nworkspace.files.write",
        );
        await ctx.trustedClick("[data-action-class='write']");
        await ctx.trustedClick("[data-filesystem-write]");
        await ctx.trustedClick("[data-testid='scheduled-task-review-authority']");
        await ctx.waitFor(
          "Boolean(document.querySelector('[data-testid=\"scheduled-task-resume\"]'))",
          { timeoutMs: 30_000, label: "resume after repaired authority" },
        );
        await ctx.trustedClick("[data-testid='scheduled-task-resume']");
        await ctx.waitFor(
          "document.body.innerText.includes('Enabled')",
          { timeoutMs: 30_000, label: "re-enabled after repair" },
        );
        const repaired = await readDetail(ctx);
        const genuinelyDueAt = requireNumber(
          recordValue(recordValue(repaired, "task"), "nextRunAt"),
          "repaired nextRunAt",
        );
        await ctx.trustedClick("[data-testid='scheduled-task-pause']");
        await ctx.waitFor(
          "document.body.innerText.includes('Paused')",
          { timeoutMs: 30_000, label: "paused state" },
        );
        const before = arrayValue(await readDetail(ctx), "runs").length;
        await ctx.control("eval.scheduled_tasks.tick", { now: genuinelyDueAt });
        const after = arrayValue(await readDetail(ctx), "runs").length;
        ctx.assert(after === before, `Paused task claimed a run: ${before} -> ${after}`);
        await ctx.screenshot("scheduled-task-paused-needs-attention", {
          claim:
            "After authority repair and resume, pausing the task prevents a genuinely due occurrence from being claimed.",
          requireText: ["Paused", "Runs while OpenWork is running."],
        });
      },
    },
  ],
});

function workspaceScheduledRoute(workspaceId: string, taskId: string) {
  return `/workspace/${encodeURIComponent(workspaceId)}/scheduled-tasks/${encodeURIComponent(taskId)}`;
}
