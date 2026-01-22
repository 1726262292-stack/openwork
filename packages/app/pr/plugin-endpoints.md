---
title: Plugin endpoints
description: Expose listing and install endpoints for plugins
---

## Set context
OpenWork manages plugins by editing `opencode.json`, but OpenCode does not expose a list/add API yet. A minimal service makes plugin management consistent across the CLI, SDK, and OpenWork.

---

## Define goals
- Provide list and add endpoints for plugins
- Keep behavior aligned with `opencode.json` rules
- Support both project and global scopes

---

## Call out non-goals
- No plugin removal or update endpoints in this phase
- No automatic dependency resolution or npm install workflow
- No UI changes beyond wiring existing surfaces

---

## Design API
GET `/plugin` returns merged plugins for the active workspace and global scope.

```json
{
  "plugins": [
    {
      "name": "opencode-wakatime",
      "scope": "project",
      "source": "npm"
    }
  ]
}
```

POST `/plugin` adds a plugin to the requested scope and returns the updated list.

```json
{
  "name": "opencode-wakatime",
  "scope": "global",
  "source": "npm"
}
```

```json
{
  "plugins": [
    {
      "name": "opencode-wakatime",
      "scope": "global",
      "source": "npm"
    }
  ]
}
```

---

## Shape data
Plugin records include `name`, `scope`, `source`, and optional `version` plus `enabled` flags.
Scope values are `project` or `global`, and responses always include resolved scope per entry.

---

## Persist config
Project scope writes to `<workspace>/opencode.json` and creates it if missing.
Global scope writes to `~/.config/opencode/opencode.json` or `$XDG_CONFIG_HOME/opencode/opencode.json`.

---

## Update SDK
Add `listPlugins()` and `addPlugin()` to the OpenCode SDK with typed payloads.

---

## Integrate UI
Wire the Skills tab to call GET on load and POST on add.

---

## Log events
Log `plugin.list` with scope and count, and `plugin.add` with name and scope.
Errors include file path, parse details, and API caller identity.

---

## Plan rollout
Ship behind a `plugins_api` feature flag in OpenCode first.
Enable by default after one release once OpenWork validates end-to-end flow.
