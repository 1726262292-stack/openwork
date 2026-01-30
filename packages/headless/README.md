# OpenWork Headless

Headless host orchestrator for OpenCode + OpenWork server + Owpenbot. This is a CLI-first way to run host mode without the desktop UI.

## Quick start

```bash
pnpm --filter @different-ai/openwork-headless dev -- \
  start --workspace /path/to/workspace --approval auto
```

The command prints pairing details (OpenWork server URL + token, OpenCode URL + auth) so remote OpenWork clients can connect.

## Pairing notes

- Use the **OpenWork connect URL** and **client token** to connect a remote OpenWork client.
- The OpenWork server advertises the **OpenCode connect URL** plus optional basic auth credentials to the client.

## Approvals (manual mode)

```bash
openwork-headless approvals list \
  --openwork-url http://<host>:8787 \
  --host-token <token>

openwork-headless approvals reply <id> --allow \
  --openwork-url http://<host>:8787 \
  --host-token <token>
```

## Health checks

```bash
openwork-headless status \
  --openwork-url http://<host>:8787 \
  --opencode-url http://<host>:4096
```

## Smoke checks

```bash
openwork-headless start --workspace /path/to/workspace --check --check-events
```

This starts the services, verifies health + SSE events, then exits cleanly.

## Local development

Point to source CLIs for fast iteration:

```bash
openwork-headless start \
  --workspace /path/to/workspace \
  --openwork-server-bin packages/server/src/cli.ts \
  --owpenbot-bin packages/owpenbot/src/cli.ts
```
