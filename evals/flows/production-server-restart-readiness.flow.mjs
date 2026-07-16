/**
 * Internal demo: production `openwork serve` keeps waiting through a slow
 * OpenCode cold start. Daytona is only the execution environment; this flow
 * does not provision or mutate Daytona images.
 */
import { spawnSync } from "node:child_process";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "production-server-restart-readiness";
const vo = await loadVoiceoverParagraphs(FLOW_ID);
const OLD_STARTUP_BOUNDARY_SECONDS = 10;
const DELAYED_OPENCODE_SECONDS = 12;
const POST_SERVE_DELAY_CHECK_SECONDS = OLD_STARTUP_BOUNDARY_SECONDS + 1;

function redact(text) {
  return String(text)
    .replace(/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s]+/gi, "$1<redacted>")
    .replace(/(OPENWORK_(?:HOST_)?TOKEN=)[^\s]+/g, "$1<redacted>")
    .replace(/([?&](?:token|access_token|ownerToken|hostToken)=)[^&\s]+/gi, "$1<redacted>");
}

function runInSandbox(ctx, script, timeout = 120_000) {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  const result = spawnSync(
    "daytona",
    [
      "exec",
      ctx.env.OPENWORK_EVAL_DAYTONA_SANDBOX,
      "--",
      "echo",
      encoded,
      "|",
      "base64",
      "-d",
      "|",
      "bash",
    ],
    { encoding: "utf8", timeout },
  );
  const output = redact(`${result.stdout || ""}${result.stderr || ""}`);
  if (result.status !== 0) {
    throw new Error(`Daytona command failed (${result.status ?? "signal"}): ${output.trim()}`);
  }
  if (!output.trim()) {
    throw new Error("Daytona command produced no output");
  }
  return output;
}

function record(ctx, condition, assertion, actual = "") {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual: redact(actual),
  });
  ctx.assert(condition, `${assertion}${actual ? ` (actual: ${redact(actual)})` : ""}`);
}

function healthUrl(value) {
  const trimmed = value.trim().replace(/\/$/, "");
  return trimmed.endsWith("/health") ? trimmed : `${trimmed}/health`;
}

async function waitForPublicHealth(url, timeoutMs = 75_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "not checked";
  while (Date.now() < deadline) {
    const remaining = Math.max(1, Math.min(2_000, deadline - Date.now()));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(remaining) });
      last = `HTTP ${response.status}`;
      if (response.ok) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(`Public health never became ready: ${redact(last)}`);
}

