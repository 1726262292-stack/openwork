# Two-door semi-airgapped install simulation — 2026-07-22

## Verdict summary

- Overall: **Failed / stopped at redirect gate**. The real v0.17.37 server state did not advertise v0.17.37 as the latest app version and redirected the Windows installer route to the v0.17.30 release asset.
- Step 1: **Failed version assertion, passed server launch/seed/install-config assertions**.
- Step 2: **Not run**. I stopped before egress lockdown because the release redirect gate already failed.
- Step 3: **Failed**. `/v1/install/win-x64` returned a 302 `Location` under `v0.17.30`, not `v0.17.37`.
- Steps 4-5: **Not run**. Windows client sandbox was not created because the instructions said to stop and diagnose if the redirect tag was wrong.
- Steps 6-8: **Partial**. Evidence report committed/pushed; one fix PR opened; server sandbox stopped and not deleted. No Windows sandbox exists for this run.

## Branches, PRs, and sandboxes

- Evidence branch pushed: `test/two-door-semi-airgapped-evidence`.
- Fix PR opened: <https://github.com/different-ai/openwork/pull/2992> (`fix(den-api): report newest desktop version`).
- Server sandbox: `openwork-server-20260722-021938` / `9b66c9fe-a0ea-4696-9f9c-d2774270890f`.
- Server sandbox status after run: stopped, not deleted.
- Windows sandbox: not created.
- Den Web: `https://3005-lv9q1sbidbqyuopt.daytonaproxy01.net`.
- Den API: `https://8788-mgwa02yocalp1rkc.daytonaproxy01.net`.
- Worker proxy: `https://8789-wqv7tjvqewkmkpd6.daytonaproxy01.net`.
- Seeded org: `Acme Robotics`, `org_01ky4j5xc9esja71bndcr55sx3`.
- Install token minted for validation: `0yuwj1EYRADM1LJAgDwe2v7TYAiE2MjtbzNEUKgNo8s`.

Note: `bash .devcontainer/test-server-on-daytona.sh dev` fetched current `origin/dev` as `6d209cd04b0a8ab2f73ed15371dcb9007f2631ac` (`chore(aur): update PKGBUILD for 0.17.37`). The requested v0.17.37 tag is `1054c9ea6`; the only diff from `1054c9ea6..origin/dev` was AUR packaging metadata.

## Step evidence

### 0 — Release assets exist

Command:

```sh
gh release view v0.17.37 --repo different-ai/openwork --json tagName,name,assets --jq '.tagName + " " + (.assets[].name)'
```

Relevant output:

```text
v0.17.37 OpenWork-Installer-win-x64.exe
v0.17.37 OpenWork-Installer-mac-arm64.dmg
v0.17.37 OpenWork-Installer-mac-x64.dmg
v0.17.37 openwork-win-x64-0.17.37.exe
v0.17.37 openwork-mac-arm64-0.17.37.dmg
v0.17.37 openwork-mac-x64-0.17.37.dmg
```

Verdict: Passed.

### 1 — Server sandbox, seed, app-version, install-config

Command:

```sh
bash .devcontainer/test-server-on-daytona.sh dev
```

Relevant output:

```text
Server sandbox ready: openwork-server-20260722-021938
Den Web:       https://3005-lv9q1sbidbqyuopt.daytonaproxy01.net
Den API:       https://8788-mgwa02yocalp1rkc.daytonaproxy01.net
Worker Proxy:  https://8789-wqv7tjvqewkmkpd6.daytonaproxy01.net
```

Seed command:

```sh
daytona exec openwork-server-20260722-021938 -- "bash -lc 'cd /workspace && pnpm --filter @openwork/email build && cd /workspace/ee/apps/den-api && OPENWORK_DEV_MODE=1 DEN_ORG_MODE=multi_org DATABASE_URL=mysql://root:password@127.0.0.1:3306/openwork_den DEN_DB_ENCRYPTION_KEY=daytona-den-db-encryption-key-please-change-1234567890 BETTER_AUTH_SECRET=daytona-den-auth-secret-please-change-1234567890 BETTER_AUTH_URL=https://3005-lv9q1sbidbqyuopt.daytonaproxy01.net DEN_API_PUBLIC_URL=https://8788-mgwa02yocalp1rkc.daytonaproxy01.net pnpm exec tsx scripts/seed-demo-org.ts --reset'"
```

