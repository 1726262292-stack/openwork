---
name: daytona-electron-test
description: "Test the real Electron app on Daytona: create sandbox, start services, connect via CDP, create workspaces, drive sessions, and verify settings. Use when the user says 'test on Daytona', 'run the app on Daytona', 'Daytona dry run', 'test Electron remotely', or 'reproduce on Daytona'."
---

# Skill: Daytona Electron Test

Drive the real OpenWork Electron app inside an 8 GB Daytona sandbox via CDP
browser tools. Covers workspace creation, session interaction, settings
verification, and bug reproduction.

## When to use

- User says "test on Daytona", "run the app on Daytona", "Daytona dry run"
- User wants to reproduce a bug in the real Electron app remotely
- User wants to verify a UI flow end-to-end without local Electron

## Fastest path: the script

Run the helper script from the repo root. It creates the sandbox, checks out
the ref, starts all services, and waits for CDP:

```bash
bash .devcontainer/test-on-daytona.sh [branch-or-commit]
```

It prints the CDP and noVNC URLs at the end. Then use `browser_list` to connect.

## Manual path (step by step)

### 1. Create the sandbox

```bash
SANDBOX="openwork-test-$(date +%Y%m%d-%H%M%S)"

daytona create \
  --name "$SANDBOX" \
  --dockerfile .devcontainer/Dockerfile \
  --context .devcontainer/Dockerfile \
  --context .devcontainer/start-display.sh \
  --context .devcontainer/start-services.sh \
  --class large \
  --memory 8 \
  --auto-stop 60 \
  --public \
  --target us
```

**CRITICAL:** Always `--memory 8`. The default 1 GB will OOM-kill pnpm install
and Vite's esbuild. Electron + Vite + opencode needs ~6 GB.

### 2. Checkout the branch under test

The Dockerfile clones `dev` at build time. Fetch and checkout the target:

```bash
daytona exec "$SANDBOX" -- "bash -lc 'cd /workspace && git fetch origin <ref> && git checkout <ref> && pnpm install --frozen-lockfile || pnpm install'"
```

### 3. Start services (background, don't block)

```bash
daytona exec "$SANDBOX" -- "bash -lc 'cd /workspace && nohup bash .devcontainer/start-services.sh > /tmp/start-services.log 2>&1 &'"
```

**IMPORTANT:** Run `start-services.sh` via `nohup ... &`. The script ends with
`wait` which blocks forever. If you run it in the foreground, `daytona exec`
hangs until the sandbox auto-stops.

Wait ~35-45s for Xvfb + Vite + Electron + opencode sidecar to boot.

### 4. Get URLs

```bash
# Electron CDP (automation) -- THIS IS WHAT browser_list CONNECTS TO
daytona preview-url "$SANDBOX" -p 9825

# noVNC (visual access in your browser)
daytona preview-url "$SANDBOX" -p 6080
```

### 5. Connect browser tools

```
browser_list({ browser_url: "<CDP_URL>" })
```

Should show: `[target_id] OpenWork  http://localhost:5173/#/welcome`

### 6. Verify it's real Electron (not plain Chromium)

```
browser_eval({ expression: "navigator.userAgent" })
```

Must contain `Electron/`.

## Creating a workspace through the UI

### Prepare the directory first

```bash
daytona exec "$SANDBOX" -- "bash -lc 'mkdir -p /workspace/hello'"
```

### Drive the modal

1. **Click "Get started":**
```js
(function() { var btns = document.querySelectorAll('button'); for (var i = 0; i < btns.length; i++) { if (btns[i].textContent.indexOf('Get started') !== -1) { btns[i].click(); return 'clicked'; } } return 'not found'; })()
```

2. **Click "Local workspace":**
```js
(function() { var btns = document.querySelectorAll('button'); for (var i = 0; i < btns.length; i++) { if (btns[i].textContent.indexOf('Local workspace') !== -1) { btns[i].click(); return 'clicked'; } } return 'not found'; })()
```

