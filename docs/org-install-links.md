# Organization install links

Status: self-host operator guide

Owner: platform/self-host

Related: `ee/apps/den-api/src/routes/org/install-links.ts`, `apps/installer`, `packages/install-config`

## What users download

Organization install links let workspace members download the normal signed
OpenWork desktop application already configured for their organization. Den
does not compile a different OpenWork application for every organization.
Instead, it creates one lightweight ZIP from two independently verifiable inputs:

1. The generic signed **OpenWork Installer** for the selected platform.
2. `openwork-installer.json`, containing the deployment, exact app version, and
   branding settings.

The user explicitly launches the installer. It shows the organization name and
server URL before making changes, writes `desktop-bootstrap.json` to the
canonical per-user location, downloads the exact standard signed app release
directly on the user's computer, and then launches OpenWork. The desktop app
never searches Downloads or Desktop for configuration files.

Possession of an install link or setup ZIP does not create a workspace session.
Users must still authenticate against the configured deployment.

## Self-host rollout

Install links are active by default when deployment gating is off. Hosted
installations can set `DEN_INSTALL_LINKS_GATING_ENABLED=true` to require
per-organization opt-in.

### Required public origins

- `BETTER_AUTH_URL`: externally reachable Den Web origin, for example
  `https://openwork.example.com`.
- `DEN_API_PUBLIC_URL`: externally reachable Den API origin. Path prefixes are
  preserved.
- `DEN_BETTER_AUTH_TRUSTED_ORIGINS`: put the Den Web origin first so invitation
  and authentication links never point to localhost.

### Helm

1. Keep `migrations.enabled=true` for the upgrade that creates the install-link
   table.
2. Configure the public origins above.
3. Mount the three lightweight generic installer artifacts when Den has no
   public egress, as described below.
4. Restart the deployment. No raw database or feature-flag change is required
   for normal self-hosted installations.

## Artifact delivery

`OPENWORK_INSTALLER_RELEASE_TAG` pins the standard app version recorded in the
sidecar and the generic installer release. Den resolves each generic installer
artifact in this order:

1. `OPENWORK_INSTALLER_ARTIFACTS_DIR`.
2. `OPENWORK_INSTALLER_CACHE_DIR/<tag>/<file>`.
3. `https://github.com/<OPENWORK_INSTALLER_RELEASE_REPO>/releases/download/<tag>/<file>`.

For release `v0.18.0`, the complete Den-side Mac/Windows artifact set is:

```text
openwork-installer-mac-arm64.zip
openwork-installer-mac-x64.zip
openwork-installer-win-x64.exe
```

The generic Mac ZIP contains the signed and notarized `OpenWork Installer.app`.
The generic Windows EXE is the release installer launcher and is signed when
Windows signing is enabled for that release. Both generic installers carry the
native OpenWork icon. Den does not modify either executable; it only combines
the installer with the organization JSON in the downloaded ZIP.

### Den with zero public egress

Mount the three matching files above into
`OPENWORK_INSTALLER_ARTIFACTS_DIR`. Den then builds organization downloads
entirely from the mounted volume and never fetches the large desktop app. The
end-user computer downloads the exact standard DMG or EXE directly from public
OpenWork release hosting.

The user device needs outbound HTTPS access to:

- `github.com` and `*.githubusercontent.com` for the standard app release;
- the configured Den Web origin;
- the configured Den API origin;
- the host serving `logoUrl` and `iconUrl` (normally Den itself);
- the organization's identity provider if interactive SSO is required;
- any MCP or SaaS endpoints the organization intentionally enables after
  installation.

Keep uploaded branding assets on the on-prem Den origin to avoid adding an
external image CDN to the client allowlist.

### Connected Den allowlist

When the three generic artifacts are not mounted or cached, Den may resolve
them over outbound TCP 443. Allow:

```text
github.com
*.githubusercontent.com
```

The first host serves the stable release URL; GitHub may redirect the artifact
body to a `githubusercontent.com` release host. GitHub's firewall guidance uses
the same wildcard for action and release downloads:
https://docs.github.com/en/code-security/reference/supply-chain-security/automatic-dependency-submission#configure-network-access-for-self-hosted-runners.

If policy forbids wildcard external hosts on Den, mount the three generic files
through `OPENWORK_INSTALLER_ARTIFACTS_DIR` or pre-populate
`OPENWORK_INSTALLER_CACHE_DIR/<tag>/`. `OPENWORK_INSTALLER_RELEASE_REPO`
selects a repository on `github.com`; it does not change the release host to an
arbitrary internal mirror. Mounted artifacts are preferable to depending on
changing CDN IP addresses.

