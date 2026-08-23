# OpenWork tests and test evidence

All executable coverage lives in [`specs/**/*.test.ts`](./specs) and imports
`test` from `@openwork/testkit`. Tests that drive Electron, Den, or another app
surface use `.e2e.test.ts`.

## Paved path

Use the skills in this order:

1. `write-a-spec`
2. `run-tests`
3. `diagnose-a-red-run` when the run fails
4. `publish-evidence` for the existing ambient test evidence

Demo-driven features start from a preset or world plus a spec in `evals/specs`.

## Install and run

`evals/` is a standalone pnpm workspace so its tooling cannot affect product
installs or image builds.

```bash
pnpm --dir evals install
pnpm evals:pr
pnpm evals:e2e app-smoke
```

### E2E CLI

Run the E2E lane with `pnpm evals:e2e [test-names...]`. Naming a test
auto-satisfies the opt-in flags declared in its source, but value-bearing
environment variables such as `OPENWORK_EVAL_MODEL` are never auto-set. Vision
judging is deferred by default; add `--with-llm-vision` to judge inline. Use
`--local` to force isolated local resources, `--daytona` for Daytona resources,
`--den <url>` to reuse Den, or `--publish --pr <number>` to judge and publish
existing evidence. Without a placement flag, the CLI preserves the ambient
placement environment.

| Exit | Named test | Unfiltered E2E suite | Publish |
| --- | --- | --- | --- |
| `0` | Passed | Passed, or incomplete with expected skips | Published |
| `1` | Failed | Failed | Failed claims published, or publish failed |
| `2` | Incomplete because it skipped | Not used | Claims pending judgment |

See `run-tests` for environment requirements and the cold-boot verdict check.

## Authoring contract

- Import `test` from `@openwork/testkit`.
- Name app-driving files `<slug>.e2e.test.ts`; app-less tests use `<slug>.test.ts`.
- Acquire resources in dependency order with `needs()` → `server()` → `app()`.
- Drive user-visible behavior and assert observable outcomes. Backend, file,
  and process checks may witness side effects but do not replace the journey.
- Bound every wait and declare external requirements in `needs()` so missing
  dependencies skip with a named reason.
- Assert both positive and negative sides of identity or permission boundaries.

## Layers

Imports only point down: a layer may use lower layers, never a higher layer.
This is enforced by `pnpm --dir evals run lint:layers`.

| Layer | Contents | Rule |
| --- | --- | --- |
| L0 | `@openwork/matchers` | Turn supplied facts into pure findings; no I/O. |
| L1 | `@openwork/cdp`, `@openwork/labs` | Provide protocol and lab primitives; do not own journeys or test lifecycle. |
| L2 | `@openwork/behaviors` | Provide framework-free actions and observations over narrow handles. |
| L3 | `@openwork/env` | Own environment lifecycle and composition; do not depend on Vitest. |
| L4 | `@openwork/testkit`, `evals/bin/evals.mjs`, and the world CLI | Adapt environments to specs, Vitest, evidence, and command-line entrypoints. |

## Composable packages and diagnostics

The packages under [`packages/`](./packages) are independently consumable, but
executable coverage is always assembled as a test under `specs/`.

| Package | Owns |
| --- | --- |
| `@openwork/env` | environment lifecycle: places, Den server, desktop apps, mocks, worlds/presets/snapshots, kind stack |
| `@openwork/testkit` | thin Vitest adapter: fixture, needs/skip mapping, evidence bridging, and spec-facing re-exports |
| `@openwork/cdp` | raw CDP client, targets, `Surface`, and `attachSurface` |
| `@openwork/labs` | egress, identity-provider, release-feed, and mock-MCP labs |
| `@openwork/hosts` | local and Daytona hosts and `resolveHost()` |
| `@openwork/behaviors` | framework-free actions and observations over narrow handles |
| `@openwork/matchers` | pure findings over facts, with no I/O |
| `@openwork/test-evidence` | screenshot capture, visual validation, and ambient test-evidence recording used by testkit |
| `@openwork/timeline` | timing spans for long test journeys |
| `@openwork/test-artifacts` | index, render, and PR publication for completed test runs |

Because behaviors and matchers do not depend on a test context, they also power
the standalone diagnostic script at `evals/scripts/diagnose.mts`. It imports
only `@openwork/behaviors` and `@openwork/matchers` and can inspect a real
endpoint without creating test evidence.

## Worlds

A world is a declarative environment topology managed by `@openwork/env`.
`defineWorld()` validates a `WorldTopology` and returns a definition that can be
deep-patched with `.with()`. The topology has:

- `den.orgs`: named organizations, each with an optional admin and named members.
- `den.env`: optional environment variables for the Den server. `den.web` and
  `den.substrate` also configure that server.