3. **Inject folder path** (bypasses the native file picker that can't work headless):
```js
JSON.stringify((function() {
  function findFiber(el) {
    var key = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$'); });
    return key ? el[key] : null;
  }
  var all = document.querySelectorAll('span,div,p');
  var p = null;
  for (var i = 0; i < all.length; i++) {
    if (all[i].textContent.indexOf('No folder') !== -1) { p = all[i]; break; }
  }
  if (!p) return {err: 'no placeholder'};
  var fiber = findFiber(p);
  while (fiber) {
    var name = (fiber.elementType && fiber.elementType.name) || (fiber.type && fiber.type.name) || '';
    if (name === 'CreateWorkspaceModal') break;
    fiber = fiber.return;
  }
  if (!fiber) return {err: 'no fiber'};
  var hook = fiber.memoizedState;
  while (hook) {
    if (hook.queue && hook.queue.dispatch) {
      hook.queue.dispatch({ key: 'selectedFolder', value: '/workspace/hello' });
      hook.queue.dispatch({ key: 'pickingFolder', value: false });
      return {ok: true};
    }
    hook = hook.next;
  }
  return {err: 'no dispatch'};
})())
```

The reducer uses `{ key, value }` actions. NOT direct state replacement.

4. **Click "Create Workspace":**
```js
(function() { var btns = document.querySelectorAll('button'); for (var i = 0; i < btns.length; i++) { if (btns[i].textContent.trim() === 'Create Workspace' && !btns[i].disabled) { btns[i].click(); return 'clicked'; } } return 'not found'; })()
```

5. **Wait 10-12s.** Verify:
   - URL contains `#/workspace/ws_`
   - Status bar shows "OpenWork Ready"
   - opencode process running: `daytona exec "$SANDBOX" -- "bash -lc 'ps aux | grep opencode | grep -v grep'"`

## Session interaction

### Prerequisites: API key for real LLM sessions

To test real sessions (not just UI flow), the opencode sidecar needs an LLM
provider key. The easiest is OpenAI:

```bash
daytona exec "$SANDBOX" -- "bash -lc 'cd /workspace/hello && node -e \"
  const fs = require(\\\"fs\\\");
  const p = \\\"opencode.jsonc\\\";
  let c = JSON.parse(fs.readFileSync(p, \\\"utf8\\\").replace(/^\\\\/\\\\/.*$/gm, \\\"\\\"));
  c.provider = c.provider || {};
  c.provider.openai = { options: { apiKey: process.env.KEY } };
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
\" '"
```

Set `KEY=sk-proj-...` in the command above. After writing the config, you
**must restart all services** (see "Injecting API keys" section below) for
opencode to pick up the new provider.

To switch models in the UI, click the model name in the bottom bar (e.g.
"Big Pickle") and select the desired model (e.g. GPT-5.5).

### Type in the Lexical composer

```js
(function() {
  var editor = document.querySelector('[contenteditable=true]');
  if (!editor) return 'no editor';
  editor.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, 'YOUR PROMPT HERE');
  return 'typed';
})()
```

**MUST use `document.execCommand('insertText', ...)`.**
Direct `textContent =` or `innerHTML =` does NOT trigger Lexical state updates.

### Click Run task

```js
(function() { var btns = document.querySelectorAll('button'); for (var i = 0; i < btns.length; i++) { if (btns[i].textContent.indexOf('Run task') !== -1 && !btns[i].disabled) { btns[i].click(); return 'clicked'; } } return 'not found'; })()
```

### Check response

```js
document.body.innerText.substring(0, 3000)
```

## Settings navigation

**Open settings** (gear icon):
```js
(function() { var el = Array.from(document.querySelectorAll('button,a')).find(function(node) { return node.getAttribute('aria-label') === 'Settings'; }); if (!el) return 'not found'; el.click(); return 'clicked'; })()
```

**Navigate to a panel** (e.g. AI Providers):
```js
(function() { var btn = Array.from(document.querySelectorAll('button')).find(function(el) { return el.textContent.trim() === 'AI Providers'; }); if (!btn) return 'not found'; btn.click(); return 'clicked'; })()
```

**Back to app:**
```js
(function() { var btn = Array.from(document.querySelectorAll('button')).find(function(el) { return el.textContent.trim() === 'Back to app'; }); if (!btn) return 'not found'; btn.click(); return 'clicked'; })()
```

## Window management (minimize/restore testing)

Install xdotool first:
```bash
daytona exec "$SANDBOX" -- "bash -lc 'apt-get update && apt-get install -y xdotool'"
```

Then:
```bash
# Minimize
daytona exec "$SANDBOX" -- "bash -lc 'DISPLAY=:99 xdotool search --name OpenWork windowminimize'"

# Restore
daytona exec "$SANDBOX" -- "bash -lc 'DISPLAY=:99 xdotool search --name OpenWork windowactivate'"
```

## Injecting API keys

Edit the workspace opencode config:
```bash
daytona exec "$SANDBOX" -- "bash -lc 'cd /workspace/hello && node -e \"...update opencode.jsonc...\"'"
```

Then **kill and restart ALL services** (not just opencode):
```bash
# Step 1: kill everything
daytona exec "$SANDBOX" -- "bash -lc 'pkill -f electron || true; pkill -f opencode || true; pkill -f vite || true'"

# Step 2: wait, then restart (SEPARATE exec call - pkill kills the shell too)
sleep 3
daytona exec "$SANDBOX" -- "bash -lc 'cd /workspace && nohup bash .devcontainer/start-services.sh > /tmp/start-services.log 2>&1 &'"
```

**GOTCHA:** Do NOT chain `pkill` and `nohup start-services.sh` in the same
`daytona exec` call. `pkill -f electron` sends SIGTERM to the exec session
itself (because the command string matches). The restart never runs.
Always use two separate `daytona exec` calls with a `sleep` between them.

## Ports reference

| Service   | Port | Description                              |
|-----------|------|------------------------------------------|
| noVNC     | 6080 | See the Electron app visually            |
| Vite HMR  | 5173 | React UI hot reload                      |
| CDP       | 9825 | Chrome DevTools Protocol for automation  |
| Den Web   | 3005 | Admin dashboard (needs MySQL)            |
| Den API   | 8788 | Control plane (needs MySQL)              |

## Troubleshooting

**OOM during pnpm install or Vite esbuild crash (EPIPE):**
You used `--memory 1` (default). Always `--memory 8`.

**Electron exits with "Running as root without --no-sandbox":**
The devcontainer sets `ELECTRON_DISABLE_SANDBOX=1`. If running Electron
manually, pass `--no-sandbox` or set the env var.

**"bun: not found" during dev:electron:**
The sidecar prep script uses bun. The devcontainer Dockerfile installs it
globally. If you built a custom Dockerfile, add `RUN npm install -g bun`.

**"xauth command not found":**
`apt-get install -y xauth` (already in the devcontainer Dockerfile).

**CDP shows no targets after 45s:**
Check `/tmp/electron.log` and `/tmp/vite.log`:
```bash
daytona exec "$SANDBOX" -- "bash -lc 'tail -80 /tmp/electron.log'"
daytona exec "$SANDBOX" -- "bash -lc 'tail -80 /tmp/vite.log'"
```

**opencode sidecar not restarting after kill:**
The Electron runtime manager does NOT auto-detect sidecar death. You must
restart the entire Electron process (kill + restart via start-services.sh).

**`daytona exec` with `pkill` kills the exec session:**
The process pattern match hits the exec wrapper. Always split kill and
restart into separate `daytona exec` calls.

**Blank Electron window (empty `<div id="root"></div>`):**
Vite crashed (check `/tmp/vite.log`). Usually memory pressure. Verify
`free -m` shows >2 GB available.

## Teardown

```bash
daytona delete "$SANDBOX"
```
