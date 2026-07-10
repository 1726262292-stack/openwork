# Organization Install Links

Status: self-host operator guide
Owner: platform/self-host
Related: `ee/apps/den-api/src/routes/org/install-links.ts`, `ee/apps/den-api/src/utils/installer-artifacts.ts`, `packaging/helm/openwork-ee/README.md`

## What it is

Organization install links let org admins mint shareable desktop install links
for their workspace. Den serves one generic signed installer and stamps it per
org at serve time. The installed app boots into forced sign-in against your
deployment, so possession of an install link does not grant workspace access.

## Upgrade checklist

> **Dark launch:** Upgrading changes nothing visible. Install links stay dark
> until a platform admin enables the `Install links` capability for an org.

### Helm

1. Keep `migrations.enabled=true` for the upgrade. The migration Job creates
   the `install_link` table automatically; see the
   [Helm migration Job docs](../packaging/helm/openwork-ee/README.md#migrations).
2. Set `config.public.bootstrapAdminEmails` (renders
   `DEN_BOOTSTRAP_ADMIN_EMAILS`) to the platform admin email allowlist.
3. Restart/roll the deployment with the new values.
4. Sign in to den-web, open `/admin`, and toggle `Install links` for each org
   that should be allowed to mint links.

### Docker Compose

1. Run the migration once from the repo root:

   ```bash
   docker compose -f packaging/docker/docker-compose.den-dev.yml exec den sh -lc "pnpm --dir /app/ee/packages/den-db run db:bootstrap"
   ```

   If your stack was launched with a custom Compose project name, include the
   same `-p <project>` flag.
2. Set `DEN_BOOTSTRAP_ADMIN_EMAILS` on the Den API service, then restart it.
3. Sign in to den-web, open `/admin`, and toggle `Install links` for each org
   that should be allowed to mint links.

## Trusted origins requirement

> **Hard requirement:** The first entry of
> `DEN_BETTER_AUTH_TRUSTED_ORIGINS` must be your den-web origin (for example,
> `https://openwork.example.com`). Minted install links and invitation links
> are both built from that origin.

## Installer artifacts

Den resolves Mac and Windows installer artifacts in this order:

1. `OPENWORK_INSTALLER_ARTIFACTS_DIR`, when set and the file exists.
2. `OPENWORK_INSTALLER_CACHE_DIR/<tag>/<file>`, defaulting to the OS temp dir.
3. A private/internal asset root from `OPENWORK_INSTALLER_RELEASE_BASE_URL`,
   resolved as `<base-url>/<tag>/<file>`.
4. A GitHub release asset only when
   `OPENWORK_INSTALLER_ALLOW_GITHUB_FALLBACK=true`.

The default is zero egress: if no mounted/cached artifact or private release
base is configured, Den returns `503` without making a network request.

| Mode | Configure | Behavior |
|---|---|---|
| Private artifact service | Set `OPENWORK_INSTALLER_RELEASE_BASE_URL` to an internal HTTPS artifact root. Optionally override `OPENWORK_INSTALLER_RELEASE_TAG`, which otherwise follows the pinned app version. | Den downloads from `<base-url>/<tag>/<file>` on the first Mac/Windows request, then serves cached bytes. |
| Public GitHub fallback | Set `OPENWORK_INSTALLER_ALLOW_GITHUB_FALLBACK=true`. Optionally set `OPENWORK_INSTALLER_RELEASE_REPO`, for example `your-org/openwork`. | After mounted, cached, and private sources miss, Den may download a GitHub release asset. This is never enabled implicitly. |
| Air-gapped | Mount a volume at `OPENWORK_INSTALLER_ARTIFACTS_DIR` containing exactly `openwork-installer-mac-arm64.zip`, `openwork-installer-mac-x64.zip`, `openwork-installer-win-x64.zip`, and `openwork-installer-win-arm64.zip`. | The mounted artifact directory takes precedence and requires zero egress while Den serves the bootstrap packages. |

## Egress

`den-api` performs no installer-artifact network request by default. A private
release base allows internal-only fetches. It contacts `github.com` only when
the public fallback is explicitly enabled and higher-priority sources miss.
This guarantee covers the outer bootstrap package; configuring a private
desktop binary and update feed is a separate deployment concern.

## Distribute configuration with MDM (no custom installer)

You can deploy the standard public OpenWork desktop installer and point it at
your self-hosted control plane by managing one JSON file. No custom installer is
required.

OpenWork reads `desktop-bootstrap.json` from the same canonical path used by the
installer and bootstrap CLI:

| OS | Canonical path |
|---|---|
| Windows | `%LOCALAPPDATA%\openwork\desktop-bootstrap.json` (`%XDG_CONFIG_HOME%\openwork\desktop-bootstrap.json` wins first if your environment sets it) |
| macOS/Linux | `$XDG_CONFIG_HOME/openwork/desktop-bootstrap.json`, falling back to `~/.config/openwork/desktop-bootstrap.json` |

Older desktop builds also wrote `~/.config/openwork/desktop-bootstrap.json` on
every OS. Current builds still read that legacy file for compatibility; when
both files exist and parse, the config with the newest `writtenAt` timestamp
wins. If `writtenAt` is missing or invalid, OpenWork falls back to the file
mtime for that file. When the legacy file wins, OpenWork migrates it to the
canonical path. The installer also cleans up a stale legacy twin after writing
the canonical file.

Schema:

```json
{
  "baseUrl": "https://openwork.example.com",
  "apiBaseUrl": "https://api.openwork.example.com",
  "requireSignin": true,
  "writtenAt": "2026-07-07T12:00:00.000Z"
}
```

- `baseUrl` is required and should be your den-web origin.
- `apiBaseUrl` is optional when your web origin proxies Den API traffic, but is
  recommended for split web/API deployments.
- `requireSignin` should be `true` for organization-managed installs.
- `writtenAt` should be an ISO timestamp; use a fresh value whenever MDM rolls
  out a replacement config so the newest file wins deterministically.

For MDM tools such as ManageEngine, deploy the public installer, then write this
file to the canonical path for each user profile. The public installer plus this
managed file is enough for a fully self-hosted desktop rollout.

## Security notes

- Install-link tokens are stored SHA-256 hashed.
- Minting a new link rotates by default and revokes older active links. Mac and
  Windows packages already downloaded remain usable because their resolved
  configuration travels beside the signed executable inside the zip.
- A leaked link reveals the org name and server URLs only; users still must
  sign in to access the workspace.
- Public install-link endpoints are rate-limited.
- Stamped zips keep the signed macOS `.app` and Windows `.exe` byte-identical,
  so Gatekeeper and Authenticode verification still apply.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Installer download returns `503` | Mount or prefill the four generic ZIPs, configure `OPENWORK_INSTALLER_RELEASE_BASE_URL`, or explicitly enable the public GitHub fallback. |
| Links point at the wrong host | Put your den-web origin first in `DEN_BETTER_AUTH_TRUSTED_ORIGINS`, then restart `den-api`. |
| Re-uploaded assets under the same tag keep serving old bytes | Clear the installer cache directory or bump the tag. The cache key is `<cacheDir>/<tag>/<file>`. |
| Windows zip contains an unsigned setup executable | Public generic-installer releases require SignPath and fail rather than publishing an unsigned Windows package. Workflow artifacts may be unsigned only for explicit test builds. |