Relevant output:

```text
den demo seed · Acme Robotics
✓ org: org_01ky4j5xc9esja71bndcr55sx3
✓ 17 members · 12 teams · 3 pending invites
✓ marketplace: mkt_01ky4j5xf8esja71zq1kmzneyx
✓ done in 7.1s
→ login: alex@acme.test / OpenWorkDemo123!
```

Sign-in and install-link mint commands:

```sh
curl -sS -i 'https://8788-mgwa02yocalp1rkc.daytonaproxy01.net/api/auth/sign-in/email' \
  -H 'content-type: application/json' \
  --data '{"email":"alex@acme.test","password":"OpenWorkDemo123!"}'

curl -sS -X POST 'https://8788-mgwa02yocalp1rkc.daytonaproxy01.net/v1/orgs/org_01ky4j5xc9esja71bndcr55sx3/install-links' \
  -H 'authorization: Bearer aCTZadIrbO6FTuBg7QlWIcORggFnhmRX' \
  -H 'content-type: application/json' \
  --data '{}'
```

Relevant output:

```json
{"token":"0yuwj1EYRADM1LJAgDwe2v7TYAiE2MjtbzNEUKgNo8s","installPageUrl":"https://3005-lv9q1sbidbqyuopt.daytonaproxy01.net/install?token=0yuwj1EYRADM1LJAgDwe2v7TYAiE2MjtbzNEUKgNo8s"}
```

App-version check:

```sh
curl -sS 'https://8788-mgwa02yocalp1rkc.daytonaproxy01.net/v1/app-version' | python3 -m json.tool
```

Output:

```json
{
    "minAppVersion": "0.17.0",
    "latestAppVersion": "0.17.30",
    "publishedDesktopVersions": [
        "0.17.37",
        "0.17.36",
        "0.17.35",
        "0.17.34",
        "0.17.33",
        "0.17.32",
        "0.17.31",
        "0.17.30"
    ]
}
```

Install-config check:

```sh
curl -sS 'https://8788-mgwa02yocalp1rkc.daytonaproxy01.net/v1/install-config?token=0yuwj1EYRADM1LJAgDwe2v7TYAiE2MjtbzNEUKgNo8s' | python3 -m json.tool
```

Output:

```json
{
    "appName": "OpenWork",
    "clientName": "Acme Robotics",
    "webUrl": "https://3005-lv9q1sbidbqyuopt.daytonaproxy01.net",
    "apiUrl": "https://8788-mgwa02yocalp1rkc.daytonaproxy01.net",
    "requireSignin": true,
    "logoUrl": null,
    "iconUrl": null,
    "connectUrl": "openwork://connect?code=6eNOZ41Flec2bOACEqvWZ2dc61zzQ1Iz&apiBaseUrl=https%3A%2F%2F8788-mgwa02yocalp1rkc.daytonaproxy01.net",
    "connectExpiresAt": "2026-07-22T09:30:34.000Z"
}
```

Verdict: Failed the required app-version assertion because `latestAppVersion` was `0.17.30`, not `0.17.37`. Install-config otherwise returned Acme Robotics and the public preview URLs.

### 2 — Targeted egress lockdown and outbound observation

Verdict: Not run. I did not add iptables or `/etc/hosts` blocks because the pre-lock redirect probe already hit the explicit stop condition in step 3. Therefore this run does **not** prove server egress behavior. No claim is made that the Den process opened no outbound connections during a Windows flow.

### 3 — Redirect target from the server

Command:

```sh
curl -sSI 'https://8788-mgwa02yocalp1rkc.daytonaproxy01.net/v1/install/win-x64?token=0yuwj1EYRADM1LJAgDwe2v7TYAiE2MjtbzNEUKgNo8s'
```

Output:

```text
HTTP/2 302
location: https://github.com/different-ai/openwork/releases/download/v0.17.30/OpenWork-Installer-win-x64.exe
x-request-id: req_01ky4ja39yfes93ad4w9j7a7xk
```

Verdict: Failed. Expected `https://github.com/different-ai/openwork/releases/download/v0.17.37/OpenWork-Installer-win-x64.exe`. Per the instructions, I stopped the simulation and diagnosed this as a real bug.

Diagnostic command:

