# AGENTS.md

OpenWork helps users run agents, skills, and MCP. It is an open-source alternative to Claude Cowork/Codex as a desktop app.

## What OpenWork Is

OpenWork is a practical control surface for agentic work:

* Run local and remote agent workflows from one place.
* Use OpenCode capabilities directly through OpenWork.
* Compose desktop app, server, and messaging connectors without lock-in.
* Treat the OpenWork app as a client of the OpenWork server API surface.
* Connect to hosted workers through a simple user flow: `Add a worker` -> `Connect remote`.

## Core Philosophy

* **Local-first, cloud-ready**: OpenWork runs on your machine in one click and can connect to cloud workflows when needed.
* **Server-consumption first**: the app should consume OpenWork server surfaces (self-hosted or hosted), not invent parallel behavior.
* **Composable**: use the desktop app, WhatsApp/Slack/Telegram connectors, or server mode based on the task.
* **Ejectable**: OpenWork is powered by OpenCode, so anything OpenCode can do is available in OpenWork, even before a dedicated UI exists.
* **Sharing is caring**: start solo, then share quickly; one CLI or desktop command can spin up an instantly shareable instance.


## Pull Request Expectations (Fast Merge)

If you open a PR, you must run tests and report what you ran (commands + result).

To maximize merge speed, include evidence of the end-to-end flow:

* Ideally: attach a short video/screen recording showing the flow running successfully.
* Otherwise: screenshots are acceptable, but video is preferred.

If you cannot run tests or capture the video, say so explicitly and explain why, and include the exact commands/steps for the reviewer to reproduce.

## Coding Guidelines

### TypeScript

- Never use `any`, typecasts, or `as`, unless 100% necessary or specifically instructed.
- Name props in an `interface FooProps` directly above the component, not inline; use a `type` when composing utilities like `React.ComponentProps`.
- Destructure props in the signature (`function Foo({ a, b }: FooProps)`), not via `props.x`; forward extra props with rest + spread: `({ a, ...props })` → `<Bar {...props} />`.
- Fix types at their source; don't paper over them with casts, guards, or wrapper components.
- Trust existing types: don't re-parse or re-validate (`zod`, `safeParse`, `.trim()`) data that is already typed upstream.
- Don't assume a field, prop, or API exists — verify it against the types, docs, or `git diff` before using it (e.g. confirm `reasoning.state` actually exists).

### Package Managers

- Use pnpm.
- Never use npm or yarn.

### UI and UX

- Use components from @/components when possible.
- When creating new components, we prefer using shadcn/ui with (Base UI).
- This app uses **Base UI, not Radix** — read the component source/docs before assuming an API or a `data-[state=*]` attribute.
- Assume most end users of OpenWork are non-technical.
- Use shadcn/ui colors or other named variables; instead of legacy `*-dls-*` classes.
- Use the Tailwind scale and idioms: `text-xs`/`text-sm` (not `text-[13px]`), `size-4` (not `h-4 w-4`), and `flex` + `gap-*` (not `space-y-*`/`space-x-*`).
- Compose classes with `cn()` from `@/lib/utils` and define variants with `cva`; don't expose an open-ended `className` escape hatch on shared components.

### Tech Stack Preferences

When uncertain, prefer: Tailwind, TypeScript, React, shadcn/ui (Base UI), TanStack Query, Zustand, Zod, Drizzle, Better-Auth.

### Code Style

- Always strive for concise, simple solutions.
- If a problem can be solved in a simpler way, propose it.
- Use the smallest possible diff to make a change. Then think of how to make it smaller and do that again.
- **Inline single-use values at their point of use.** Only extract a local, helper, or constant when it's reused or names genuinely non-obvious logic — never to merely rename or forward a single expression.
- Stay strictly in scope: no drive-by refactors, file splits, renames, icons, or features the user didn't ask for; don't modify files that aren't part of the request.
- Match existing repo patterns and reuse existing hooks/providers/stores/components before creating new ones.
- Colocate logic with its consumer: a section owns its derived data and mutations; read Zustand state in the component that uses it instead of prop-drilling it through parents.
- Avoid fallback expressions when types or control flow already guarantee a value.
- Use TanStack Query (`useQuery`/`useMutation`) for async fetching/mutations; derive loading/error/data from hook returns, not manual `useState`. Read `.error`/`.isPending` directly (not `.isError` ternaries), inline query keys at the call site, use `initialData` for static fallbacks, and prefer invalidate/refetch over `setQueryData`.
- React Compiler runs in annotation mode: opt in with the `"use memo"` directive atop a file or as the first statement of a component/hook; unmarked functions aren't optimized. In files that aren't opted in, wrap non-trivial derived lists/maps built during render in `useMemo`.
- Use block `if` statements with braces — no single-line `if`s; prefer `for (const x of xs)` over manual index loops.

### Workflow

- If asked to do too much work at once, stop and state that clearly.
