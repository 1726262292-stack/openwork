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
