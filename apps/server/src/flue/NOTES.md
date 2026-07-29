# Flue engine facade notes

- The workspace engine flag defaults to `opencode`; only workspaces explicitly set to `flue` are served by the in-process facade.
- The facade exposes an OpenCode-compatible wire slice under existing `/opencode/*` mounts so the app can keep using the current SDK client and SSE event stream.
- The read model is stored in `.opencode/openwork/flue-state.json` and mirrors the protocol-owned session/message/todo schemas before responses or events are emitted.
- Prompt execution attempts to initialize a Flue harness with `defineAgent` and an abortable `session.prompt()` call. The deterministic `flue/default` model has a local fallback so Bun tests and keyless development do not require provider credentials or Node's `node:sqlite` runtime.
