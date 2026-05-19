#!/usr/bin/env bash
set -euo pipefail

# test-on-daytona.sh — one-command Daytona Electron test sandbox
#
# Usage:
#   bash .devcontainer/test-on-daytona.sh [branch-or-commit]
#
# Environment variables (optional):
#   OPENAI_API_KEY  — if set, injects the key into the workspace opencode
#                     config so real LLM sessions work (GPT-4o, GPT-5.5, etc.)
#
# Creates an 8 GB Daytona sandbox, checks out the given ref (default: current
# HEAD), starts all services (Xvfb + Vite + Electron + opencode sidecar), and
# waits for the Electron CDP endpoint. Prints the CDP and noVNC URLs at the
# end so you can connect browser tools or open the app in your browser.
#
# Cleanup:
#   daytona delete "$SANDBOX"

REF="${1:-$(git rev-parse HEAD)}"
SANDBOX="openwork-test-$(date +%Y%m%d-%H%M%S)"
CDP_PORT=9825
NOVNC_PORT=6080
MAX_WAIT=90

echo "==> Creating sandbox: $SANDBOX"
echo "    Ref: $REF"
echo ""

daytona create \
  --name "$SANDBOX" \
  --dockerfile .devcontainer/Dockerfile \
  --context .devcontainer/Dockerfile \
  --context .devcontainer/start-display.sh \
  --context .devcontainer/start-services.sh \
  --class large \
  --memory 8 \
  --auto-stop 60 \
  --public \
  --target us

echo ""
echo "==> Checking out $REF and installing deps..."
daytona exec "$SANDBOX" -- "bash -lc 'cd /workspace && git fetch origin $REF && git checkout $REF && pnpm install --frozen-lockfile || pnpm install'"

echo ""
echo "==> Starting services (Xvfb + Vite + Electron)..."
daytona exec "$SANDBOX" -- "bash -lc 'cd /workspace && nohup bash .devcontainer/start-services.sh > /tmp/start-services.log 2>&1 &'"

echo ""
echo "==> Waiting for Electron CDP on port $CDP_PORT (up to ${MAX_WAIT}s)..."
elapsed=0
while [ "$elapsed" -lt "$MAX_WAIT" ]; do
  if daytona exec "$SANDBOX" -- "bash -lc 'curl -sf http://127.0.0.1:$CDP_PORT/json/list >/dev/null 2>&1'" 2>/dev/null; then
    echo "    CDP ready after ${elapsed}s."
    break
  fi
  sleep 5
  elapsed=$((elapsed + 5))
  printf "    %ds...\r" "$elapsed"
done

if [ "$elapsed" -ge "$MAX_WAIT" ]; then
  echo ""
  echo "WARNING: CDP did not become ready within ${MAX_WAIT}s."
  echo "Check logs:"
  echo "  daytona exec $SANDBOX -- 'tail -80 /tmp/start-services.log'"
  echo "  daytona exec $SANDBOX -- 'tail -80 /tmp/electron.log'"
  echo "  daytona exec $SANDBOX -- 'tail -80 /tmp/vite.log'"
fi

# Verify opencode sidecar
echo ""
if daytona exec "$SANDBOX" -- "bash -lc 'ps aux | grep opencode | grep -v grep'" 2>/dev/null | grep -q opencode; then
  echo "==> opencode sidecar: running"
else
  echo "==> opencode sidecar: not running (workspace may need creation first)"
fi

# Inject OpenAI API key if provided
if [ -n "${OPENAI_API_KEY:-}" ]; then
  echo ""
  echo "==> Injecting OPENAI_API_KEY into workspace config..."
  # Create workspace dir + minimal opencode config with the key
  daytona exec "$SANDBOX" -- "bash -lc 'mkdir -p /workspace/hello && cd /workspace/hello && if [ ! -f opencode.jsonc ]; then echo \"{}\" > opencode.jsonc; fi && node -e \"const fs=require(\\\"fs\\\"); const p=\\\"opencode.jsonc\\\"; let c={}; try{c=JSON.parse(fs.readFileSync(p,\\\"utf8\\\").replace(/^\\\\/\\\\/.*$/gm,\\\"\\\"));}catch(e){} c.provider=c.provider||{}; c.provider.openai={options:{apiKey:\\\"${OPENAI_API_KEY}\\\"}}; fs.writeFileSync(p,JSON.stringify(c,null,2)); console.log(\\\"OpenAI key injected\\\");\"'" 2>/dev/null
fi

# Get URLs
CDP_URL=$(daytona preview-url "$SANDBOX" -p "$CDP_PORT" 2>/dev/null | grep -v "^time=")
NOVNC_URL=$(daytona preview-url "$SANDBOX" -p "$NOVNC_PORT" 2>/dev/null | grep -v "^time=")

echo ""
echo "============================================"
echo "  Sandbox ready: $SANDBOX"
echo ""
echo "  Electron CDP:  $CDP_URL"
echo "  noVNC visual:  $NOVNC_URL"
echo ""
echo "  Connect browser tools:"
echo "    browser_list({ browser_url: \"$CDP_URL\" })"
echo ""
echo "  Cleanup:"
echo "    daytona delete $SANDBOX"
echo "============================================"
