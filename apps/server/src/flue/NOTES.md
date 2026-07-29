# Flue engine facade notes

- The workspace engine flag defaults to `opencode`; only workspaces explicitly set to `flue` are served by the in-process facade.
- The facade exposes an OpenCode-compatible wire slice under existing `/opencode/*` mounts so the app can keep using the current SDK client and SSE event stream.
- The read model is stored in `.opencode/openwork/flue-state.json` and mirrors the protocol-owned session/message/todo schemas before responses or events are emitted.
- Prompt execution attempts to initialize a Flue harness with `defineAgent` and an abortable `session.prompt()` call. The deterministic `flue/default` model has a local fallback so Bun tests and keyless development do not require provider credentials or Node's `node:sqlite` runtime.

## Verified end-to-end (Daytona sandbox, 2026-07-29)

- Harness init MUST go through `createFlueContext({ env: process.env, req, ... })` +
  `ctx.initializeRootHarness(agent)`. The lower-level `initializeRootHarness(agent, config, handler)`
  import throws `[flue] Canonical conversation runtime is not configured.` (no
  conversationWriter/attachmentStore) — and an `env: {}` context starves Pi of provider API keys.
- Real-model chat proven in the real UI on `openai/gpt-5-nano` (key from env): composer-driven and
  `prompt_async`-driven, streamed via `message.part.delta` SSE, rendered as markdown.
- `buildProviderList()` advertises env-keyed providers (OPENAI_API_KEY / ANTHROPIC_API_KEY) next to
  the deterministic `flue/default`.
- Package resolution: `@openwork/engine-protocol` exports `default` must point at built `dist/*.js` —
  Electron's plain Node cannot load workspace `src/*.ts` (Bun tests mask this). apps/server `build`
  chains the engine-protocol build.
- Flue transitive deps (`@google/genai`, `@mongodb-js/zstd`, `node-liblzma`) need explicit
  `allowBuilds: false` entries in pnpm-workspace.yaml or pnpm 11's verify-deps loop fails installs.
- Known gaps (next iterations): durability via Flue durable admission (force-quit recovery), tool-use
  surfacing beyond tool_start parts, permission gating, abort wiring in UI, session titles,
  `bun test` picks up compiled `dist/*.test.js` copies when dist exists (clean dist before suite).
