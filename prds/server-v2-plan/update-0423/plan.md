# Server V2 Catch-Up Plan

## Date

2026-04-23

## Scope

- Baseline start: `12900a0` (`server-v2` merge). This is the starting snapshot, so it is not treated as a catch-up commit.
- Cutoff: `2e440d4` (desktop React cutover). This commit is included because it landed before the pause ended and it contains a small amount of real server/app behavior in addition to framework-port churn.
- Reviewed range: `12900a0..2e440d4`.
- Result: 14 commits in the range touched `apps/app` or `apps/server`.
- Result: 5 of those 14 are version-only package bumps and can be ignored for migration work.
- Result: 9 commits contain behavior or contract changes that matter to `server-v2`, plus one framework cutover commit with a few important non-UI carry-forwards.

## What Server V2 Needs To Catch Up First

1. Cloud bootstrap, sign-in, and active-org semantics.
   The post-merge app now assumes persisted desktop bootstrap config, optional forced sign-in, Better Auth active-org switching, and org-scoped config fetches.
2. Desktop restriction and update-gating contracts.
   The app now enforces org restrictions and desktop update eligibility from cloud config, not just local client heuristics.
3. Cloud provider provisioning and sync behavior.
   Provider import/sync now assumes periodic reconciliation with cloud, and provider identity is keyed by cloud provider ID rather than provider-family ID.
4. Transport and server behavior from the React cutoff.
   The React port itself is not the migration target, but `apps/server/src/server.ts` picked up proxy-response sanitization and a dev log sink, and the app started depending on better streaming transport behavior.
5. App-side SDK shape changes.
   New provider/model metadata assumptions landed after the `server-v2` start and should be honored by the replacement path.

## Contracts And Behaviors To Preserve

- `GET /v1/app-version` with at least `latestAppVersion`, and compatibility with `minAppVersion`.
- `GET /v1/me` for authenticated session restore.
- `GET /v1/me/orgs` returning active-org information.
- `POST /api/auth/organization/set-active` to switch active org server-side.
- `GET /v1/me/desktop-config` for org-scoped desktop restrictions and update controls.
- `POST /v1/auth/desktop-handoff/exchange` for desktop sign-in handoff.
- Active-org-scoped routes now fetched without org identifiers in the URL, including workers, templates, skills, skill hubs, and LLM providers.
- Cloud provider sync keyed by cloud provider ID, with `sourceProviderId` preserved separately.
- Proxy behavior that strips stale transport headers from already-decoded upstream responses.
- Optional `GET /dev/log` and `POST /dev/log` dev-log behavior if we want to keep current debugging tooling.

## Commit Inventory

### `7bb7e524` `chore(deps): pin opencode CLI + SDK to v1.4.9 (#1471)`

- Touches: `apps/app`
- What changed: no user-facing feature, but the app adapted to new SDK/provider metadata shapes. Reasoning moved under `model.capabilities.reasoning`, provider config handling became more direct, and session todo typing was adjusted.
- Important files: `apps/app/package.json`, `apps/app/src/app/context/model-config.ts`, `apps/app/src/app/context/session.ts`, `apps/app/src/app/lib/model-behavior.ts`, `apps/app/src/app/utils/providers.ts`
- Server-v2 action: adapt. Any replacement server path that feeds provider/model metadata into the app should match the newer SDK shape, especially `capabilities.reasoning`.

### `85ab73bc` `feat(den): gate desktop updates by supported version (#1476)`

- Touches: `apps/app`
- What changed: desktop updates are now hidden unless cloud version metadata says the offered update is supported. The app fetches `/v1/app-version` and only shows a Tauri update when the available version is less than or equal to `latestAppVersion`.
- Important files: `apps/app/src/app/lib/den.ts`, `apps/app/src/app/system-state.ts`
- Server-v2 action: port. `server-v2` should preserve the `/v1/app-version` contract and fail-closed behavior for unsupported or unknown versions.

### `ac41d58b` `feat(den): use Better Auth active org context (#1485)`

- Touches: `apps/app`
- What changed: org-aware cloud flows stopped passing org identifiers through resource URLs and started relying on server-side active-org context instead. The org picker now performs a real server-side org switch, and follow-up calls fetch workers, templates, skills, hubs, and LLM providers from active-org routes.
- Important files: `apps/app/src/app/components/den-settings-panel.tsx`, `apps/app/src/app/lib/den.ts`, `apps/app/src/app/workspace/create-workspace-modal.tsx`
- Server-v2 action: port. The replacement path should preserve active-org switching via `POST /api/auth/organization/set-active`, `GET /v1/me/orgs`, and active-org-scoped resource routes such as `/v1/workers`, `/v1/templates`, `/v1/skills`, `/v1/skill-hubs`, and `/v1/llm-providers`.