```sh
daytona exec openwork-server-20260722-021938 -- "bash -lc 'cd /workspace && git rev-parse HEAD && git log -1 --oneline && printf \"source app-version: \" && sed -n \"1p\" ee/apps/den-api/src/generated/app-version.ts && printf \"desktop package version: \" && node -p \"require(\\\"./apps/desktop/package.json\\\").version\" && printf \"published first: \" && node -e \"import(\\\"./ee/apps/den-api/src/generated/desktop-versions.ts\\\").then(m=>console.log(m.PUBLISHED_DESKTOP_VERSIONS[0]))\"'"
```

Output:

```text
6d209cd04b0a8ab2f73ed15371dcb9007f2631ac
6d209cd chore(aur): update PKGBUILD for 0.17.37
source app-version: export const BUILD_LATEST_APP_VERSION = "0.17.30" as const
desktop package version: 0.17.37
published first: 0.17.37
```

Root cause: `ee/apps/den-api/src/generated/app-version.ts` was stale at `0.17.30`, even though the desktop package and published-version inventory were at `0.17.37`.

### 4 — Windows client download via Den URL

Verdict: Not run. No Windows sandbox was created and no client downloaded installer bytes. Because step 3 redirected to the wrong release tag, following the redirect would have tested v0.17.30 rather than the real v0.17.37 asset.

### 5 — Windows real user flow, sign-in handoff, and rotated-link negative check

Verdict: Not run. No VNC screenshots were captured. No Windows bootstrap was written, so bootstrap profile handling was not exercised in this run.

### 6 — Evidence bundle and branch

Verdict: Partial. This report is the evidence bundle. The requested remote evidence branch is `test/two-door-semi-airgapped-evidence`. Because a local branch named `test` already exists in another worktree, I used local branch `test-two-door-semi-airgapped-evidence` and pushed it to remote `refs/heads/test/two-door-semi-airgapped-evidence`.

### 7 — Follow-up PRs for defects

Opened one fix PR:

- <https://github.com/different-ai/openwork/pull/2992> — `fix(den-api): report newest desktop version`.

Verification run on the fix branch:

```sh
pnpm --filter @openwork-ee/den-api exec bun test test/version.test.ts test/install-link-access.test.ts
pnpm --filter @openwork-ee/den-api build
pnpm --filter @openwork-ee/den-api exec node -e "import('./dist/version.js').then((m) => console.log(JSON.stringify(m.denApiAppVersion)))"
```

Results:

```text
26 pass, 0 fail across 2 files
Den API build passed
{"minAppVersion":"0.17.0","latestAppVersion":"0.17.37"}
```

### 8 — Stop sandboxes

Command:

```sh
daytona sandbox stop openwork-server-20260722-021938
daytona sandbox info openwork-server-20260722-021938
```

Output:

```text
Sandbox openwork-server-20260722-021938 stopped
ID              9b66c9fe-a0ea-4696-9f9c-d2774270890f
State           STOPPING
Region          us
```

Verdict: Server sandbox stopped, not deleted. Windows sandbox was not created.

## Required exact facts

- Server egress: **Not proven**. I stopped before lockdown/observation because the redirect gate failed. The only server download/install byte fact established is that `/v1/install/win-x64` returned a 302 instead of streaming bytes.
- Redirect target: **Wrong**. Actual `Location` was `https://github.com/different-ai/openwork/releases/download/v0.17.30/OpenWork-Installer-win-x64.exe`; expected v0.17.37.
- Who downloaded the bytes: **Nobody in this run**. The Windows client flow was not started; no installer or app bytes were downloaded. The server returned only headers for the redirect probe.
- Bootstrap profile handling on Windows: **Not exercised**. No Windows sandbox, installer run, or interactive-user bootstrap write happened after the redirect blocker.

---

## Resumed run — PR #2992 fix branch validation

Date: 2026-07-22. This run used the pushed PR branch `fix/den-api-latest-desktop-version` at `5449e0f` and is the resumed validation evidence for PR #2992.

### Resumed verdict summary

