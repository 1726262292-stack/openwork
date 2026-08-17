# Handoff — Library + composer + menu (Den inventory)

**Branch:** `feat/library-composer-connections` (pushed for handoff; do not force-push).
Work started on a dirty `dev` checkout at
`/Users/benjaminshafii/openwork-enterprise/_repos/openwork`. Next agent: `git fetch`
and check out this branch (or a worktree from it). Do not push `dev`.

Conversation: [Library composer inventory](4b6e113a-57ad-4615-aec9-f2aeac776d78)

## Goal

Library is the inventory for composer capabilities (aligned with Den My Library).
Composer **+** should show what you have on Den, with easy sign-in. Connections and
MCPs are one thing: **Connections (MCPs)**.

## What landed (uncommitted, this checkout)

- Library lists, Den-only Add (signed-in modal → `POST /v1/plugins`; signed-out Add hidden).
- Plugin/connection detail; Den My Library row links.
- Create-skill empty-state flash fix (wait for library + optimistic plugin).
- Composer **+**:
  - One pane **Connections (MCPs)** (MCPs + Connections merged).
  - Lists Den org connections (`useOrgMcpConnections`) plus leftover local / Connect MCP rows.
  - Dedupe: plugin MCP that maps to an org connection id is not listed twice.
  - **Connect your account / Reconnect** on the row when member OAuth needs it.
  - Configure from that pane opens Library `connections`.
  - **Scroll:** + panel now has a definite `height` (was `maxHeight` only + `overflow-hidden`, so lists clipped with no scroll). Left nav and right list are `overflow-y-auto`. Cap raised 352 → 520.

Helpers: `composer-connections.ts`, tests in `apps/app/tests/composer-connections.test.ts`.

## Honest gaps (why it still feels split)

These are **not** fully unified. Do not claim they are.

1. **Agents and commands:** Add is Den (`POST /v1/plugins` with agent/command files). The Library **Agents / Commands tabs and the + panes** are still the **local OpenCode** lists (`app.agents()`, slash `source: command` on this device). Creating on Den does not write `.opencode/agents` / commands on disk.
2. **MCPs: three surfaces remain in the product, even if + is one list:**
   - local workspace MCP (`listMcp` / OpenCode config)
   - Den plugin remote MCP (Connect inventory)
   - org connection records (`listMcpConnections`, native Gmail / M365 / remote MCP)
   Library still has separate **MCPs** vs **Connections** filters. + Configure goes to **connections** only.
3. **Skills:** mixed list (local disk + Connect), Add is Den-only.
4. **Connectors:** Library cards are org connection records. Composer **+** now prefers those same records, then leftover MCP servers. Local MCP **needs_auth** still has **no Sign in** in + (settings / `mcp auth` modal only).
5. **No testkit tape** for the + menu UI. Unit tests only. Runtime proof is Incomplete until a `.slow.test.ts` asserts the merged pane, Den rows, and sign-in control.

## Next (in order)

1. Check out `feat/library-composer-connections` (or a worktree from it); do **not** push `dev`.
2. Prove + scroll with a long skills/connections list (clipped before).
3. Sign in from + for a Den connection with `needs_signin`; confirm browser OAuth + row flips to connected.
4. Decide whether Library filters should also merge MCPs + Connections (user asked for +; Library still split).
5. If unifying agents/commands: either list Den plugin agents/commands in those tabs, or stop advertising Add as creating the thing the tab shows.
6. `pnpm --filter @openwork/app test` for `composer-connections` + `library-destination`. Then a testkit spec if shipping.

## Key files

| Area | Path |
|---|---|
| + menu | `apps/app/src/react-app/domains/session/surface/composer/composer.tsx` |
| Merge / sign-in | `.../composer/composer-connections.ts` |
| Org OAuth | `.../connections/use-org-mcp-connections.ts` |
| Library routing | `.../settings/library.ts` |
| Connect MCP → connection id | `.../connect-capability-inventory.ts` `toMcpEntries` |
| Library UI | `.../pages/mcp-view.tsx`, `add-library-item-modal.tsx` |

## Commands already useful

```bash
cd apps/app && bun test tests/composer-connections.test.ts tests/library-destination.test.ts
```
