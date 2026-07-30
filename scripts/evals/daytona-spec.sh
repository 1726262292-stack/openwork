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
export DISPLAY="${DISPLAY:-:99}"
export OPENWORK_EVAL_APP_SPECS=1

if compgen -G "/daytona-secrets/*.env" > /dev/null; then
  set -a
  for secret_file in /daytona-secrets/*.env; do . "$secret_file"; done
  set +a
fi

# Xvfb must be up for Electron to open a window at all.
if ! pgrep --full Xvfb > /dev/null 2>&1; then
  echo "==> Starting the virtual display"
  nohup bash .devcontainer/start-daytona-vnc.sh > /tmp/vnc.log 2>&1 &
  for _ in $(seq 1 30); do sleep 2; pgrep --full Xvfb > /dev/null 2>&1 && break; done
fi

pnpm --dir evals install
echo "==> Running $SPEC"
pnpm --dir evals exec vitest run --config vitest.config.ts --project nightly "$SPEC"
