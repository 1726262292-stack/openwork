# OpenWork Start

You are an agent helping a user install and set up OpenWork.

Goal: install OpenWork, create or sign in to an OpenWork Cloud account, create a
workspace organization, invite a teammate, create a first skill, and verify the
setup works.

## 1. Install CLI

Install the lightweight `openwork` bootstrap CLI into a user-writable bin dir.

If you already have this repository locally:

```bash
node packages/openwork-bootstrap/bin/openwork.mjs install \
  --install-dir "$HOME/.openwork/bootstrap" \
  --bin-dir "$HOME/.local/bin" \
  --json
```

In production, use the published bootstrap script when available:

```bash
curl -fsSL https://openwork.com/install.sh | sh
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
openwork cloud onboard \
  --base-url https://cloud.openwork.com \
  --owner-email "<owner-email>" \
  --owner-password "<generated-password>" \
  --org-name "<workspace-name>" \
  --invite-email "<teammate-email>" \
  --skill-name "First OpenWork Skill" \
  --json
```

## 4. Success Criteria

You are done only when all are true:

- `openwork doctor --json` returns `ok: true`
- `openwork doctor --app --json` returns `ok: true`
- `openwork cloud onboard ... --json` returns:
- `ok: true`
- `organization.id`
- `invitation.invitationId`
- `skill.id`

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
