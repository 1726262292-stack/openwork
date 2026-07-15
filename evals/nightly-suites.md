# Nightly suites

The ~170 coded flows under [`flows/`](./flows) are grouped into eight named
**suites** — unified product journeys the nightly run exercises end to end.
A flow opts in with `suite: "<id>"` and `suiteOrder: <n>` (its position in
the journey). Flows without a suite are standalone (release/installer
contracts, one-off internal demos, analytics harnesses) and still run under
`--all`.

## Run overnight

```bash
pnpm evals:nightly                  # den stack + every suite, one report
pnpm evals:nightly --max-skips 40   # fail the run when skips exceed budget
pnpm evals --suite nightly-connect  # one suite, ad hoc
pnpm evals --stack-down             # stop what the stack started
```

`pnpm evals:nightly` brings up the local Den stack (MySQL, schema, den-api,
demo seed, den-web, desktop bootstrap + dev Electron — see the `--stack den`
section in [README.md](./README.md)) and runs the suites in dependency order
below. One `evals/results/<run-id>/` directory carries the whole night:
`report.md`, `report.json`, and the frame-by-frame `fraimz.html`.

Suites run in this order because `nightly-cloud-admin` builds the org state
(connections, policies, providers, marketplace content) that
`nightly-cloud-member` then consumes from the member's desktop.

Env-gated flows skip cleanly when their environment is missing — the stack
provides `OPENWORK_EVAL_DEN_API_URL` / `_TOKEN` / `_WEB_URL` /
`_MYSQL_CONTAINER` / `_MYSQL_DATABASE`; landing/docs suites additionally
need `OPENWORK_EVAL_LANDING_URL` / `OPENWORK_EVAL_DOCS_URL`, and a few flows
need platform-admin or web-CDP credentials. **Scheduled runs should pass
`--max-skips`** so a misconfigured stack fails loudly instead of reporting a
green run that silently skipped its coverage.

To schedule: run `pnpm evals:nightly --max-skips <n>` from cron, a scheduled
CI job, or a Daytona sandbox (see [daytona-flows.md](./daytona-flows.md));
the exit code is non-zero on any failure or a blown skip budget.

## The suites

| Order | Suite | Flows | Environment | Journey |
|---|---|---|---|---|
| 1 | `nightly-desktop-core` | 27 | local app | Boot → onboarding → chat round-trip → session tabs/history/groups → search/find (cross-session, in-chat, split-screen) → artifacts (markdown, PDF, overflow, narrow header) → built-in browser tabs → composer paste/attachments → model-missing prompt → notifications → Command-K/settings → diagnostics/analytics/voice context |
| 2 | `nightly-extensions-local` | 9 | local app | Extensions & MCP without cloud: settings render, marketplace update filters, hidden built-in MCPs, control-pane cleanup, portable export (secret redaction), OAuth silent reauth, cloud MCP force-sync, white-label policies, UI-control opt-in |
| 3 | `nightly-connect` | 10 | local app + Den (+ docs/landing) | OpenWork Connect end to end: Connect tab pitch and org MCP cards → cloud/desktop capability partition → delivery switch → legacy extension gating → agent diagnostics → lifecycle status → docs/landing installer → keyless Den connect → full landing-to-OAuth-to-MCP reliability → connector health recovery |
| 4 | `nightly-cloud-admin` | 26 | Den stack | The owner configures the org: MCP connections (edit/diagnose, Google/Slack OAuth UX, Slack/Exa/Microsoft 365/Telegram), Google Workspace setup + scopes, provider import/sync + Azure editors, desktop policies + starter prompts, branding (icon/display/uploads/assets), capability flags, publishing skills/plugins |
| 5 | `nightly-cloud-member` | 31 | Den stack + app | The member receives it all: sign-in funnel → cloud MCP auto-config/reliability/disable → org MCP connect + member-scoped grants → OAuth conformance + durable auth → marketplace installs with secret boundaries → search/execute capabilities, tool catalog, memory → Google Workspace as the member → external MCP clients → workspace reauth |
| 6 | `nightly-den-web` | 15 | Den stack | Dashboard UX: sign-in resolution, sidebar (simplified/brand icon/logout), UI consistency, connections treatment, org-scope pinning, single-org/SSO/signup-policy modes, reauth journeys, provider editors |
| 7 | `nightly-membership` | 12 | Den stack (+ web CDP) | Invites & install funnel: invite to desktop, adoption without duplicates, beyond-free-seats, invite emails, org install links, org-aware downloads, allowed-version matching, download feedback, on-prem server URL, upgrade URL persistence, update targeting, Windows install branding |
| 8 | `nightly-landing` | 5 | `OPENWORK_EVAL_LANDING_URL` | Website: download card, paper shader scope, connect-MCP story, hero prompt analytics, PostHog prod gate |

`pnpm evals --list` shows every flow's suite tag; `pnpm evals --list --suite
<id>` prints one suite in journey order.

## Conventions

- One journey per suite: earlier frames create the state later frames use;
  keep `suiteOrder` meaningful, not alphabetical.
- A flow belongs to at most one suite. Aliases that spread another flow
  (e.g. `desktop-org-mcp-consolidation`) must clear `suite`/`suiteOrder` so
  coverage does not run twice.
- Env-gated members belong in the suite that matches their journey even if
  most environments skip them — the nightly stack is the environment they
  are written for, and `--max-skips` keeps the skipping honest.
- Standalone (untagged) flows are intentional: release/installer contracts,
  Daytona/Windows-specific proofs, analytics mock harnesses, and internal
  DX demos run per-PR or via `--all`, not in the nightly journey.
