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
- Tool observations are bridged from `observe()`: `tool_start` creates a running wire part and `tool`
  transitions it to the protocol's completed/error state (or creates a final orphan part), including timings.
- Known gaps (next iterations): durability via Flue durable admission (force-quit recovery), permission
  gating, abort wiring in UI, session titles,
  `bun test` picks up compiled `dist/*.test.js` copies when dist exists (clean dist before suite).

## Catalog bridge (2026-07-29)

- The Flue facade now resolves the same model catalog URL as the OpenCode engine (`resolveOpencodeModelsUrl()`), fetches `<base>/api.json`, validates providers/models, then materializes credential-resolvable catalog providers and runtime-managed providers next to the deterministic `flue/default` provider.
- Catalog `npm` to Flue/Pi api-kind mapping:
  | catalog `npm` | Flue `reg.api` |
  | --- | --- |
  | `@openrouter/ai-sdk-provider` | `openai-completions` |
  | `@ai-sdk/openai-compatible` | `openai-completions` |
  | `@ai-sdk/anthropic` | `anthropic-messages` |
  | `@ai-sdk/openai` | `openai-responses` |
  | `@ai-sdk/azure` | `azure-openai-responses` |
  | `@ai-sdk/amazon-bedrock` | `bedrock-converse-stream` |
- Unknown `npm` values are registered as `openai-completions` only when the provider id/name/npm/base URL contains an OpenAI-compatible marker (`openai`, `openrouter`, `openwork`, or `compatible`); otherwise the provider is skipped with a diagnostic reason.
- Cache/fallback behavior: one process-wide in-flight catalog fetch, 3.5s timeout, 10 minute memory TTL, and a workspace-local disk cache at `.opencode/openwork/flue-catalog-cache.json`. If network load fails, the facade logs once without secrets, then falls back to disk cache, runtime provider map only, and finally `flue/default`.
- Credential precedence: the OpenWork-owned Flue provider vault first, user env store provider lookup second, then `process.env`, trying every catalog/runtime `env[]` name for the latter two. Runtime-map providers with required env names and no resolved credential remain visible in provider-list `all`, but are omitted from `connected`/`default` and are not registered; selecting one fails with `provider_no_credential` rather than falling back. Unconfigured, uncredentialed catalog entries remain omitted. `OPENWORK_INFERENCE_BASE_URL` from env store/process overrides the hosted `openwork` base URL and is normalized to include `/api/v1`.
- Each catalog materialization logs one structured diagnostic with source (`url`, `disk-cache`, `runtime-only`, or `deterministic-only`), registered/listed/connected counts, and skipped provider ids/reasons; credentials and credential values are never logged.
- Runtime provider map precedence: `readEffectiveRuntimeOpencodeConfig()` is merged over the catalog; runtime `options.baseURL` wins over catalog `api`, runtime model maps replace catalog model maps when present, and `whitelist`/`blacklist` filter the final model map. Effective `disabled_providers` (global row plus workspace row, unique union) is then applied as the final provider-id filter before credential resolution, Flue `registerProvider()`, and provider-list response building; it also removes the deterministic `flue/default` provider.
- Provider credentials received through the OpenCode v2 wire are stored in the dedicated runtime-SQLite `flue_provider_credentials` table as typed JSON. They are global by provider id, matching OpenCode auth-store semantics and the UI's workspace-free `auth.set` calls, so one explicit key works across Flue workspaces. They never enter runtime OpenCode config or workspace-local state/catalog cache files.
- The facade implements `PUT /auth/{providerID}` (including a `null` body for removal), `DELETE /auth/{providerID}`, and `GET /provider/auth`. Providers are traversed in the stable provider-list order and each advertised method array contains one API-key method at index 0, preserving the UI's positional method lookup. Writes immediately rematerialize and re-register providers without an engine restart.
- `POST /provider/{providerID}/oauth/authorize` and `/provider/{providerID}/oauth/callback` return `501 flue_oauth_unsupported`. OAuth remains unsupported, as does migration of credentials already held only in OpenCode's auth store; users must authenticate once through the Flue auth wire. The Zen/free-tier materialization path also remains unsupported.