export default {
  id: FLOW_ID,
  title: "Production openwork serve waits through slow OpenCode readiness",
  kind: "internal",
  requiresApp: false,
  requiredEnv: [
    "OPENWORK_EVAL_DAYTONA_SANDBOX",
    "OPENWORK_EVAL_OPENWORK_BIN",
    "OPENWORK_EVAL_OPENWORK_PUBLIC_HEALTH_URL",
  ],
  steps: [
    {
      name: "The production process is alive after the old ten-second boundary",
      run: async (ctx) => {
        await ctx.prove("A twelve-second OpenCode cold start no longer exits `openwork serve` at ten seconds", {
          voiceover: vo[0],
          assert: async () => {
            const port = ctx.env.OPENWORK_EVAL_OPENWORK_PORT || "8787";
            const opencodeBin = ctx.env.OPENWORK_EVAL_OPENCODE_BIN || "opencode";
            const output = runInSandbox(ctx, `
set -euo pipefail
RUN_DIR=/tmp/openwork-production-server-restart-readiness
OPENWORK_BIN=${JSON.stringify(ctx.env.OPENWORK_EVAL_OPENWORK_BIN)}
OPENCODE_BIN_INPUT=${JSON.stringify(opencodeBin)}
PORT=${JSON.stringify(port)}
if [ -f "$RUN_DIR/openwork.pid" ]; then
  OLD_PID="$(cat "$RUN_DIR/openwork.pid" || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then kill "$OLD_PID" 2>/dev/null || true; fi
fi
rm -rf "$RUN_DIR"
mkdir -p "$RUN_DIR/workspace"
test -x "$OPENWORK_BIN"
if [[ "$OPENCODE_BIN_INPUT" = */* ]]; then
  REAL_OPENCODE="$OPENCODE_BIN_INPUT"
else
  REAL_OPENCODE="$(command -v "$OPENCODE_BIN_INPUT")"
fi
test -x "$REAL_OPENCODE"
cat > "$RUN_DIR/slow-opencode" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
MARKER="\${OPENWORK_EVAL_WRAPPER_MARKER:?}"
REAL_OPENCODE="\${OPENWORK_EVAL_REAL_OPENCODE:?}"
DELAY_SECONDS="\${OPENWORK_EVAL_OPENCODE_DELAY_SECONDS:?}"
FIRST="\${1:-<none>}"
if [ "$FIRST" = "serve" ]; then
  START_TS="$(date +%s)"
  printf 'CALL first=serve delay=%s\n' "$DELAY_SECONDS" >> "$MARKER"
  sleep "$DELAY_SECONDS"
  END_TS="$(date +%s)"
  printf 'DELAYED first=serve requested=%s elapsed=%s\n' "$DELAY_SECONDS" "$((END_TS - START_TS))" >> "$MARKER"
else
  printf 'CALL first=%s delay=0\n' "$FIRST" >> "$MARKER"
fi
exec "$REAL_OPENCODE" "$@"
WRAPPER
chmod +x "$RUN_DIR/slow-opencode"
OPENWORK_EVAL_WRAPPER_MARKER="$RUN_DIR/wrapper-invocations.log" \
OPENWORK_EVAL_REAL_OPENCODE="$REAL_OPENCODE" \
OPENWORK_EVAL_OPENCODE_DELAY_SECONDS="${DELAYED_OPENCODE_SECONDS}" \
OPENWORK_TOKEN=eval-client-token OPENWORK_HOST_TOKEN=eval-host-token nohup "$OPENWORK_BIN" serve \
  --workspace "$RUN_DIR/workspace" \
  --no-tui \
  --allow-external \
  --opencode-source external \
  --opencode-bin "$RUN_DIR/slow-opencode" \
  --openwork-port "$PORT" \
  --remote-access \
  --run-id production-server-restart-readiness \
  > "$RUN_DIR/openwork.log" 2>&1 &
PID="$!"
printf '%s' "$PID" > "$RUN_DIR/openwork.pid"
MARKER="$RUN_DIR/wrapper-invocations.log"
SERVE_DELAY_SEEN=0
for _ in $(seq 1 150); do
  if ! kill -0 "$PID" 2>/dev/null; then
    printf 'OPENWORK_PID_DIED_BEFORE_SERVE_DELAY_MARKER=yes\n'
    exit 1
  fi
  if [ -f "$MARKER" ] && grep -q '^CALL first=serve delay=${DELAYED_OPENCODE_SECONDS}$' "$MARKER"; then
    SERVE_DELAY_SEEN=1
    break
  fi
  sleep 0.2
done
if [ "$SERVE_DELAY_SEEN" != "1" ]; then
  printf 'SERVE_DELAY_MARKER_FOUND=no\n'
  exit 1
fi
printf 'SERVE_DELAY_MARKER_FOUND=yes\n'
sleep ${POST_SERVE_DELAY_CHECK_SECONDS}
kill -0 "$PID"
printf 'OPENWORK_PID=%s\n' "$PID"
printf 'ALIVE_AFTER_SERVE_DELAY_BOUNDARY=yes\n'
printf 'OLD_BOUNDARY_SECONDS=${OLD_STARTUP_BOUNDARY_SECONDS}\n'
printf 'CHECK_AFTER_SERVE_DELAY_SECONDS=${POST_SERVE_DELAY_CHECK_SECONDS}\n'
printf 'OPENCODE_DELAY_SECONDS=${DELAYED_OPENCODE_SECONDS}\n'
printf 'WRAPPER_USES_REAL_OPENCODE=yes\n'
printf 'WRAPPER_INVOCATIONS_BEGIN\n'
cat "$RUN_DIR/wrapper-invocations.log"
printf 'WRAPPER_INVOCATIONS_END\n'
`, 45_000);

            record(ctx, output.includes("SERVE_DELAY_MARKER_FOUND=yes"), "The opencode serve delay marker appeared before checking the old boundary");
            record(ctx, output.includes("ALIVE_AFTER_SERVE_DELAY_BOUNDARY=yes"), "The production openwork process is still alive 11 seconds after the serve delay began");
            record(ctx, output.includes("CHECK_AFTER_SERVE_DELAY_SECONDS=11"), "The old-boundary check ran 11 seconds after opencode serve delay began");
            record(ctx, output.includes("OPENCODE_DELAY_SECONDS=12"), "The OpenCode wrapper delays the real binary for 12 seconds");
            record(ctx, output.includes("CALL first=--version delay=0"), "The OpenCode --version preflight was not delayed by the wrapper");
            record(ctx, output.includes("CALL first=serve delay=12"), "The 12-second delay was applied specifically to opencode serve");
            record(ctx, output.includes("WRAPPER_USES_REAL_OPENCODE=yes"), "The wrapper execs the sandbox's real OpenCode binary after the delay");
            ctx.output("Daytona production process check", output.trim());
          },
        });
      },
    },
    {
      name: "The shared public health endpoint becomes ready automatically",
      run: async (ctx) => {
        await ctx.prove("OpenWork server health reaches 2xx after the delayed OpenCode startup completes", {
          voiceover: vo[1],
          assert: async () => {
            const url = healthUrl(ctx.env.OPENWORK_EVAL_OPENWORK_PUBLIC_HEALTH_URL);
            const startedAt = Date.now();
            try {
              const status = await waitForPublicHealth(url);
              const elapsedMs = Date.now() - startedAt;
              record(ctx, status.startsWith("HTTP 2"), "The public OpenWork /health endpoint returns a 2xx status", status);
              const marker = runInSandbox(ctx, `
set -euo pipefail
RUN_DIR=/tmp/openwork-production-server-restart-readiness
test -f "$RUN_DIR/wrapper-invocations.log"
cat "$RUN_DIR/wrapper-invocations.log"
`, 20_000);
              record(ctx, marker.includes("DELAYED first=serve requested=12"), "The serve-only 12-second delay completed before OpenWork became healthy");
              ctx.output("Public health readiness", `PUBLIC_HEALTH_STATUS=${status}\nELAPSED_MS=${elapsedMs}\n${marker.trim()}`);
            } finally {
              try {
                runInSandbox(ctx, `
set -euo pipefail
RUN_DIR=/tmp/openwork-production-server-restart-readiness
if [ -f "$RUN_DIR/openwork.pid" ]; then
  PID="$(cat "$RUN_DIR/openwork.pid" || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then kill "$PID" 2>/dev/null || true; fi
fi
printf 'CLEANUP=done\n'
`, 20_000);
              } catch (error) {
                ctx.output("Cleanup warning", redact(error instanceof Error ? error.message : String(error)));
              }
            }
          },
        });
      },
    },
  ],
};