For Microsoft Entra sign-in, the normal global-cloud browser authentication
endpoint is `login.microsoftonline.com`; sovereign clouds use different hosts.
Conditional Access, device registration, federation, and other providers may
require additional customer-specific endpoints. Follow the identity provider's
official network requirements rather than treating this installer list as a
complete SSO allowlist.

For an external MCP or SaaS connection, allow the exact customer endpoint from
the component that executes that connection. For example, a ServiceNow MCP
connection normally needs outbound TCP 443 from OpenWork Connect / Den to the
customer instance such as `https://example.service-now.com`; its OAuth browser
also needs that instance and the configured Den callback origin. Private DNS,
private endpoints, proxies, or customer-managed certificate authorities add
deployment-specific requirements and should not be replaced with a blanket
public wildcard.

## Bundle contents and explicit selection

Mac:

```text
OpenWork Installer.app/
openwork-installer.json
```

Windows:

```text
OpenWork Installer.exe
openwork-installer.json
```

The installer reads only the JSON beside the installer the user launched. Two
old or testing bundles can coexist in Downloads without affecting the installed
app. Switching deployments requires launching the other installer and
confirming the new organization and server address.

macOS App Translocation is supported: if Gatekeeper relocates the running
installer, it resolves the original app path from the nullfs mount and reads
the JSON beside that exact extracted bundle.

## Installer JSON

Example:

```json
{
  "schemaVersion": 1,
  "appName": "Example Work",
  "appVersion": "0.18.0",
  "clientName": "Example Corporation",
  "webUrl": "https://openwork.example.com",
  "apiUrl": "https://openwork-api.example.com",
  "requireSignin": true,
  "logoUrl": "https://openwork.example.com/v1/brand-assets/wordmark.png",
  "iconUrl": "https://openwork.example.com/v1/brand-assets/icon.png"
}
```

- `logoUrl` is the wordmark used inside OpenWork and on sign-in surfaces.
- `iconUrl` is the square image used for the macOS Dock and Windows native
  shortcut/taskbar surfaces.
- `appVersion` identifies the exact standard signed app release the desktop
  installer downloads, avoiding a mutable “latest” lookup.
- The JSON contains no install token, auth session, or long-lived secret.

The installer writes the normalized result here:

| OS | Canonical path |
|---|---|
| Windows | `%LOCALAPPDATA%\openwork\desktop-bootstrap.json` |
| macOS/Linux | `$XDG_CONFIG_HOME/openwork/desktop-bootstrap.json`, otherwise `~/.config/openwork/desktop-bootstrap.json` |

Existing Tauri/Electron compatibility rules still read the legacy
`~/.config/openwork/desktop-bootstrap.json` path and migrate the newest valid
state. Standard desktop updates do not invoke the organization installer, so
upgrading the app preserves the canonical deployment configuration.

The installer writes this bootstrap before it downloads the app. Electron
reads it before creating the first window and fetches/caches the square icon
before that window appears. The first visible sign-in surface therefore uses
the configured company name, wordmark, server, and native Dock/taskbar icon;
no first-run restart is required. The signed app bundle remains named OpenWork
on disk so its release signature stays intact.

## MDM deployment

MDM can continue to deploy the standard public OpenWork installer and write
`desktop-bootstrap.json` directly to the canonical path. This bypasses the
interactive generic installer and is appropriate when endpoint management
already provides deterministic per-user file placement.

## Security properties

- Install-link tokens are stored as SHA-256 hashes.
- Downloaded JSON contains deployment/branding data but no authentication
  session.
- The installer requires explicit confirmation before applying a deployment.
- The standard app and generic installer signatures remain byte-identical to
  their release assets; runtime branding does not rewrite the signed bundle.
- The native app validates and bounds downloaded icon images before caching
  them.
- Admins can rotate install links to revoke older links; existing downloaded
  ZIPs remain configuration media but still grant no workspace access.

## Troubleshooting

| Symptom | Resolution |
|---|---|
| Download redirects to the normal public app instead of returning an organization ZIP | Den could not resolve the lightweight generic installer. Mount the three matching generic artifacts or repair Den's GitHub access. |
| Installer asks for an install link | `openwork-installer.json` is missing or was separated from the launched installer. Re-extract the organization ZIP and keep its files together. |
| Installer cannot download OpenWork | The desktop cannot reach `github.com` or the redirected `*.githubusercontent.com` release host, or the pinned release is missing its platform artifact. |
| Wrong organization is shown | Exit without confirming, then launch the installer from the intended extracted bundle. Files elsewhere are ignored. |
| Branding text appears but the native icon does not | Verify `iconUrl` is a reachable square image. The installer applies it before the first window, with a 10-second network timeout. |
| Install links point at localhost or the wrong host | Correct `BETTER_AUTH_URL`, `DEN_API_PUBLIC_URL`, and `DEN_BETTER_AUTH_TRUSTED_ORIGINS`, then restart Den API. |