- `apps`: optional named desktop apps with their target org/member, workspace,
  model, and optional local server delay.
- `witnesses`: optional named witnesses; v1 accepts MCP mocks only.

The shipped presets are `solo` (one org and one admin app) and `support-org`
(two orgs, with admin and member apps in the primary org). `startWorld()` boots
the Den, organizations, witnesses, and apps in dependency order and disposes
them together. `fromSnapshot()` validates generated snapshot JSON and returns
the name and topology needed to start an equivalent fresh world.

Each started world writes a snapshot to
`evals/results/.worlds/<name>.json`. Snapshots contain the validated topology
plus resolved Den and app endpoints.

### World CLI

The root `pnpm world` command requires Node 24+ and supports:

| Command | Meaning |
| --- | --- |
| `pnpm world up <preset> [--name <name>]` | Start a preset world and keep it alive until Ctrl-C, which tears down its resources. |
| `pnpm world rebuild <snapshot-path>` | Validate a generated snapshot and start a fresh world from its topology until Ctrl-C. |
| `pnpm world list` | List generated snapshots with their place, organizations, and apps. |
| `pnpm world down <name>` | Remove a saved snapshot; there is no world daemon to stop. |
| `pnpm world help` | Show usage and the available presets. |

A realistic local session uses two terminals:

```bash
# terminal 1; leave this running
pnpm world up support-org --name support-repro

# terminal 2
pnpm world list
```

Press Ctrl-C in terminal 1 to tear down the running resources. The generated
snapshot remains available for listing, rebuilding, or removal with
`pnpm world down support-repro`.

World v1 has deliberate limits:

- Every app signs in.
- Apps join the first (primary) organization only.
- Witnesses are MCP mocks only.
- `onKind()` exists, but `den.substrate: "kind"` is validation-only and
  `startWorld()` throws `den.substrate "kind" is not wired yet`.
- There is no session seeding yet.

### Reproducing a failure

A failed local run's world snapshot can be rebuilt with:

```bash
pnpm world rebuild evals/results/.worlds/<name>.json
```

Snapshots are generated by `startWorld()` and are never hand-written.

## Ambient evidence and verdicts

The testkit fixture opens and closes a test-evidence recorder around each test.
Screenshots become test artifacts, visual validation records their expectations,
and assertion evidence carries witness assertions. Do not create or pass
recorder handles.

Report `Passed` only when every claim has observable evidence in the test run.
A failed assertion is `Failed`; missing requirements, tooling failure, or
missing test evidence is `Incomplete` or a named skip. A green suite containing
skips is not proof.

Publish an already completed test run with the `publish-evidence` skill:

```bash
pnpm evals:e2e --publish --pr <number> [--test-run <path|directory-id|latest|name>]
```

`evals:e2e --publish` judges and publishes test evidence without rerunning tests.
Its optional `--test-run` argument selects an existing test run by path,
directory ID, record name, or `latest` at publish time. Custom screenshots and
recordings are supplementary and never determine the pass/fail verdict.

## Standalone isolated Den

For an isolated Den API without Electron or Den Web, use the development helper:

```bash
pnpm --dir evals dev:den -- up --port 8891 --database openwork_den_my_eval --seed
pnpm --dir evals dev:den -- down --port 8891 --drop-database
```

The port and database are generated when omitted. The helper starts MySQL,
pushes the current schema, and prints the eval URL exports and teardown command.
It also adds the printed `OPENWORK_EVAL_DEN_WEB_URL` to the trusted origins;
without that origin, Better Auth rejects eval sign-in with
`403 INVALID_ORIGIN`.

## Daytona E2E tests

Use the maintained Daytona setup from `run-tests`, then run a selected test
through the E2E CLI:

```bash
pnpm evals:e2e app-smoke --daytona
```

Use direct CDP tools only to explore or debug. Convert repeatable coverage into
a testkit test.

## CDP manual-debugging tools

The `opencode-chrome-devtools` plugin exposes these browser tools. Every call
takes `browser_url`; target-specific calls also use the selected target ID.

| Tool | Purpose |
| --- | --- |
| `browser_list` | list page targets on a CDP endpoint |
| `browser_navigate` | navigate a target |
| `browser_snapshot` | inspect the accessibility tree and stable UIDs |
| `browser_click` | click a snapshot UID |
| `browser_fill` | fill an input by UID |
| `browser_eval` | inspect state or run debugging JavaScript |
| `browser_screenshot` | capture a PNG checkpoint |

Use these calls for exploration and debugging, not as replacement verdict
evidence. Repeatable executable coverage belongs in a testkit test, where
observable assertions and validated screenshots are recorded as test evidence.
