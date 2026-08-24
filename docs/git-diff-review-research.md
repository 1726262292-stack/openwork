# Git Diff Review — how T3 Code does it, and how OpenWork could

Research doc (no code). 2026-08-24.

- Studied: `pingdotgg/t3code` @ `9996038` (2026-08-24, MIT) — T3 Chat team's "agent harness control surface" (Electron desktop + web + mobile controlling Claude Code/Codex/Cursor/OpenCode).
- Baseline: OpenWork @ `5c74c25` (`origin/dev`, 2026-08-24), engine pinned to opencode `v1.18.18`.

## TL;DR

T3 Code's diff experience has two halves: (1) **turn-scoped checkpoints** — every agent turn is bracketed by hidden git refs so "what changed this turn" is exact even if the agent commits mid-turn, with one-click revert of files *and* conversation; (2) an **on-demand review panel** with Working-tree / Branch-vs-base / Per-turn scopes, rendered from raw unified patch text by their own `@pierre/diffs` library (shiki worker pool, virtualized, split/unified).

OpenWork's position is strong: **the embedded opencode engine already ships essentially all of T3's backend** (`/vcs/status`, `/vcs/diff`, `/vcs/diff/raw`, per-message `/session/:id/diff`, shadow-git snapshots + revert/unrevert, fs + branch watcher events) and it is already reachable through the authenticated workspace proxy. What's missing is almost entirely **frontend**: the app drops the engine's diff metadata today and renders diffs with a 40-line string colorizer. We can ship a T3-class experience with app-only changes.

---

## 1. How T3 Code implements git diff

### 1.1 Architecture in one paragraph

All diffs are computed server-side in their local Node server (`apps/server`, Effect-TS) by **spawning the plain `git` CLI** (no git library). Two systems coexist: a **checkpoint system** that snapshots the working tree into dangling commits under hidden refs (`refs/t3/checkpoints/<base64url(threadId)>/turn/<n>`) at turn boundaries, and an on-demand **review preview** (`git diff HEAD` incl. untracked, plus `git diff <base>...HEAD`). Diffs cross the wire as **raw unified patch text** over WebSocket RPC (`orchestration.getTurnDiff`, `review.getDiffPreview`); every client parses it with one shared parser (`@pierre/diffs` `parsePatchFiles`). Web/desktop render with Pierre's virtualized shadow-DOM `CodeView` backed by a shiki web-worker pool; mobile re-renders the same parsed rows in native Swift/Kotlin canvas views.

### 1.2 Git plumbing (server)

- **Executor**: one low-level `git` spawner (`apps/server/src/vcs/GitVcsDriverCore.ts`) with 30s timeouts, byte caps + `[truncated]` markers, `LC_ALL=C`, and hygiene flags on every diff: `--no-color --no-ext-diff --no-textconv --minimal` so output is parseable regardless of user git config. VCS-pluggable driver registry.
- **Scopes supported**:
  | Scope | Mechanism | Cap |
  |---|---|---|
  | Turn N (checkpoint) | `git diff <turnRef N-1> <turnRef N>` | 10 MB |
  | Full thread | turn-0 baseline ref → latest | 10 MB |
  | Working tree | `git diff HEAD` + untracked via `ls-files --others` then `git diff --no-index /dev/null <f>` | 120 KB / 80 KB per untracked |
  | Branch vs base | `git diff <base>...HEAD` (three-dot merge-base) | — |
  | PR review | `gh pr diff` + host APIs, cursor-paged slices | — |
- **Checkpoint capture** never touches user state: temp `GIT_INDEX_FILE` in the git common dir → `read-tree HEAD`, `add -A`, `write-tree`, `commit-tree`, `update-ref`. Restore = `git restore --source <commit> --worktree --staged -- .` + `git clean -fd`. Refs are garbage-collected on revert.
- **Base branch detection**, in order: `branch.<name>.gh-merge-base` git config → remote default via `symbolic-ref refs/remotes/<remote>/HEAD` (cached 5 min) → `main`/`master` candidates; user can override the base ref per thread from the panel UI.
- **Lifecycle**: a reactor captures a baseline on turn start and a checkpoint + diff on `turn.completed`, parses the patch server-side into per-file `{path, kind, additions, deletions}` summaries, and pushes them through the thread event stream. Codex's own `turn/diff/updated` payload is treated as an untrusted *signal*: it only inserts a placeholder that their own git capture then replaces.
- **Revert is dual**: restore files **and** roll the provider conversation back the same number of turns, so agent memory stays consistent with disk.
- **Freshness without watchers**: no fs watcher drives diffs. Refresh is event- and demand-driven — turn completion triggers a status broadcast (fingerprinted, publish-on-change), query atoms have 5s stale-time, the panel refetches on window focus and on new-turn-completed. Remote pollers are ref-counted with 30s→15min backoff.

