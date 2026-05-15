# Workflow automations

End-to-end scenarios for the Workflows panel in Settings > Automations.
Run them before shipping any change that touches:

- `apps/app/src/react-app/domains/settings/pages/workflows-panel.tsx`
- `apps/app/src/react-app/shell/settings-route.tsx` (automations case)
- `apps/server/src/automations.ts`
- `apps/server/src/server.ts` (automation routes)

## Preflight

Before running any eval:

1. Start the Docker dev stack with `packaging/docker/dev-up.sh` and note the
   printed web URL (example: `http://localhost:50423`).

   If Docker is unavailable, start the Electron dev flow instead:
   ```bash
   pnpm --filter @openwork/desktop dev:electron
   ```
   This rebuilds the server binary, starts Vite on port 5173, and launches
   Electron with CDP on port 9823.

2. Open the web URL in a fresh Chrome DevTools MCP page:
   ```
   chrome-devtools_new_page { url: "<WEB_URL>/session" }
   ```
3. Confirm the footer shows **"OpenWork Ready"**.
4. Navigate to Settings > Automations:
   ```
   chrome-devtools_take_snapshot
   chrome-devtools_click { uid: <Settings button in footer> }
   chrome-devtools_wait_for { text: ["Automations"] }
   chrome-devtools_click { uid: <Automations tab> }
   chrome-devtools_wait_for { text: ["Workflows"] }
   ```
5. Confirm the **"Workflows"** heading is visible with the **"New Workflow"**
   button. If you see "Connect to an OpenWork server to use workflows." the
   server connection hasn't been established — wait a few seconds and reload.

---

## Flow 1 — Create a workflow

**Why**: The most basic operation. Verifies the create modal, the server
`POST /workspace/:id/automations` endpoint, and that the new automation
renders in the list.

Steps:
1. Click **New Workflow**.
2. Expect: modal opens with Name, Description, Prompt, and Schedule fields.
   Schedule defaults to "Manual". "Create & Save" is disabled.
3. Fill **Name**: `"Potato facts"`.
4. Fill **Prompt**: `"Create a file called test-potato.md with 3 fun facts about potatoes."`.
5. Click **Create & Save**.
6. Expect: modal closes. The workflow card appears with:
   - Heading **"Potato facts"**
   - The prompt text in a code-style box
   - Schedule badge **"Manual"**
   - **Edit**, **Run**, and delete buttons

Tool recipe:
```
chrome-devtools_click { uid: <New Workflow> }
chrome-devtools_wait_for { text: ["Create & Save"] }
chrome-devtools_fill { uid: <Name textbox>, value: "Potato facts" }
chrome-devtools_click { uid: <Prompt textarea> }
chrome-devtools_type_text { text: "Create a file called test-potato.md with 3 fun facts about potatoes." }
chrome-devtools_click { uid: <Create & Save> }
chrome-devtools_wait_for { text: ["Potato facts"] }
chrome-devtools_take_screenshot
```

Pass criteria:
- Modal closes without error.
- Workflow card renders with the correct name, prompt, and "Manual" badge.
- No console errors.

---

## Flow 2 — Trigger a workflow and verify OpenCode execution

**Why**: Proves the full pipeline: UI → server → OpenCode session + prompt.
The trigger calls `POST /workspace/:id/automations/:id/trigger` which
creates an OpenCode session and sends the prompt via `prompt_async`.

Steps:
1. On the workflow card from Flow 1, click **Run**.
2. Expect: the button shows a spinner briefly, then the card updates to show:
   - Status badge **"Success"** (green)
   - **"Last run: Just now"**
   - **"Runs: 1"**

Tool recipe:
```
chrome-devtools_click { uid: <Run button> }
# wait for the execution to complete (~5–10s depending on model)
chrome-devtools_wait_for { text: ["Success"], timeout: 15000 }
chrome-devtools_take_snapshot
```

Pass criteria:
- Status changes to "Success" (not "Failed").
- "Last run" timestamp is recent.
- Run count increments.

Known failure modes:
- If OpenCode is not connected, the trigger returns
  `opencode_unconfigured` — check that the server was started with
  `--opencode-base-url` pointing at a running OpenCode instance.
- If `prompt_async` returns 400, the prompt body format may have regressed
  (must be `{ parts: [{ type: "text", text: "..." }] }`).

---

## Flow 3 — Edit a workflow (change schedule)

**Why**: Verifies the edit modal pre-fills current values and the
`PATCH /workspace/:id/automations/:id` endpoint persists updates.

Steps:
1. On the workflow card, click **Edit**.
2. Expect: modal opens with title **"Edit Workflow"**, fields pre-filled with
   the current name, description, prompt, and schedule.
3. Change **Schedule** from "Manual" to "Every 5 minutes".
4. Click **Save Changes**.
5. Expect: modal closes. The card now shows schedule badge **"Every 5m"**
   (purple, with a repeat icon).