### `da9a4f24` `feat(desktop): persist desktop bootstrap and org restrictions (#1479)`

- Touches: `apps/app`
- What changed: this is the biggest post-start change for cloud-connected desktop behavior. It added persistent desktop bootstrap config, optional forced sign-in, org-scoped desktop-config fetches, active-org restore/sync during auth hydration, and tighter handling of cloud base URLs and API base URLs.
- Important files: `apps/app/src/app/app.tsx`, `apps/app/src/app/cloud/den-auth-provider.tsx`, `apps/app/src/app/cloud/desktop-config-provider.tsx`, `apps/app/src/app/cloud/forced-signin-page.tsx`, `apps/app/src/app/cloud/den-signin-surface.tsx`, `apps/app/src/app/lib/den.ts`, `apps/app/src/app/lib/den-session-events.ts`, `apps/app/src/app/lib/tauri.ts`, `apps/app/src/app/system-state.ts`, `apps/app/src/app/components/den-settings-panel.tsx`, `apps/app/src/app/workspace/create-workspace-modal.tsx`, `apps/app/src/app/pages/skills.tsx`, `apps/app/src/app/entry.tsx`, `apps/app/src/index.tsx`, `apps/app/src/app/types.ts`
- Server-v2 action: port. Preserve bootstrap compatibility around `baseUrl`, `apiBaseUrl`, `requireSignin`, desktop handoff exchange, authenticated restore, active-org sync, and `GET /v1/me/desktop-config`.

### `3ac290fa` `chore: bump version to 0.11.208`

- Touches: `apps/app`, `apps/server`
- What changed: version bump only.
- Important files: `apps/app/package.json`, `apps/server/package.json`
- Server-v2 action: ignore.

### `f0e4f6db` `chore: bump version to 0.11.209`

- Touches: `apps/app`, `apps/server`
- What changed: version bump only.
- Important files: `apps/app/package.json`, `apps/server/package.json`
- Server-v2 action: ignore.

### `872c2176` `chore: bump version to 0.11.210`

- Touches: `apps/app`, `apps/server`
- What changed: version bump only.
- Important files: `apps/app/package.json`, `apps/server/package.json`
- Server-v2 action: ignore.

### `9462b41c` `feat(app): enforce desktop restriction policies (#1505)`

- Touches: `apps/app`
- What changed: the client now actively enforces org desktop restrictions. That includes hiding blocked provider/model paths, preventing forbidden provider-auth flows, reconciling invalid existing selections to allowed fallbacks, and persisting provider disconnects into workspace `opencode.jsonc` through `disabled_providers`.
- Important files: `apps/app/src/app/app.tsx`, `apps/app/src/app/cloud/desktop-app-restrictions.ts`, `apps/app/src/app/cloud/desktop-config-provider.tsx`, `apps/app/src/app/components/restriction-notice-modal.tsx`, `apps/app/src/app/context/model-config.ts`, `apps/app/src/app/context/providers/provider-auth-modal.tsx`, `apps/app/src/app/context/providers/store.ts`, `apps/app/src/app/lib/den.ts`
- Server-v2 action: port and adapt. Preserve the desktop-config restriction contract, especially fields such as `blockZenModel`, `disallowNonCloudModels`, and any related org restriction fields. Also make sure the replacement path can read and write workspace config in a way that keeps `disabled_providers` synchronized.

### `aa8f39e3` `feat(app): auto-sync cloud providers (#1509)`

- Touches: `apps/app`
- What changed: the app now automatically reconciles workspace providers against the active cloud org on sign-in, on app or workspace changes, every 5 minutes, and when Cloud settings is opened. Sync removes stale providers, re-imports changed ones, and adds newly available cloud-managed providers.
- Important files: `apps/app/src/app/app.tsx`, `apps/app/src/app/cloud/sync/constants.ts`, `apps/app/src/app/components/den-settings-panel.tsx`, `apps/app/src/app/context/providers/store.ts`, `apps/app/src/app/pages/settings.tsx`, `apps/app/src/app/shell/settings-shell.tsx`
- Server-v2 action: port. The new path should preserve provider reconciliation behavior and the sync triggers, or provide an adapter that makes the app observe the same provider lifecycle.

### `022b68a8` `feat(app): key cloud providers by cloud id (#1510)`

