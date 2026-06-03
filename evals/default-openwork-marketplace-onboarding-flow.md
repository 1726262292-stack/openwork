# Default OpenWork Marketplace onboarding flow

End-to-end 5-star onboarding flow for the current capability level: Den gets the
user to the desktop app, and the desktop app loads a backend-provisioned default
Marketplace containing built-in OpenWork extension capabilities.

## Acceptance target

- Den download/sign-in copy does not claim that Den creates or loads a desktop workspace.
- Den introduces the built-in OpenWork Marketplace and explains it appears after desktop sign-in.
- A signed-in desktop user can open Settings -> Marketplace and see `OpenWork Marketplace` from Den.
- `OpenWork Marketplace` includes built-in extension entries such as `OpenWork Browser`, `Computer Use`, `OpenAI Image Gen`, `Google Workspace`, and `Ollama`.
- Built-in OpenWork entries are rendered as cloud Marketplace entries with a `Built-in` status, not as locally injected desktop Marketplace rows.
- Signed-out desktop users can still use OpenWork, but Marketplace nudges sign-in for built-in extensions and organization marketplaces.
- A non-built-in assigned Marketplace plugin can be imported into an active desktop workspace.
- Imported plugin resources appear in `My Extensions` and materialize into `.opencode` workspace files.
- The chat composer can accept a prompt referencing the imported plugin/skill once the workspace runtime is ready.

## Preflight

1. Start a Daytona Den server sandbox from the branch under test.
2. Start a Daytona Electron sandbox from the same branch, pointed at the Den server.
3. Validate Den Web/API health.
4. Validate Electron bootstrap uses the Daytona Den URLs.

## Flow 1: Den download handoff copy

**Goal:** Den accurately sets expectations before desktop install.

Steps:

1. Open Den landing `/download` in browser.
2. Inspect the hero and three-step cards.

Expected outcome:

- Page includes `built-in OpenWork Marketplace` or `built-in Marketplace`.
- Page says the user downloads/opens the desktop app after Cloud signup.
- Page says the workspace is created in the app.
- Page does not say `Create a workspace` or `Set up your personal or team workspace before installing.`

## Flow 2: signed-out desktop Marketplace nudge

**Goal:** OpenWork remains usable without account, while Marketplace clearly asks
for Cloud sign-in.

Steps:

1. Launch Electron without a Cloud Account session.
2. Create or open a local workspace.
3. Open Settings -> Marketplace.

Expected outcome:

- The Marketplace page renders.
- The notice says the user can use OpenWork without an account.
- The notice says sign-in loads the Marketplace, built-in extensions, and organization marketplaces.
- No locally injected built-in extension cards appear before sign-in.

## Flow 3: default Marketplace provisioning after desktop sign-in

**Goal:** Desktop sign-in causes Den to provision and return the default OpenWork
Marketplace for any user/org.

Steps:

1. Sign Electron into OpenWork Cloud using the Daytona Den handoff flow.
2. Create or open a local workspace.
3. Open Settings -> Marketplace.
4. Click `Refresh` if the Marketplace list has not loaded yet.
5. Open `Filters` and inspect marketplace options.
6. Search for `OpenWork Browser`.
7. Open the `OpenWork Browser` card.

Expected outcome:

- `OpenWork Marketplace` appears as a marketplace option.
- `OpenWork Browser` appears as a Marketplace card from Den.
- The card shows `Built-in` or an equivalent built-in/ready status.
- The detail modal shows OpenWork Browser setup/resource details from the Den extension manifest.
- The detail modal does not offer `Add` or `Remove` for built-in OpenWork entries.

## Flow 4: default Marketplace API proof

**Goal:** The backend, not desktop local catalog injection, owns the default
Marketplace entries.

Steps:

1. With the same signed-in org, call Den API `GET /v1/marketplaces?status=active&limit=100`.
2. Find `OpenWork Marketplace`.
3. Call `GET /v1/marketplaces/:id/resolved`.

Expected outcome:

- The API returns `OpenWork Marketplace`.
- Resolved plugins include the built-in OpenWork entries.
- Each built-in plugin has `extension.sourceFormat = openwork-builtin`.
- `OpenWork Browser` has an extension manifest with the `opencode-chrome-devtools` resource.

## Flow 5: assigned Marketplace plugin import

**Goal:** A normal assigned Marketplace plugin imports into the active desktop
workspace after Cloud sign-in.

Setup:

1. Use Den API to create a small test plugin such as `Daytona Starter Plugin`.
2. Add one config object, such as `Daytona Starter Skill`, to that plugin.
3. Attach the plugin to an assigned marketplace.

Steps:

1. Create or open a local desktop workspace.
2. Open Settings -> Marketplace.
3. Refresh the Marketplace list.
4. Open the test plugin card.
5. Click `Add`.
6. Open Settings -> Extensions -> My Extensions.
7. Inspect the workspace filesystem.

Expected outcome:

- The test plugin changes from `Add` to `Installed` in Marketplace.
- The test plugin appears in My Extensions as `Connected`.
- The expected file exists under `.opencode/skills/.../SKILL.md`.
- The imported file contains the source text from Den.
- The detail modal does not keep showing a stale `Add` action after install.

## Flow 6: chat handoff after provisioning

**Goal:** The user can move from provisioning into chat.

Steps:

1. Open the active workspace session view.
2. Confirm the composer is visible.
3. Type or set a prompt that references the imported skill/plugin.
4. Send it when the runtime is ready.

Expected outcome:

- The prompt appears in the composer.
- `Run task` / composer send becomes available when opencode runtime is connected.
- The task is submitted without losing the imported plugin state.
