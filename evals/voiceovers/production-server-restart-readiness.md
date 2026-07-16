# production-server-restart-readiness — Shared production startup waits through slow OpenCode cold starts

1. In an already running Daytona sandbox, we start the current-branch `openwork serve` binary with a wrapper that delays the real OpenCode server by twelve seconds. The important signal is that OpenWork is still running after the old ten-second boundary instead of exiting early.

2. Without touching sandbox images or provisioning, we keep polling the shared public `/health` endpoint. Once the delayed OpenCode becomes healthy, OpenWork brings up its own server and the health check turns green automatically.