Tool recipe:
```
chrome-devtools_click { uid: <Edit button> }
chrome-devtools_wait_for { text: ["Edit Workflow", "Save Changes"] }
chrome-devtools_fill { uid: <Schedule combobox>, value: "Every 5 minutes" }
chrome-devtools_click { uid: <Save Changes> }
chrome-devtools_wait_for { text: ["Every 5m"] }
chrome-devtools_take_screenshot
```

Pass criteria:
- Schedule badge changes from "Manual" to "Every 5m".
- Badge color is purple (recurring), not gray (manual).
- Name and prompt remain unchanged.

---

## Flow 4 — Recurring execution

**Why**: Verifies the server-side scheduler fires automations on their
configured interval. This is the core recurring behavior.

Steps:
1. Create a new workflow (or edit the existing one) with schedule
   **"Every 1 minute"**.
2. Wait ~70 seconds.
3. Refresh the page or wait for auto-refresh (every 15s).
4. Expect: **"Runs"** counter has incremented by at least 1 compared to the
   value right after creation.
5. Wait another ~70 seconds.
6. Expect: **"Runs"** counter incremented again.

Tool recipe:
```
# create with 1-minute schedule (see Flow 1, select "Every 1 minute" in Schedule)
# note the initial run count
chrome-devtools_take_snapshot
# wait
# (sleep 70 seconds externally)
chrome-devtools_navigate_page { type: "reload" }
chrome-devtools_wait_for { text: ["Runs:"] }
chrome-devtools_take_snapshot
# compare run count
```

Pass criteria:
- Run count increments automatically without clicking Run.
- Status remains "Success" across recurring runs.
- No duplicate runs within the same interval window.

Known failure modes:
- The scheduler checks every 10 seconds. If the interval is very short
  (e.g. 30s) and the previous run is still "running", it skips that tick.
- In-memory store: if the server restarts, all automations and their
  schedules are lost.

---

## Flow 5 — Delete a workflow

**Why**: Verifies `DELETE /workspace/:id/automations/:id` and that the
UI removes the card.

Steps:
1. On the workflow card, click the **delete** button (trash icon).
2. Expect: the card disappears. If it was the last workflow, the preset
   cards ("Quick-start: pick a preset") reappear.

Tool recipe:
```
chrome-devtools_click { uid: <delete button> }
chrome-devtools_wait_for { text: ["Quick-start: pick a preset"] }
chrome-devtools_take_screenshot
```

Pass criteria:
- Card removed from the DOM.
- No error toast.
- Preset cards visible again (if no other workflows exist).

---

## Flow 6 — Create from preset

**Why**: Verifies the preset cards pre-fill the create modal correctly.

Steps:
1. With no existing workflows (or after deleting all), the preset grid is
   visible: "Open Chrome to Facebook", "Daily standup summary", etc.
2. Click **"Open Chrome to Facebook"**.
3. Expect: create modal opens with:
   - Name: "Open Chrome to Facebook"
   - Description: "Launch Google Chrome and navigate to facebook.com"
   - Prompt: the full Chrome prompt text
   - Schedule: "Manual"
4. Click **Create & Save**.
5. Expect: workflow card appears with the preset's name and prompt.

Tool recipe:
```
chrome-devtools_click { uid: <Open Chrome to Facebook preset> }
chrome-devtools_wait_for { text: ["Create & Save"] }
# verify fields are pre-filled
chrome-devtools_take_snapshot
chrome-devtools_click { uid: <Create & Save> }
chrome-devtools_wait_for { text: ["Open Chrome to Facebook"] }
```

Pass criteria:
- Modal fields match the preset exactly.
- Workflow card renders after save.

---

## Flow 7 — Server connection required

**Why**: Verifies graceful degradation when the OpenWork server is not
connected.

Steps:
1. Disconnect from the server (or test on a fresh web-only instance with
   no server URL configured).
2. Navigate to Settings > Automations.
3. Expect: the Workflows section shows the message
   **"Connect to an OpenWork server to use workflows."**
4. The "New Workflow" button should NOT be present.

Pass criteria:
- No crash or console error.
- Clear messaging about needing a server connection.
- No API calls attempted (check Network tab).

---

## Tips for an LLM runner

- Always `chrome-devtools_take_snapshot` after each interaction. Never
  trust that a click "worked" — re-snapshot and verify the new `uid`s.
- The "Create & Save" button is disabled until the Prompt field has text.
  If `chrome-devtools_fill` on the textarea doesn't work, use
  `chrome-devtools_click` on the textarea first, then
  `chrome-devtools_type_text`.
- For Flow 4 (recurring), use `sleep` in a Bash tool call to wait the
  interval, then reload. Don't poll in a tight loop.
- The schedule dropdown uses `<select>` — use
  `chrome-devtools_fill { uid: <combobox>, value: "Every 5 minutes" }`
  with the exact option label text.
- If a trigger returns "Failed", check
  `chrome-devtools_list_console_messages { types: ["error"] }` and also
  verify the server's OpenCode connection is healthy at
  `GET /system/opencode/health` (server-v2) or by checking the server
  log output.