- Overall: **Partial / redirect fix passed, full two-door flow exposed two new defects**.
- Step 1: **Passed**. Fresh Den server on the fix branch seeded Acme Robotics and reported `latestAppVersion: "0.17.37"`.
- Step 2: **Passed**. `/v1/install/win-x64` returned the exact v0.17.37 GitHub release redirect before and after server-side GitHub egress was blocked.
- Step 3: **Passed with scoped honesty**. GitHub/release-asset hosts were blocked only inside the server sandbox; Daytona control-plane connectivity remained exempt. In-sandbox GitHub curls failed, and `ss -tupn` sampling during the Windows client flow showed no Den/node outbound connections to GitHub hosts.
- Step 4: **Passed**. Windows downloaded `OpenWork-Installer-win-x64.exe` through the Den URL using `curl.exe -L -OJ -v`; the 302 hop was from Den to GitHub and the downloaded file was 114,884,096 bytes with `MZ` magic.
- Step 5a: **Passed**. Bare headless dry run exited setup-required and wrote no bootstrap.
- Step 5b: **Dry-run passed; real generic-installer install failed**. The install-link dry run wrote the Acme/requireSignin bootstrap. The real generic installer downloaded `openwork-win-x64-0.17.37.exe` from GitHub but failed at install with `EBUSY: resource busy or locked, uv_spawn`. I opened PR #2996 for a minimal retry/path fix. To continue the UI validation, I manually ran the downloaded standard app installer as the interactive Administrator user.
- Step 5c: **Passed with documented profile handling**. `daytona exec` is SYSTEM, so I wrote/verified `C:\Users\Administrator\AppData\Local\openwork\desktop-bootstrap.json` via an Administrator scheduled task, installed the standard app under `C:\Users\Administrator\AppData\Local\Programs\@openworkdesktop\OpenWork.exe`, and launched it in the interactive session. Screenshot: `screenshots/windows-app-forced-signin.png`.
- Step 5d: **Passed only after a documented handoff workaround**. Den Web sign-in succeeded, but the generated fallback code contained `denBaseUrl=https://0.0.0.0:3005/api/den`; pasting it into OpenWork failed with `net::ERR_ADDRESS_INVALID`. I opened PR #2995. Replacing only `denBaseUrl` with the public Daytona Den URL let the app complete sign-in to Acme Robotics, and the install page flipped to Connected. Screenshots: `screenshots/den-web-signed-in-open-openwork.png`, `screenshots/windows-app-signed-in-acme.png`, `screenshots/den-install-page-connected.png`.
- Step 5e: **Passed**. After rotating the link server-side, the old link through the installer UI showed `This install link has expired or was replaced. Ask your workspace admin for a fresh one from the Members page.` Screenshot: `screenshots/installer-old-link-expired.png`.

### Resumed sandboxes and URLs

- Server sandbox: `openwork-server-two-door-fix-20260722-0937` / `32711835-499b-4b1a-9755-f1e2c4aa4a30`.
- Windows sandbox: `openwork-win-two-door-fix-20260722-0941` / `a5a17f95-727f-4a18-a2d4-e623a3759769` (`windows-medium`).
- Den Web: `https://3005-w7mhixnvdetgkvcm.daytonaproxy01.net`.
- Den API: `https://8788-ubjh1sgxjasuvky4.daytonaproxy01.net`.
- Worker proxy: `https://8789-l7wj0xhiyhchfgv0.daytonaproxy01.net`.
- Seeded org: `Acme Robotics`, `org_01ky4k41wnendtj3v6cvg9qeq1`.
- Original install token used for the main flow: `E3pv3jroVbPvN_QVKEeHl303eBWJuuY0p_xZsNMqSD8`.
- Rotated replacement token: `YjZOSfIU_MzqPSM1eyspehcgA0dqJ_50lA7s5Gcs2v0`.

### Step 1 — Server up on fix branch, seed, app-version, install link

Command:

```sh
bash .devcontainer/test-server-on-daytona.sh fix/den-api-latest-desktop-version --name openwork-server-two-door-fix-20260722-0937
```

Relevant output:

```text
HEAD is now at 5449e0f fix(den-api): report newest desktop version
OpenWork Daytona server stack ready
Den Web:       https://3005-w7mhixnvdetgkvcm.daytonaproxy01.net
Den API:       https://8788-ubjh1sgxjasuvky4.daytonaproxy01.net
Worker Proxy:  https://8789-l7wj0xhiyhchfgv0.daytonaproxy01.net
Server sandbox ready: openwork-server-two-door-fix-20260722-0937
```

Seed output:

```text
den demo seed · Acme Robotics
✓ org: org_01ky4k41wnendtj3v6cvg9qeq1
✓ 17 members · 12 teams · 14 plugins · 71 config objects
→ login: alex@acme.test / OpenWorkDemo123!
```

