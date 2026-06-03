# Runtime DB flows

End-to-end scenarios for the OpenWork-owned runtime SQLite DB. These flows verify
that user-visible behavior is unchanged while runtime MCP/plugin/provider and
OpenWork workspace metadata are stored in OpenWork runtime storage instead of
rewriting user-owned workspace files.

## Preflight

1. Start OpenWork locally or on Daytona.
2. Create or select a local workspace.
3. Record the workspace path and workspace id from the URL.
4. If using Daytona, start with `DAYTONA_SECRETS_ENV=/tmp/no-daytona-secrets` when validating Den-provisioned providers so local secret env does not mask runtime DB behavior.

## Flow 1: Runtime DB initializes without changing visible app behavior

**Goal:** Opening a workspace creates the shared runtime DB schema and leaves the
workspace usable.

### Steps

1. Open the desktop app.
2. Create a local workspace.
3. Open Settings -> Advanced.
4. Expand the runtime/OpenCode config diagnostics.
5. Inspect the runtime DB path on disk if available.

### Expected outcome

- The app remains on the workspace/session screen.
- Runtime diagnostics load without an error.
- The runtime DB exists at the configured `OPENWORK_RUNTIME_DB` path or the app config `runtime.sqlite` path.
- The runtime DB contains `schema_migrations`, `migration_state`, `runtime_opencode_configs`, and `openwork_workspace_configs`.
- No new default `opencode.jsonc` is created just from opening the workspace.

## Flow 2: MCP add/remove persists in runtime DB, not user config

**Goal:** A user can add an MCP server and see it in the app without OpenWork
rewriting the user-owned `opencode.jsonc`.

### Steps

1. In the workspace, create an `opencode.jsonc` with a user-owned MCP entry.
2. Open Settings -> MCP.
3. Add a remote MCP server named `runtime-eval` with URL `https://runtime.example/mcp`.
4. Disable and re-enable it.
5. Reload the workspace if prompted.
6. Open Settings -> Advanced and inspect the effective injected config.
7. Inspect the workspace `opencode.jsonc`.

### Expected outcome

- The MCP server appears in the MCP list.
- The effective injected config contains `mcp.runtime-eval`.
- The original user-owned `opencode.jsonc` content is unchanged except for edits the user made manually.
- `.opencode/openwork.json` is not created for this MCP change.
- The MCP server still appears after app/workspace reload.

## Flow 3: Plugin add/remove persists in runtime DB, not user config

**Goal:** Plugin management remains user-visible in Settings while storage stays
OpenWork-owned.

### Steps

1. Open Settings -> Extensions or plugin management.
2. Add a plugin spec such as `runtime-eval-plugin`.
3. Remove it.
4. Add it again.
5. Reload the workspace if prompted.
6. Open Settings -> Advanced and inspect runtime diagnostics.
7. Inspect the workspace `opencode.jsonc`.

### Expected outcome

- The plugin appears after adding and disappears after removing.
- The plugin appears again after the final add and reload.
- Runtime diagnostics show the plugin under OpenWork runtime DB / injected config.
- User-owned `opencode.jsonc` is not rewritten for the plugin change.
- `.opencode/openwork.json` is not created for this plugin change.

## Flow 4: Cloud import metadata persists without legacy workspace file writes

**Goal:** OpenWork-owned workspace metadata, such as cloud import state, survives
reload without writing normal state to `.opencode/openwork.json`.

### Steps

1. Sign into Cloud Account.
2. Import any available cloud-managed plugin/provider/skill into the active workspace.
3. Reload the workspace if prompted.
4. Open the relevant Settings page and confirm the imported item is still shown as imported/available.
5. Inspect `<workspace>/.opencode/openwork.json`.

### Expected outcome

- Imported item state survives reload.
- The Settings UI reflects the imported item state after reload.
- Normal cloud import metadata is not written into `.opencode/openwork.json`.
- Existing legacy `.opencode/openwork.json` metadata is still readable if present.

## Flow 5: Advanced diagnostics tolerate malformed user files

**Goal:** A malformed user-owned file does not prevent users from seeing runtime
diagnostics or using OpenWork-managed runtime config.

### Steps

1. Write malformed JSONC to `<workspace>/opencode.jsonc`.
2. Add a plugin or MCP server through OpenWork Settings.
3. Open Settings -> Advanced.
4. Expand source diagnostics and effective injected config.

### Expected outcome

- Settings -> Advanced loads successfully.
- Diagnostics show a parse error for the malformed user file.
- OpenWork runtime DB values still appear in the injected config.
- The app does not crash or block runtime MCP/plugin reads.

## Flow 6: Existing runtime DB upgrades in place

**Goal:** Users upgrading from the first runtime DB implementation keep existing
runtime MCP/plugin/provider and cloud import state.

### Steps

1. Start from a build that has `runtime_opencode_configs` and `openwork_workspace_configs` but not `schema_migrations`.
2. Add a runtime plugin and a cloud import state entry.
3. Upgrade to this build.
4. Open the same workspace.
5. Open Settings -> Advanced and inspect diagnostics.
6. Verify plugin/cloud import state in the UI.

### Expected outcome

- Existing runtime data remains present.
- `schema_migrations` is created with version `1`.
- `migration_state` is created empty.
- Runtime plugin/provider/MCP and OpenWork workspace config still appear after upgrade.

## Flow 7: Den-provisioned provider still runs an actual task

**Goal:** Cloud/Den provider provisioning remains end-user functional after runtime
DB consolidation.

### Steps

1. Start a Den server sandbox and a desktop Electron sandbox pointed at it.
2. Sign into Cloud Account in the desktop app.
3. Create or assign an LLM provider in Den.
4. Wait for desktop sync or click refresh in Cloud Providers.
5. Import/select the provider in the desktop app.
6. Create a new session.
7. Send: `Reply with exactly: Runtime DB provider OK`.

### Expected outcome

- The provider appears in desktop Cloud Providers.
- The model is selectable in the composer/model selector.
- The task completes successfully.
- The assistant response is exactly `Runtime DB provider OK`.
- Session metadata shows the cloud provider id/model, not a local fallback provider.

## Evidence to capture

- Screenshot or video of the Settings page and successful task response.
- Runtime diagnostics JSON from Settings -> Advanced.
- The runtime DB path and schema version.
- Confirmation that user-owned `opencode.jsonc` and normal `.opencode/openwork.json` state were not rewritten for runtime MCP/plugin/cloud-import changes.
