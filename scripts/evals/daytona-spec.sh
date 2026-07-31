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
export DISPLAY="${DISPLAY:-:99}"   # the host component verifies it answers
export OPENWORK_EVAL_APP_SPECS=1
# Den-dependent specs read these; harmless when no Den is running.
export OPENWORK_EVAL_DEN_API_URL="${OPENWORK_EVAL_DEN_API_URL:-http://127.0.0.1:8790}"
export OPENWORK_EVAL_DEN_WEB_URL="${OPENWORK_EVAL_DEN_WEB_URL:-http://localhost:3005}"
if [ -x "$HOME/mark-verified.sh" ]; then
  export OPENWORK_EVAL_MARK_VERIFIED_CMD="bash $HOME/mark-verified.sh {email}"
fi

if compgen -G "/daytona-secrets/*.env" > /dev/null; then
  set -a
  for secret_file in /daytona-secrets/*.env; do . "$secret_file"; done
  set +a
fi


pnpm --dir evals install
echo "==> Running $SPEC"
pnpm --dir evals exec vitest run --config vitest.config.ts --project nightly "$SPEC"
