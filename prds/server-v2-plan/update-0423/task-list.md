# Server V2 Catch-Up Task List

## Goal

Bring `apps/server-v2` up to parity with the post-`12900a0` features documented in `plan.md`, while keeping new behavior owned by the server instead of re-adding it in the desktop app.

## Implementation Rules

- Build new behavior in `apps/server-v2/**`, not in `apps/server/**` and not as app-only logic.
- The app should consume typed `server-v2` routes and schemas. It should not become the source of truth for org restrictions, update gating, cloud provider reconciliation, or active-org state.
- If a behavior needs local persistence or workspace mutation, expose it through `server-v2` APIs instead of Tauri-only helpers.
- If a behavior already exists in the legacy app, treat that app code as a reference implementation, not the final ownership layer.

## Task 1: Add Cloud Bootstrap And Auth Foundations

- Build `server-v2` routes and schemas for desktop bootstrap and sign-in handoff.
- Implement support for `baseUrl`, `apiBaseUrl`, and `requireSignin` in server-owned bootstrap/config responses.
- Implement authenticated restore flows behind `GET /v1/me` and `POST /v1/auth/desktop-handoff/exchange`.
- Put route definitions, response schemas, and service logic in dedicated `server-v2` modules such as `routes/cloud.ts`, `schemas/cloud.ts`, and `services/cloud-auth.ts`.
- Definition of done: the app can boot against `server-v2`, restore a signed-in session, and determine whether forced sign-in is required without needing new app-side policy logic.

## Task 2: Add Better Auth Active-Org Semantics

- Implement `POST /api/auth/organization/set-active` in `server-v2`.
- Implement `GET /v1/me/orgs` so the app can fetch `activeOrgId` and `activeOrgSlug` from the server.
- Move all org-sensitive cloud reads to active-org-aware server routes rather than app-constructed org-specific URLs.
- Implement server-owned active-org resolution in the request layer so downstream handlers automatically scope to the active org.
- Definition of done: workers, templates, skills, skill hubs, and LLM providers can all be fetched from active-org-aware routes without the app manually threading org IDs everywhere.

## Task 3: Add Desktop Config And Restriction Contracts

- Implement `GET /v1/me/desktop-config` in `server-v2`.
- Define a single server-v2 schema for desktop restrictions, including `blockZenModel`, `disallowNonCloudModels`, `allowedDesktopVersions`, and any other org-scoped restriction fields the app already expects.
- Put restriction evaluation and payload shaping in a service module rather than mixing it into handlers.
- Make the server response stable enough that the desktop app only needs to render and enforce what the server declares.
- Definition of done: the app can fetch one org-scoped config payload from `server-v2` and use it as the source of truth for restriction and update policy decisions.

## Task 4: Add Version Gating To The Server

- Implement `GET /v1/app-version` in `server-v2`.
- Preserve compatibility with `latestAppVersion` and `minAppVersion`.
- Keep the endpoint fail-closed from the client's perspective by returning trustworthy metadata instead of relying on the app to infer support.
- Put version comparison and release-policy logic in a server service such as `services/version-policy.ts`.
- Definition of done: the app can decide whether a desktop update is eligible using only server-supplied metadata and org desktop config.

## Task 5: Add Cloud LLM Provider Catalog Endpoints

- Implement active-org-scoped LLM provider routes in `server-v2`, including list and connect surfaces.
- Preserve the identity split between cloud provider ID and `sourceProviderId`.
- Make the server response shape explicit enough that the app does not need to guess provider family from local state.
- Match the newer metadata shape expected by the app, including provider/model capabilities used by model config and reasoning behavior.
- Definition of done: the app can fetch the provider catalog from `server-v2` and treat cloud provider IDs as the stable identity key.

## Task 6: Add Server-Owned Cloud Provider Reconciliation

- Move provider import and reconciliation logic behind `server-v2` operations instead of leaving it as app-owned diff logic.
- Add server routes or commands for listing available org providers, importing them into a workspace, updating changed provider records, and removing stale ones.
- Keep reconciliation logic keyed by cloud provider ID, not by vendor-family IDs like `openai`.
- Implement the behavior so the desktop app can trigger sync, but the server decides what add, update, and remove operations are required.
- Definition of done: a workspace can be reconciled against the active org by calling `server-v2`, and the app only needs to request the sync and refresh rendered state.

## Task 7: Add Workspace Config Mutation For Provider Restrictions

- Implement `server-v2` endpoints for reading and mutating workspace config related to provider enablement, including `disabled_providers`.
- Keep config read and write behavior server-owned so cloud restrictions and disconnect flows do not depend on Tauri-only filesystem mutation.
- Reuse the broader `server-v2` rule that workspace-scoped mutations belong to the server.
- Put JSONC parsing and mutation helpers in dedicated config modules instead of route handlers.
- Definition of done: provider disconnects, restriction reconciliation, and future provider policy changes can all persist through `server-v2` APIs.

## Task 8: Carry Over Transport And Proxy Fixes

- Port proxy response sanitization into `server-v2` so upstream decoded responses do not leak stale `content-encoding`, `content-length`, or `transfer-encoding` headers.
- Preserve streaming-friendly behavior for SSE-style routes that the app consumes.
- Decide whether `server-v2` should also own the `/dev/log` debugging contract. If yes, implement the same probe and append behavior behind a dev-only guard.
- Keep these behaviors in shared proxy and transport helpers so they apply consistently across `server-v2` upstream integrations.
- Definition of done: browser and desktop-hosted clients can call proxied and streaming endpoints through `server-v2` without decode failures or transport regressions.

## Task 9: Expose Typed Schemas And SDK Surfaces

- Add or update `server-v2` schemas for every new route above.
- Regenerate the OpenAPI output and typed SDK after the routes are added.
- Keep the app cutover limited to consuming the generated client and removing legacy-path calls. Do not move policy logic into the app during the cutover.
- Definition of done: every catch-up behavior has a typed `server-v2` contract and can be consumed from one app-side client layer.

## Task 10: Validate The Whole Flow End To End

- Verify forced sign-in boot.
- Verify active-org switching and org-scoped resource reads.
- Verify desktop-config fetch and restriction enforcement inputs.
- Verify app-version gating and org-allowed desktop versions.
- Verify cloud provider fetch and reconcile behavior using cloud IDs.
- Verify workspace config persistence for disabled providers.
- Verify proxy and streaming behavior through `server-v2`.
- Definition of done: the desktop app can exercise all catch-up flows against `server-v2` without depending on legacy server behavior for the same feature.

## Recommended Build Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8
9. Task 9
10. Task 10

## Explicit Non-Goals

- Do not port the React framework migration itself into this plan.
- Do not add new app-only restriction logic as a shortcut.
- Do not keep using legacy server routes as the long-term source of truth once the `server-v2` equivalents exist.
- Do not treat version-only package bumps as implementation work.