- Touches: `apps/app`
- What changed: imported cloud providers stopped being keyed by provider-family IDs like `openai` and started being keyed by the cloud provider's own stable ID. The app now preserves both the cloud-managed provider ID and the `sourceProviderId` used for family-specific logic.
- Important files: `apps/app/src/app/cloud/import-state.ts`, `apps/app/src/app/components/den-settings-panel.tsx`, `apps/app/src/app/components/model-picker-modal.tsx`, `apps/app/src/app/components/provider-icon.tsx`, `apps/app/src/app/context/model-config.ts`, `apps/app/src/app/context/providers/provider-auth-modal.tsx`, `apps/app/src/app/context/providers/store.ts`, `apps/app/src/app/lib/model-behavior.ts`, `apps/app/src/app/pages/session.tsx`, `apps/app/src/app/pages/settings.tsx`
- Server-v2 action: port. Do not keep assuming cloud-managed providers are keyed by vendor family. The replacement path should preserve the separation between cloud provider ID, local managed provider key, and `sourceProviderId`.

### `ccdb46d1` `chore: bump version to 0.11.211`

- Touches: `apps/app`, `apps/server`
- What changed: version bump only.
- Important files: `apps/app/package.json`, `apps/server/package.json`
- Server-v2 action: ignore.

### `e97a11d4` `chore: bump version to 0.11.212`

- Touches: `apps/app`, `apps/server`
- What changed: version bump only.
- Important files: `apps/app/package.json`, `apps/server/package.json`
- Server-v2 action: ignore.

### `daff81be` `feat(app): gate desktop updates by org config (#1512)`

- Touches: `apps/app`
- What changed: desktop updates now wait for cloud auth hydration and then additionally require the active org's desktop config to allow that exact version through `allowedDesktopVersions`. If the org config cannot be fetched, the update is suppressed instead of shown.
- Important files: `apps/app/src/app/app.tsx`, `apps/app/src/app/cloud/den-auth-provider.tsx`, `apps/app/src/app/cloud/desktop-app-restrictions.ts`, `apps/app/src/app/lib/den.ts`, `apps/app/src/app/system-state.ts`
- Server-v2 action: port. Preserve org-scoped desktop config with `allowedDesktopVersions`, plus the existing app-version metadata check.

### `2e440d4` `Task/react port cutover react only workspace fixes (#1470)`

- Touches: `apps/app`, `apps/server`
- What changed: most of this commit is Solid-to-React port churn and should not be copied as part of `server-v2` catch-up. The parts that do matter are: proxy response sanitization in the server so browser clients do not choke on decoded-but-still-gzipped-looking responses, optional `/dev/log` probe and append endpoints for local debugging, app transport changes that route streaming endpoints through native `fetch` instead of the Tauri HTTP plugin, better desktop boot publication of the real engine base URL, and a few session/workspace flows that now assume server-backed rename/delete/create behavior works correctly.
- Important files: `apps/server/src/server.ts`, `apps/app/src/app/lib/opencode.ts`, `apps/app/src/app/lib/openwork-server.ts`, `apps/app/src/react-app/shell/debug-logger.ts`, `apps/app/src/react-app/shell/desktop-runtime-boot.ts`, `apps/app/src/react-app/shell/session-route.tsx`, `apps/app/src/react-app/**`
- Server-v2 action: adapt. Preserve proxy header sanitization, streaming-endpoint expectations, and optionally the `/dev/log` behavior if we want to keep current debug tooling. Ignore the React framework port itself.

## Practical Catch-Up Order

1. Replicate cloud bootstrap, forced-signin, active-org, and desktop-config contracts first.
2. Replicate desktop restriction enforcement and update gating next, because those now shape core app startup and provider/model availability.
3. Replicate cloud provider sync and cloud-ID-based provider identity before porting more provider UX, otherwise the migrated app will drift from cloud state.
4. Carry over the small but important transport and proxy fixes from `2e440d4` so the migrated app does not regress in browser or desktop-hosted mode.
5. Treat the version bumps as noise and the React cutover as a source of targeted behavioral deltas, not as a migration blueprint.

## Notes

- `apps/server` changed meaningfully in this range only in `2e440d4`; the other `apps/server` touches are version bumps.
- The strongest evidence for missing `server-v2` catch-up is around desktop bootstrap, org-scoped restrictions, update gating, and cloud-managed LLM provider identity and sync.
- Subagents were used to inspect the relevant commits in parallel and collapse the results into this catch-up list.
