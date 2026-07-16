/**
 * Internal Daytona proof: a configured worker returns after Daytona stop/start.
 *
 * Requires a disposable fixed sandbox created from the new snapshot. The flow is
 * app-less: evidence is command output plus bounded public /health probes.
 */
import { spawnSync } from "node:child_process";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "daytona-worker-restart-readiness";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const requiredEnv = [
  ["DAYTONA_WORKER_RESTART_SANDBOX_NAME", "Daytona sandbox name or id to stop/start"],
  ["DAYTONA_WORKER_RESTART_HEALTH_URL", "Public Daytona worker /health URL to poll"],
];

function requireFlowEnv() {
  const values = new Map();
  const missing = [];
  for (const [name, description] of requiredEnv) {
    const value = process.env[name]?.trim();
    if (!value) {
      missing.push(`- ${name}: ${description}`);
    } else {
      values.set(name, value);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing env for ${FLOW_ID}:\n${missing.join("\n")}`);
  }

  return {
    sandboxName: values.get("DAYTONA_WORKER_RESTART_SANDBOX_NAME"),
    healthUrl: normalizeHealthUrl(values.get("DAYTONA_WORKER_RESTART_HEALTH_URL")),
  };
}

function normalizeHealthUrl(value) {
  return value.replace(/\/+$/, "").endsWith("/health") ? value.replace(/\/+$/, "") : `${value.replace(/\/+$/, "")}/health`;
}

function runCommand(command, args, timeout = 120_000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    timeout,
  });
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    error: result.error?.message ?? "",
  };
}

function commandOutput(result) {
  return [
    `$ ${result.command}`,
    `status: ${result.status}`,
    result.stdout ? `stdout:\n${result.stdout}` : "stdout: <empty>",
    result.stderr ? `stderr:\n${result.stderr}` : "stderr: <empty>",
    result.error ? `error: ${result.error}` : "",
  ].filter(Boolean).join("\n");
}

function witness(ctx, condition, assertion, actual) {
  if (!condition) {
    ctx.recordEvidence({ type: "assertion", status: "failed", assertion, actual });
    ctx.assert(false, assertion + (actual ? ` (actual: ${actual})` : ""));
  }
  ctx.recordEvidence({ type: "assertion", status: "passed", assertion, actual });
}

async function fetchHealth(url, requestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { method: "GET", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function pollHealth(url, timeoutMs) {
  const startedAt = Date.now();
  let last = "no probe completed";
  while (Date.now() - startedAt < timeoutMs) {
    const requestTimeoutMs = Math.min(10_000, Math.max(1, timeoutMs - (Date.now() - startedAt)));
    try {
      const response = await fetchHealth(url, requestTimeoutMs);
      last = `HTTP ${response.status}`;
      if (response.ok) {
        return { ok: true, last, elapsedMs: Date.now() - startedAt };
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return { ok: false, last, elapsedMs: Date.now() - startedAt };
}

function sandboxState(record) {
  if (!record) {
    return "missing";
  }
  if (typeof record.state === "string") {
    return record.state.toLowerCase();
  }
  if (typeof record.status === "string") {
    return record.status.toLowerCase();
  }
  return "unknown";
}

function summaryField(record, key) {
  const value = record?.[key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "<unset>";
}

function snapshotSummary(record) {
  const snapshot = record?.snapshot;
  if (typeof snapshot === "string" || typeof snapshot === "number") {
    return String(snapshot);
  }
  if (snapshot && typeof snapshot === "object") {
    const name = summaryField(snapshot, "name");
    const id = summaryField(snapshot, "id");
    return name !== "<unset>" ? name : id;
  }
  return "<unset>";
}

function sanitizeWarning(value) {
  return value
    .replace(/["']?(?:OPENWORK_TOKEN|OPENWORK_HOST_TOKEN|DEN_ACTIVITY_HEARTBEAT_TOKEN)["']?\s*[:=]\s*["']?[^"',\s}]+["']?/g, "[redacted-secret]")
    .replace(/OPENWORK_TOKEN|OPENWORK_HOST_TOKEN|DEN_ACTIVITY_HEARTBEAT_TOKEN/g, "[redacted-secret-key]")
    .slice(0, 1000);
}

function sanitizedInfoOutput(result, record, parseError = "") {
  const lines = [
    `$ ${result.command}`,
    `status: ${result.status}`,
    `sandbox: id=${summaryField(record, "id")} name=${summaryField(record, "name")} state=${summaryField(record, "state")} desiredState=${summaryField(record, "desiredState")} snapshot=${snapshotSummary(record)}`,
  ];
  if (result.stderr) {
    lines.push(`warnings:\n${sanitizeWarning(result.stderr)}`);
  }
  if (result.error) {
    lines.push(`error: ${sanitizeWarning(result.error)}`);
  }
  if (parseError) {
    lines.push(`parse_error: ${sanitizeWarning(parseError)}`);
    lines.push(`stdout: <unparsed redacted JSON; ${result.stdout.length} chars>`);
  } else if (result.stdout) {
    lines.push(`stdout: <parsed and sanitized; ${result.stdout.length} chars>`);
  } else {
    lines.push("stdout: <empty>");
  }
  return lines.join("\n");
}

function assertInfoOutputStaysSanitized() {
  const output = sanitizedInfoOutput(
    {
      command: "daytona info sandbox --format json",
      status: 0,
      stdout: JSON.stringify({ id: "sandbox", name: "sandbox", state: "stopped", env: { PRIVATE: "secret-value" } }),
      stderr: "",
      error: "",
    },
    { id: "sandbox", name: "sandbox", state: "stopped", env: { PRIVATE: "secret-value" } },
  );
  if (output.includes("PRIVATE") || output.includes("secret-value") || output.includes("env")) {
    throw new Error("Daytona info evidence sanitizer leaked an unknown field");
  }
}

assertInfoOutputStaysSanitized();

function infoSandbox(sandboxName) {
  const result = runCommand("daytona", ["info", sandboxName, "--format", "json"], 60_000);
  if (result.status !== 0 || !result.stdout) {
    return { record: null, output: sanitizedInfoOutput(result, null) };
  }
  try {
    const record = JSON.parse(result.stdout);
    return { record, output: sanitizedInfoOutput(result, record) };
  } catch (error) {
    return { record: null, output: sanitizedInfoOutput(result, null, error instanceof Error ? error.message : String(error)) };
  }
}

async function pollStopped(sandboxName, timeoutMs) {
  const startedAt = Date.now();
  let lastState = "unknown";
  const evidence = [];
  while (Date.now() - startedAt < timeoutMs) {
    const info = infoSandbox(sandboxName);
    evidence.push(info.output);
    lastState = sandboxState(info.record);
    if (lastState.includes("stopped")) {
      return { stopped: true, lastState, elapsedMs: Date.now() - startedAt, evidence };
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return { stopped: false, lastState, elapsedMs: Date.now() - startedAt, evidence };
}

export default {
  id: FLOW_ID,
  title: "Daytona production worker restarts from container startup",
  kind: "internal",
  requiresApp: false,
  steps: [
    {
      name: "Initial worker health is served publicly",
      run: async (ctx) => {
        const { healthUrl } = requireFlowEnv();
        await ctx.prove("The configured Daytona worker is healthy before restart", {
          voiceover: vo[0],
          assert: async () => {
            const health = await pollHealth(healthUrl, 60_000);
            witness(ctx, health.ok, "Public Daytona /health returned 2xx before stop/start", `${health.last} after ${health.elapsedMs}ms`);
            ctx.output("initial-health", `GET ${healthUrl}\n${health.last}\nelapsed_ms=${health.elapsedMs}`);
          },
        });
      },
    },
    {
      name: "Same worker returns after Daytona stop/start without manual relaunch",
      run: async (ctx) => {
        const { sandboxName, healthUrl } = requireFlowEnv();
        await ctx.prove("The worker returns automatically after Daytona stop/start", {
          voiceover: vo[1],
          action: async () => {
            const stop = runCommand("daytona", ["stop", sandboxName], 120_000);
            ctx.output("daytona-stop", commandOutput(stop));
            witness(ctx, stop.status === 0, "daytona stop exited 0", String(stop.status));

            const stopped = await pollStopped(sandboxName, 180_000);
            ctx.output("daytona-stopped-poll", stopped.evidence.slice(-6).join("\n\n"));
            witness(ctx, stopped.stopped, "Daytona reported the sandbox fully stopped", `${stopped.lastState} after ${stopped.elapsedMs}ms`);

            const start = runCommand("daytona", ["start", sandboxName], 120_000);
            ctx.output("daytona-start", commandOutput(start));
            witness(ctx, start.status === 0, "daytona start exited 0", String(start.status));
          },
          assert: async () => {
            const health = await pollHealth(healthUrl, 240_000);
            witness(ctx, health.ok, "Public Daytona /health returned 2xx after start without a manual openwork relaunch", `${health.last} after ${health.elapsedMs}ms`);
            ctx.output("post-start-health", `GET ${healthUrl}\n${health.last}\nelapsed_ms=${health.elapsedMs}\nmanual_relaunch_command=<none>`);
          },
        });
      },
    },
  ],
};
