# Durable signed Windows installer eval

This eval combines browser architecture detection, real Den-stamped ZIPs, a
signed Windows executable, link rotation, and the installed desktop bootstrap.
The frame flow is `evals/flows/durable-signed-windows-installer.flow.mjs`.

## Daytona Windows proof

Use a `windows-medium` Daytona sandbox. `daytona exec` runs as SYSTEM in session
0, so use it for the signature and config probe; use Daytona VNC for the visible
installer and installed desktop steps.

After downloading an organization-stamped ZIP and rotating the install link,
copy the checked-in probe and package into the sandbox, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File C:\ow\openwork\scripts\support\test-durable-windows-installer.ps1 `
  -PackagePath C:\ow\OpenWork-Installer-acme-win-x64.zip `
  -OldConfigUrl "https://openwork.example.com/api/den/v1/install-config?token=OLD" `
  -NewConfigUrl "https://openwork.example.com/api/den/v1/install-config?token=NEW" `
  -ExpectedPublisher "Different AI" `
  -PreparedDirectory C:\ow\prepared-installer `
  -OutputPath C:\ow\durable-windows-proof.json
```

The probe fails unless Authenticode is valid, renaming preserves the executable
hash, the adjacent sidecar is still selected, the old link is revoked, and the
new link is active. `--check-config` deliberately avoids the separate desktop
binary/update feed, so this outer-installer proof needs no public GitHub egress.

Start `C:\ow\prepared-installer\Renamed Organization Setup.exe` with
`OPENWORK_INSTALLER_UI=manual`, expose its printed URL to the fraimz browser,
and launch the installed desktop with CDP.
Then run:

```bash
OPENWORK_EVAL_INSTALL_PAGE_URL='https://openwork.example.com/install?token=NEW' \
OPENWORK_EVAL_WINDOWS_INSTALLER_UI_URL='http://WINDOWS_HOST:PORT/?token=UI_TOKEN' \
OPENWORK_EVAL_WINDOWS_PROOF_JSON='/path/to/durable-windows-proof.json' \
OPENWORK_EVAL_DESKTOP_CDP_URL='http://WINDOWS_HOST:9222' \
pnpm fraimz --flow durable-signed-windows-installer
```

The run passes only when
`evals/results/<run-id>/fraimz.html` exists and every frame has an observable
assertion and screenshot.
