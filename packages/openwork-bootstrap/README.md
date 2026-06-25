# OpenWork Bootstrap CLI

Script-installable `openwork` command for agent-first onboarding.

This package is intentionally small and does not assume npm is the install
channel. A bootstrap script can place `bin/openwork.mjs` on disk, then run:

```bash
openwork install --bin-dir ~/.local/bin --install-dir ~/.openwork/bootstrap
openwork doctor --json
openwork cloud onboard --base-url https://den.example.com --owner-email ada@example.com --owner-password '...' --org-name 'Ada Workspace' --invite-email teammate@example.com --skill-name 'First skill' --json
```

Current scope:

- `install` installs the lightweight CLI into a user-writable bin directory.
- `doctor` verifies the CLI install and, optionally, a Den API health endpoint.
- `cloud onboard` drives the headless REST onboarding flow: sign up, sign in,
  create an org, invite a teammate, and create a starter skill.

This is a bootstrap layer; it does not replace the existing orchestrator CLI yet.
