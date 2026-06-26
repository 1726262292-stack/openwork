# OpenWork Start

You are an agent helping a user install and set up OpenWork.

Goal: install OpenWork, create or sign in to an OpenWork Cloud account, create a
workspace organization, invite a teammate, create a first skill, prepare the
desktop app with that account/org/skill, and verify the running app shows the
prepared state.

## 1. Install CLI

Install the lightweight `openwork` bootstrap CLI into a user-writable bin dir.

If you already have this repository locally:

```bash
node packages/openwork-bootstrap/bin/openwork.mjs install \
  --install-dir "$HOME/.openwork/bootstrap" \
  --bin-dir "$HOME/.local/bin" \
  --json
```

In production, use the published bootstrap script when available. Download it to
a file, inspect it, then run it. Do not pipe remote scripts directly into a
shell.

```bash
curl -fsSLo /tmp/openwork-install.sh https://openwork.com/install.sh
less /tmp/openwork-install.sh
sh /tmp/openwork-install.sh
```

Verify:

```bash
openwork doctor --json
```

## 2. Install App

Install the desktop app for this OS from the manifest:

```bash
openwork install app \
  --manifest https://openwork.com/install-manifest.json \
  --json
```

Verify:

```bash
openwork doctor --app --json
```

## 3. Create Cloud Workspace

Ask the user for:

- owner email
- workspace name
- teammate email to invite

Generate a strong password locally unless the user provides one. Do not print the
password or token in the final response.

```bash
OPENWORK_OWNER_PASSWORD="<generated-password>" \
openwork cloud onboard \
  --base-url https://cloud.openwork.com \
  --owner-email "<owner-email>" \
  --org-name "<workspace-name>" \
  --invite-email "<teammate-email>" \
  --skill-name "First OpenWork Skill" \
  --prepare-desktop \
  --json
```

## 4. Success Criteria

You are done only when all are true:

- `openwork doctor --json` returns `ok: true`
- `openwork doctor --app --json` returns `ok: true`
- `openwork cloud onboard ... --json` returns:
  - `ok: true`
  - `organization.id` is present
  - `invitation.invitationId` is present
  - `skill.id` is present
  - `skillRun.triggered` is `true`
  - `skillRun.output` is `OPENWORK_BOOTSTRAP_SKILL_TRIGGERED`
- `desktop.prepared` is `true`
- `desktop.bootstrapPath` is present
- `desktop.skillPath` is present
- `openwork doctor --desktop-bootstrap --json` returns `ok: true`
- The desktop app opens to Settings -> Bootstrap and visibly shows signed-in account, organization, server URL, cloud skill from CLI, and local skill file.

## 5. If Something Fails

- If CLI install fails: report OS, shell, command, and stderr.
- If app install fails: run `openwork doctor --app --json` and report failed checks.
- If signup says the email already exists: ask the user whether to sign in instead.
- If invite accept returns `email_verification_required`: tell the invited user to verify email before joining.

## 6. Constraints

- Do not require admin privileges.
- Prefer user-local install paths.
- Do not print passwords or tokens in final output.
- Report exactly what was installed and where.

## 7. Security note: desktop preparation

`--prepare-desktop` writes a one-time, short-lived (~5 minute) desktop sign-in
grant to a machine-local `desktop-bootstrap.json`. The grant is never printed.
On first launch the desktop app exchanges it once and rewrites the file without
the grant, so it cannot be reused. This file is local-only; do not copy it
between machines or commit it.