Version and link output:

```json
{"minAppVersion":"0.17.0","latestAppVersion":"0.17.37","publishedDesktopVersions":["0.17.37","0.17.36","0.17.35","0.17.34","0.17.33","0.17.32","0.17.31","0.17.30","0.17.29","0.17.28","0.17.27","0.17.26","0.17.25","0.17.24","0.17.23","0.17.22","0.17.21","0.17.20","0.17.19","0.17.18","0.17.17","0.17.16","0.17.15","0.17.14","0.17.13","0.17.12","0.17.11","0.17.10","0.17.9","0.17.8","0.17.7","0.17.6","0.17.5","0.17.4","0.17.3","0.17.2","0.17.1","0.17.0"]}
{"token":"E3pv3jroVbPvN_QVKEeHl303eBWJuuY0p_xZsNMqSD8","installPageUrl":"https://3005-w7mhixnvdetgkvcm.daytonaproxy01.net/install?token=E3pv3jroVbPvN_QVKEeHl303eBWJuuY0p_xZsNMqSD8"}
```

### Step 2 — Redirect gate

Command:

```sh
curl -sSI 'https://8788-ubjh1sgxjasuvky4.daytonaproxy01.net/v1/install/win-x64?token=E3pv3jroVbPvN_QVKEeHl303eBWJuuY0p_xZsNMqSD8'
```

Output:

```text
HTTP/2 302
location: https://github.com/different-ai/openwork/releases/download/v0.17.37/OpenWork-Installer-win-x64.exe
x-request-id: req_01ky4k4w9dencb66rj38pxd4as
```

After server egress lockdown, the same route still returned:

```text
HTTP/2 302
location: https://github.com/different-ai/openwork/releases/download/v0.17.37/OpenWork-Installer-win-x64.exe
x-request-id: req_01ky4k63vnencb66s2gg08xgnm
```

### Step 3 — Server-side egress lockdown and outbound observation

Lockdown applied inside the server sandbox only:

```text
# two-door semi-airgapped GitHub block 2026-07-22
127.0.0.1 github.com api.github.com objects.githubusercontent.com release-assets.githubusercontent.com github-releases.githubusercontent.com
::1 github.com api.github.com objects.githubusercontent.com release-assets.githubusercontent.com github-releases.githubusercontent.com
```

In-sandbox proof:

```text
probe github.com:
curl: (7) Failed to connect to github.com port 443 after 0 ms: Could not connect to server

probe api.github.com:
curl: (7) Failed to connect to api.github.com port 443 after 0 ms: Could not connect to server

probe release-assets.githubusercontent.com:
curl: (7) Failed to connect to release-assets.githubusercontent.com port 443 after 0 ms: Could not connect to server

probe objects.githubusercontent.com:
curl: (7) Failed to connect to objects.githubusercontent.com port 443 after 0 ms: Could not connect to server
```

`ss -tupn` sample during the Windows client flow showed local DB/proxy traffic and Daytona control-plane traffic only. Forbidden-host string counts in `/tmp/two-door-ss-real-install.log`:

```text
github: 0
release-assets: 0
objects.githubusercontent: 0
140.82.: 0
185.199.: 0
```

Representative lines:

```text
tcp ESTAB 127.0.0.1:42006 127.0.0.1:3306 users:(("node-MainThread",pid=1150,fd=34))
tcp ESTAB 127.0.0.1:38436 127.0.0.1:8788 users:(("next-server (v1",pid=1309,fd=37))
tcp ESTAB 172.20.0.15:45872 100.56.148.137:443 users:(("daytona",pid=1,fd=9))
```

The `100.56.148.137:443` line is Daytona control plane/proxy connectivity, intentionally not blocked.

### Step 4 — Windows download through Den URL

Command shape used from PowerShell to preserve the `?token=` URL exactly:

```powershell
& C:\Windows\System32\curl.exe -L -OJ -v 'https://8788-ubjh1sgxjasuvky4.daytonaproxy01.net/v1/install/win-x64?token=E3pv3jroVbPvN_QVKEeHl303eBWJuuY0p_xZsNMqSD8' *> C:\ow\ps-curl-oj-all.txt
```

Relevant verbose output:

```text
> GET /v1/install/win-x64?token=E3pv3jroVbPvN_QVKEeHl303eBWJuuY0p_xZsNMqSD8 HTTP/1.1
> Host: 8788-ubjh1sgxjasuvky4.daytonaproxy01.net
< HTTP/1.1 302 Found
< Location: https://github.com/different-ai/openwork/releases/download/v0.17.37/OpenWork-Installer-win-x64.exe
* Issue another request to this URL: 'https://github.com/different-ai/openwork/releases/download/v0.17.37/OpenWork-Installer-win-x64.exe'
> GET /different-ai/openwork/releases/download/v0.17.37/OpenWork-Installer-win-x64.exe HTTP/1.1
> Host: github.com
< HTTP/1.1 302 Found
< Location: https://release-assets.githubusercontent.com/github-production-release-asset/1133911335/3826d043-3bcd-489c-ac91-c6859b4bd7a2?...filename%3DOpenWork-Installer-win-x64.exe...
```

File proof:

```text
Name          : OpenWork-Installer-win-x64.exe
Length        : 114884096
FirstTwoBytes : 4D 5A
Ascii         : MZ
```

Fact: the bytes came from the Windows client following GitHub/release-asset redirects, not from the Den server.

### Step 5 — Windows installer and app flow

Bare dry run:

```text
whoami=NT AUTHORITY\SYSTEM
LOCALAPPDATA=C:\WINDOWS\system32\config\systemprofile\AppData\Local
bootstrap-before=False
exit=2
[openwork-installer] Installer is not configured. Paste an OpenWork install link, or run with --install-link <url>.
bootstrap-after=False
```

Install-link dry run:

```text
exit=0
OpenWork Installer — Acme Robotics
[openwork-installer] Configured via install link.
[write-config] Writing deployment configuration...
[check-version] Deployment supports OpenWork 0.17.37.
[done] Dry run ok: openwork-win-x64-0.17.37.exe available; config written to C:\WINDOWS\system32\config\systemprofile\AppData\Local\openwork\desktop-bootstrap.json.
```

SYSTEM bootstrap content:

```json
{
  "baseUrl": "https://3005-w7mhixnvdetgkvcm.daytonaproxy01.net",
  "apiBaseUrl": "https://8788-ubjh1sgxjasuvky4.daytonaproxy01.net",
  "requireSignin": true,
  "brandAppName": "OpenWork",
  "writtenAt": "2026-07-22T09:44:57.506Z"
}
```

Real generic-installer install failure:

```text
[download] Downloading OpenWork 0.17.37...
[install] Installing OpenWork...
[install] Install failed.
Install failed: EBUSY: resource busy or locked, uv_spawn
```

Workaround to continue validation:

```text
curl-exit=0
downloaded=231457269
installer-exit=0
Run As User: Administrator
Last Result: 0
C:\Users\Administrator\AppData\Local\Programs\@openworkdesktop\OpenWork.exe exists=True
length=201246720
```

Interactive profile handling:

- `daytona exec` runs as SYSTEM/session 0.
- The visible desktop user was `administrator` in console session 1 (`quser` showed `administrator console 1 Active`).
- I used `schtasks /create /ru Administrator ...` for interactive-user bootstrap/install/launch work.
- Interactive bootstrap path: `C:\Users\Administrator\AppData\Local\openwork\desktop-bootstrap.json`.

Interactive bootstrap content:

```json
{
  "baseUrl": "https://3005-w7mhixnvdetgkvcm.daytonaproxy01.net",
  "apiBaseUrl": "https://8788-ubjh1sgxjasuvky4.daytonaproxy01.net",
  "requireSignin": true,
  "brandAppName": "OpenWork",
  "writtenAt": "2026-07-22T09:49:43.102Z"
}
```

Forced sign-in app proof:

```text
url: file:///C:/Users/Administrator/AppData/Local/Programs/@openworkdesktop/resources/app-dist/index.html#/signin
text: Welcome to OpenWork ... Connected to 3005-w7mhixnvdetgkvcm.daytonaproxy01.net
userAgent: OpenWork/0.17.37 Chrome/134.0.6998.205 Electron/35.7.5
```

Screenshot: `screenshots/windows-app-forced-signin.png`.

Den Web sign-in proof:

```text
You're signed in.
Open the desktop app to continue.
Open OpenWork
Go to dashboard →
```

Screenshot: `screenshots/den-web-signed-in-open-openwork.png`.

Deep-link defect observed before workaround:

```text
openwork://den-auth?grant=dUrk8xhHF6qyvH2HQYmPFrTkaBPMmy-r&denBaseUrl=https%3A%2F%2F0.0.0.0%3A3005%2Fapi%2Fden
Error invoking remote method 'openwork:desktop': Error: net::ERR_ADDRESS_INVALID
```

After replacing only `denBaseUrl` with `https://3005-w7mhixnvdetgkvcm.daytonaproxy01.net/api/den`, the desktop completed cloud sign-in:

```text
OpenWork Cloud
Connected
Signed in as alex@acme.test.
Alex Chen
alex@acme.test
Acme Robotics
Owner · Connected
```

Desktop state also contained:

```json
{
  "openwork.den.activeOrgSlug": "acme-robotics-demo",
  "openwork.den.activeOrgId": "org_01ky4k41wnendtj3v6cvg9qeq1",
  "openwork.den.activeOrgName": "Acme Robotics"
}
```

Screenshot: `screenshots/windows-app-signed-in-acme.png`.

Install page connected proof:

```text
3
Sign in — this page will confirm when you're connected.
✓ Connected — OpenWork is set up for Acme Robotics
```

Screenshot: `screenshots/den-install-page-connected.png`.

Rotated-link negative check:

```text
{"token":"YjZOSfIU_MzqPSM1eyspehcgA0dqJ_50lA7s5Gcs2v0","installPageUrl":"https://3005-w7mhixnvdetgkvcm.daytonaproxy01.net/install?token=YjZOSfIU_MzqPSM1eyspehcgA0dqJ_50lA7s5Gcs2v0"}
This install link has expired or was replaced. Ask your workspace admin for a fresh one from the Members page.
```

Screenshot: `screenshots/installer-old-link-expired.png`.

### New defects and follow-up PRs

- PR #2995: <https://github.com/different-ai/openwork/pull/2995> — `fix(den-api): use public URL for desktop handoff`. This targets the `0.0.0.0` desktop-handoff URL bug. Validation: `pnpm --filter @openwork-ee/den-db build` and `pnpm --filter @openwork-ee/den-api exec bun test test/desktop-handoff-public-url.test.ts` (1 pass).
- PR #2996: <https://github.com/different-ai/openwork/pull/2996> — `fix(installer): retry busy Windows app launch`. This targets the generic installer `EBUSY: resource busy or locked, uv_spawn` failure and the actual `@openworkdesktop` install directory. Validation: `pnpm --filter @openwork/installer test` (22 pass). This PR was **not** revalidated in the Windows sandbox after packaging; it is a minimal code follow-up from the observed defect.

### Resumed required exact facts

- Server egress: **GitHub blocked inside server only** via `/etc/hosts` to loopback. Daytona control plane was intentionally exempt. Server-side curls to `github.com`, `api.github.com`, `release-assets.githubusercontent.com`, and `objects.githubusercontent.com` failed. `ss -tupn` during the Windows flow showed no GitHub/release-asset/object connections from Den/node.
- Redirect target: **Correct** — `https://github.com/different-ai/openwork/releases/download/v0.17.37/OpenWork-Installer-win-x64.exe`.
- Who downloaded bytes: **The Windows client** downloaded installer bytes by following Den's 302 to GitHub/release-assets. The Den server did not stream or cache the installer.
- Windows bootstrap profile handling: **SYSTEM and interactive profiles are different**. SYSTEM dry runs wrote `C:\WINDOWS\system32\config\systemprofile\AppData\Local\openwork\desktop-bootstrap.json`. The visible app used `C:\Users\Administrator\AppData\Local\openwork\desktop-bootstrap.json`, written via an Administrator scheduled task because `daytona exec` runs as SYSTEM.

### Stop sandboxes after resumed run

Command:

```sh
daytona stop openwork-server-two-door-fix-20260722-0937
daytona stop openwork-win-two-door-fix-20260722-0941
daytona info openwork-server-two-door-fix-20260722-0937
daytona info openwork-win-two-door-fix-20260722-0941
```

Output:

```text
Sandbox openwork-server-two-door-fix-20260722-0937 stopped
Sandbox openwork-win-two-door-fix-20260722-0941 stopped

ID              32711835-499b-4b1a-9755-f1e2c4aa4a30
State           STOPPED
Region          us

ID              a5a17f95-727f-4a18-a2d4-e623a3759769
State           STOPPED
Snapshot        windows-medium
Region          us
```
