#!/usr/bin/env bash
# Run ONE eval spec inside a Daytona sandbox, with the environment app specs need.
#
#   daytona exec <sandbox> -- bash -lc "cd /workspace && bash scripts/evals/daytona-spec.sh specs/app-den-tls-fault.slow.test.ts"
#
# Logs land in the workspace so they are readable from any exec session and over
# the results HTTP server.
set -euo pipefail
cd /workspace

SPEC="${1:?spec path relative to evals/ is required}"
LOG_DIR="${OPENWORK_SPEC_LOG_DIR:-/workspace/evals/results/spec-run}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(printf '%s' "$SPEC" | tr '/' '-').log"
exec > >(tee "$LOG") 2>&1

export CI=true
# Stale Electron/Vite processes from earlier runs hold ports and profiles and
# make fresh spawns fail in confusing ways; clear them before starting.
pkill --full "electron/main.mjs" > /dev/null 2>&1 || true
pkill --full "electron-dev.mjs" > /dev/null 2>&1 || true
sleep 1

export DISPLAY="${DISPLAY:-:99}"
export OPENWORK_EVAL_APP_SPECS=1

if compgen -G "/daytona-secrets/*.env" > /dev/null; then
  set -a
  for secret_file in /daytona-secrets/*.env; do . "$secret_file"; done
  set +a
fi

# Electron needs a live X server. A stale /tmp/.X11-unix socket is NOT proof it
# is running: several "renderer blocked" failures were really the app exiting
# with "Missing X server or $DISPLAY".
display_alive() {
  xdpyinfo -display "$DISPLAY" > /dev/null 2>&1
}
if ! display_alive; then
  echo "==> Virtual display not answering on $DISPLAY; starting it"
  nohup bash .devcontainer/start-daytona-vnc.sh > /tmp/vnc.log 2>&1 &
  for _ in $(seq 1 30); do sleep 2; display_alive && break; done
fi
if display_alive; then
  echo "==> Display $DISPLAY is live"
else
  echo "==> WARNING: display $DISPLAY still not answering; Electron will exit at startup"
  tail -20 /tmp/vnc.log 2>/dev/null || true
fi

pnpm --dir evals install
echo "==> Running $SPEC"
pnpm --dir evals exec vitest run --config vitest.config.ts --project nightly "$SPEC"