### 1.3 Wire format

Raw unified patch **text**, not structured hunks: `{ id, kind: "working-tree"|"branch-range", baseRef, headRef, diff: string, diffHash (SHA-256), truncated }`. Per-turn *summaries* (file path + additions/deletions) are structured and ride the event stream so the transcript can show "changed files" chips without fetching patches. Hunk context expansion is a lazy loader: the renderer requests full old/new file contents (`review.getDiffFileContents`, single-flight, 1 MB / binary refusal) only when the user expands "N unmodified lines".

### 1.4 Rendering (web/desktop)

- **`@pierre/diffs`** (their code-review product's renderer; published on npm, Apache-2.0; they pin `1.3.0-beta.10` + a small patch). Provides: patch parsing, virtualized rendering with exact item metrics, split/unified, hunk expansion, gutter selection, shadow-DOM styling.
- **Highlighting**: shiki v4 in a **web-worker pool** (2–6 workers ≈ cores/2), AST LRU cache 240, 1,000-char line tokenize cap, light/dark themes switched at runtime.
- **Options**: unified ("stacked") vs split toggle, word wrap, ignore-whitespace (server re-diff with `--ignore-all-space`), per-file collapse + collapse-all (default-folded on the PR tab for load performance). Intraline char-level emphasis is *disabled* on web; mobile computes word-level ranges with jsdiff.
- **Comments**: selecting gutter lines opens a PR-style annotation that becomes a **composer "review comment" sent to the agent** — review feedback loops back into the conversation, not to a code host.

### 1.5 UX surfaces

1. **Diff panel** — lazy-loaded right-hand panel in the chat view (inline 42vw / sheet / sidebar modes) with a scope dropdown: *Working tree / Branch changes / Latest turn / Turn N*, plus a searchable base-ref combobox.
2. **Per-message "changed files" card** — each assistant turn shows a compacted directory tree with per-file +/− counts; clicking a file opens the diff panel scoped to that turn and reveals the file.
3. **Undo** — hover a user message → "Revert to this message" (files + conversation).
4. **PR review tab** — same renderer for host PRs, cursor-paged, per-commit scoping.

### 1.6 Perf tricks worth copying

Content-addressed render caches (hash of patch text as cache key); raw-patch wire format with server-side caps + explicit `truncated` flags; single shared parser across platforms; folded-by-default large views; visible-window token streaming and hard per-file suppression thresholds (>400 lines → "Load diff" opt-in) on mobile; publish-on-fingerprint-change status broadcasting instead of naive polling.

---

## 2. What OpenWork already has (and drops)

### 2.1 Engine (opencode) — the backend already exists

All reachable **today** through the workspace proxy `/workspace/:id/opencode/*` (GETs allowed for every token scope, so viewer/cloud contexts work):

| Capability | Endpoint / mechanism |
|---|---|
| Per-file worktree status | `GET /vcs/status` → `{file, additions, deletions, status}` ; also `GET /file/status` |
| Per-file diffs, two scopes | `GET /vcs/diff?mode=git\|branch` → `{file, patch, additions, deletions}` (worktree-vs-HEAD incl. untracked; or vs merge-base with default branch; 10 MB caps) |
| Raw unified patch | `GET /vcs/diff/raw` (`text/x-diff`) |
| Apply a patch | `POST /vcs/apply` (runs `git apply`, clean-tree guard) |
| **Per-message diff** | `GET /session/:id/diff?messageID` → `Snapshot.FileDiff[]` |
| Turn checkpoints | Shadow git repo per worktree (`snapshot/index.ts`: separate `--git-dir`, real `--work-tree`; 7-day prune, 2 MB patch cap) + `PatchPart {hash, files[]}` message parts |
| Revert / redo | `POST /session/:id/revert` / `unrevert` — **restores files on disk**, publishes `Session.Event.Diff`; the app already has Revert/Redo buttons wired |
| Live refresh signals | SSE events `file.edited`, `file.watcher.updated` (real fs watcher), `vcs.branch.updated` (watches `.git/HEAD`) |
| Structured hunks | `GET /file/content` returns `patch: {oldFileName, newFileName, hunks[]}` |
| Turn summary | `Session.Info.summary {additions, deletions, files}` (already parsed by openwork-server's read model) |
| Worktree sandboxes | `/experimental/worktree` CRUD + `git_worktree` session copy strategy (unused by the app) |

Notable design difference vs T3: opencode snapshots into a **separate shadow git dir** pointed at the real worktree, while T3 writes hidden refs into the user's repo. Same outcome (commit-independent turn diffs, no index pollution); ours is arguably cleaner (nothing agent-visible in `refs/`), theirs survives shadow-state loss and is inspectable with stock git tooling. No need to change.

### 2.2 App (apps/app) — the gap is almost entirely here

- The **only diff renderer** is `DiffLines` in `components/ui/tool.tsx`: string-prefix coloring of `+/-/@@` lines, `max-h-60`, no line numbers / syntax / per-file grouping. It only triggers for `apply_patch` input and diff-looking tool output.
- **Edit tools don't show diffs**: the engine attaches `metadata.diff` + `filediff {additions, deletions}` to `edit`/`apply_patch` parts, and emits `PatchPart` checkpoints — but `parse-tool-parts.ts` copies only `input/output/errorText` and `session-sync.ts` drops `patch` parts entirely. Types for all of it already exist in `lib/build-in-tools.ts`.
- **Git status is fetched but never shown**: `global-sync-provider.tsx` populates `GlobalState.vcs` (branch, default_branch) per project; no component reads it. No branch name, dirty state, or changed-file counts anywhere.
- Permission modal shows the edit diff as **plain uncolored text** (`metadataDetailKeys` includes `diff`).
- SSE handlers ignore `file.watcher.updated` / `vcs.branch.updated` / session diff events.
- Rendering stack available: React 19 + Tailwind v4 + shadcn/Base UI; **shiki v4 already bundled** (markdown code blocks); **`@tanstack/react-virtual` already a dependency but unused**; CodeMirror 6 present (artifact editor only); lazy-loading precedent in `artifact-panel.tsx`.
- Natural mount point exists: the session side panel is a per-session tab system — `PanelTabType = "artifact" | "browser"` in `panel-tab-store.ts`, switch in `side-panel.tsx`. A `"changes"` tab is the designed-for extension point (and a pure-web pane is the easy case vs the browser's WebContentsView overlay).
- Nothing planned: no PRD/TODO in-repo mentions diff review.

---

## 3. Gap analysis — T3 capability → OpenWork status

| T3 Code capability | OpenWork today | Gap |
|---|---|---|
| Turn-bracketing checkpoints | ✅ engine snapshots + `PatchPart` per message | App drops the parts |
| "Changes this turn" file summaries in transcript | ✅ data exists (`filediff`, `PatchPart`, `Session.summary`) | Not rendered |
| Working-tree diff incl. untracked | ✅ `GET /vcs/diff?mode=git` | No UI |
| Branch-vs-base diff (merge-base, three-dot) | ✅ `GET /vcs/diff?mode=branch` | No base-ref override UI; engine picks default branch |
| Per-turn diff view | ✅ `GET /session/:id/diff?messageID` | No UI |
| Revert files + conversation | ✅ `session.revert` restores disk; Revert/Redo buttons exist | Not connected to a diff preview ("review before revert") |
| Rich diff renderer (split/unified, shiki, virtualized, hunk expansion) | ❌ `DiffLines` colorizer | The core build |
| Live refresh | ✅ engine events exist | Handlers ignore them |
| Ignore-whitespace / wrap toggles | ❌ (engine: no `--ignore-all-space` param on `/vcs/diff` today) | Small engine param, or client-side post-filter |
| Line-comment → agent feedback | ❌ | New feature (composer already exists) |
| PR review tab | ❌ | Out of scope for v1 |
| Branch indicator in workspace UI | Data fetched, unused | Trivial render |

## 4. How OpenWork could do it (proposal, phased — no code)

Principle: **reuse the engine as the single source of git truth** (it already spawns git safely with caps); make this an app-only feature reachable through the existing proxy so it works identically for local, worktree, and cloud/remote workers.

### Phase 1 — render what we already receive (days, zero backend changes)
1. Stop dropping data: keep `metadata.filediff`/`diff` in `parse-tool-parts.ts`; map `PatchPart` in `session-sync.ts` instead of returning `null`.
2. Per-turn **changed-files card** (T3's most-loved surface): compact directory tree + per-file +/− from `PatchPart`/`Session.summary`.
3. Upgrade `DiffLines` into a real single-file diff block: line numbers, hunk headers, shiki tokenization (already bundled), used in edit tool bodies **and the permission modal** (big trust win: "review the diff before allowing" currently shows plain text).
4. Show branch + dirty indicator from the already-populated `GlobalState.vcs` (+ `vcs.branch.updated` event).

### Phase 2 — the Changes panel (the T3-style experience)
1. New `PanelTabType: "changes"`, lazy-loaded like the artifact editors.
2. Scope switcher: **Working tree** (`/vcs/diff?mode=git`) / **Branch changes** (`mode=branch`) / **This message** (`/session/:id/diff?messageID`) — mirrors T3's scopes 1:1 with endpoints we already have.
3. Refresh model copied from T3: TanStack Query with ~5s stale-time + refetch on window focus + refetch on session idle/turn-complete + `file.watcher.updated` as an invalidation signal (debounced). No new watchers.
4. Renderer decision (see §5). Virtualize with the already-declared `@tanstack/react-virtual`; content-hash the patch text for render caching; respect engine truncation caps with an explicit "truncated" banner.
5. Clicking a file chip in the transcript opens the panel scoped to that turn + file (T3's `selectTurn` pattern).

### Phase 3 — review affordances
1. **Revert with preview**: the existing Revert button opens the Changes panel scoped to "everything after this message" so users see what will be undone (engine revert already restores disk state).
2. **Line comments → composer**: select lines → annotate → structured "review comment" (path + range + quoted lines) appended to the next user message. Pure frontend; highest leverage differentiator after the panel itself.
3. Optional engine niceties (tiny PRs upstream): `ignoreWhitespace` param on `/vcs/diff`, base-ref override for `mode=branch`, context-expansion endpoint (or reuse `GET /file/content`'s structured `patch` + raw content, which already exists).

### Explicitly not copied
- T3's hidden-refs checkpoint system — opencode's shadow-git snapshots already solve this; don't reinvent.
- Their WS-RPC wire format — our REST + SSE proxy is sufficient and already authorized/scoped.
- Mobile native canvas renderer — no OpenWork mobile surface today.

## 5. Renderer options

| Option | Pros | Cons |
|---|---|---|
| **A. Build on what's bundled** (shiki + `@tanstack/react-virtual` + shadcn) | No new deps; full theme control; smallest bundle; we own hunk model (engine already returns structured hunks via `/file/content`) | We build split view, intraline ranges, hunk expansion ourselves (~the biggest cost) |
| **B. `@pierre/diffs`** (what T3 uses; npm, Apache-2.0, v1.3.6) | Battle-tested exactly for this product shape; virtualization + split/unified + hunk expansion + shiki workers built in | Shadow-DOM theming friction (T3 injects CSS-var overrides + maintains a patch file); beta-cadence dependency on a competitor-adjacent vendor |
| **C. `@git-diff-view/react`** (MIT) | Purpose-built React diff view, structured-data or unified-diff input, split/unified, word-level | Less proven at T3/Pierre scale; separate highlighter integration |

Recommendation: **start A for Phase 1** (single-file blocks are simple), then **evaluate B vs A-extended for the Phase 2 panel** with a spike on our largest real diffs; T3's patch file for `@pierre/diffs` shows the integration cost is real but small and the library is the fastest path to hunk expansion + virtualization parity.

## 6. Risks / open questions

- **Engine pin drift**: `/vcs/*` shapes verified against opencode `v1.17.4` sources + SDK `^1.18.15`; re-verify against the pinned `v1.18.18` before build.
- **Large repos**: engine caps diffs at 10 MB; the panel must handle `truncated` + per-file lazy "Load diff" (T3 mobile's >400-line suppression is a good default).
- **Non-git workspaces**: `/vcs/*` returns non-git errors; panel needs an empty state ("not a git repo").
- **Cloud workers**: proxy GETs are allowed for all scopes — confirm product intent that viewers may see diffs (they can already fetch file contents).
- **Untracked binary/new files**: engine includes untracked in `mode=git`; verify binary stubs render sanely.

## Sources

- `pingdotgg/t3code` @ `9996038` — `apps/server/src/vcs/GitVcsDriverCore.ts`, `vcs/GitVcsDriver.ts`, `checkpointing/*`, `orchestration/Layers/CheckpointReactor.ts`, `apps/web/src/components/DiffPanel.tsx`, `components/diffs/*`, `lib/diffRendering.ts`, `apps/mobile/src/features/review/*`, `packages/contracts/src/{review,orchestration,rpc}.ts`, `patches/@pierre%2Fdiffs@1.3.0-beta.10.patch`.
- OpenWork @ `5c74c25` — `apps/app/src/components/ui/tool.tsx`, `components/tools/{edit,apply-patch,file}.tsx`, `react-app/domains/session/sync/{parse-tool-parts,session-sync}.ts`, `react-app/kernel/global-sync-provider.tsx`, `react-app/domains/session/panel/{panel-tab-store,side-panel}.tsx`, `apps/server/src/{server.ts,routes/sessions.ts,session-read-model.ts}`.
- opencode @ `v1.17.4` (engine pinned `v1.18.18`) — `packages/opencode/src/project/vcs.ts`, `snapshot/index.ts`, `session/revert.ts`, `server/routes/instance/httpapi/groups/{instance,file,session}.ts`.
- npm: `@pierre/diffs` (Apache-2.0, 1.3.6), `@git-diff-view/react` (MIT, 0.1.7).
