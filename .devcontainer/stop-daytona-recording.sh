#!/usr/bin/env bash
set -euo pipefail

# Stop a running Daytona display recording. Sends SIGINT to ffmpeg so it
# finalizes the mp4 cleanly.
#
# Usage:
#   # Stop from inside the sandbox:
#   bash .devcontainer/stop-daytona-recording.sh
#
#   # Stop from the host:
#   daytona exec $SANDBOX -- 'bash .devcontainer/stop-daytona-recording.sh'

WAIT="${1:-5}"

pid="$(pgrep -f 'ffmpeg.*x11grab' 2>/dev/null || true)"
if [ -z "$pid" ]; then
  echo "No active recording found."
  exit 0
fi

kill -INT "$pid" 2>/dev/null || true
echo "Sent SIGINT to ffmpeg (pid $pid). Waiting ${WAIT}s for finalization..."
sleep "$WAIT"

if kill -0 "$pid" 2>/dev/null; then
  echo "WARNING: ffmpeg still running after ${WAIT}s — sending SIGTERM."
  kill "$pid" 2>/dev/null || true
fi

echo "Recording stopped."
