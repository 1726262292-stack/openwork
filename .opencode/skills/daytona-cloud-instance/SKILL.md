---
name: daytona-cloud-instance
description: Daytona cloud instance, Den server, OpenWork Cloud, Marketplace onboarding. Use when the user asks to run, launch, start, validate, or record a Daytona cloud/Den instance for OpenWork Cloud flows.
---

# Daytona Cloud Instance

Use this skill to launch or validate an OpenWork Cloud/Den Daytona server sandbox and collect useful URLs for desktop sign-in and Marketplace onboarding demos.

## Goal

Start the Den cloud stack in Daytona, confirm it is reachable, and return the URLs needed by Electron/Desktop validation.

## Fast Path

From the repo root, prefer the existing Daytona helper when available:

```bash
bash .devcontainer/test-on-daytona.sh $(git rev-parse --abbrev-ref HEAD) --server-only --artifacts-volume
```

If the branch is local-only, push it first or apply the local diff manually in the sandbox before validating.

## Expected Services

The Den server sandbox should expose:

- Den Web: port `3005`
- Den API: port `8788`
- Worker proxy: port `8789`
- Artifacts server: port `8090` when `--artifacts-volume` or recording is enabled

Get URLs with:

```bash
daytona preview-url "$SERVER_SANDBOX" -p 3005
daytona preview-url "$SERVER_SANDBOX" -p 8788
daytona preview-url "$SERVER_SANDBOX" -p 8789
daytona preview-url "$SERVER_SANDBOX" -p 8090
```

## Dev Auth Defaults

For local and Daytona cloud testing, run Den API with:

```bash
OPENWORK_DEV_MODE=1
```

In dev mode, email verification is disabled by default so seeded/demo users can sign in without a real inbox. Override explicitly when needed:

```bash
DEN_REQUIRE_EMAIL_VERIFICATION=true
DEN_REQUIRE_EMAIL_VERIFICATION=false
```

Production defaults to requiring email verification unless explicitly disabled.

## Health Checks

Validate the server before driving UI:

```bash
curl -fsS "$DEN_API_URL/health"
curl -fsS "$DEN_WEB_URL/api/den/health"
```

Validate seeded auth if present:

```bash
curl -fsS -X POST "$DEN_WEB_URL/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' \
  --data '{"email":"alex@acme.test","password":"OpenWorkDemo123!"}'
```

## Recording Flow

For founder/designer proof, record the actual journey:

1. Den sign-in page shows clear Cloud value proposition.
2. User signs in on Den.
3. Den dashboard explains Marketplaces contain plugins and assigned marketplaces sync to desktop.
4. Pretend download/open desktop handoff.
5. Desktop signed-out Marketplace nudge says OpenWork works without an account.
6. Desktop signs in to OpenWork Cloud.
7. Marketplace refresh shows `OpenWork Marketplace` and org marketplaces.
8. Built-ins show `Built-in`, with no install/remove actions.
9. A live org plugin installs and appears in My Extensions as `Connected`.
10. Workspace files materialize under `.opencode`.

Before every screenshot, check native overlays:

```bash
daytona exec "$ELECTRON_SANDBOX" -- 'bash -lc '\''DISPLAY=:99 wmctrl -l; ! DISPLAY=:99 wmctrl -l | grep -q "Authorize folder"'\'''
```

Do not publish a screenshot or video if a native folder picker is visible.
