# Scheduled Tasks: Den run-once

## Promise

My reviewed task runs in Den while every personal device is offline.

## Acceptance narration

1. In Den, create a disabled Scheduled Task for an existing healthy worker and
   its current workspace.
2. Review the exact worker placement, relative filesystem roots, file
   capabilities, model policy, and maximum runtime.
3. Queue Run once with a unique idempotency key.
4. Keep every personal OpenWork client offline.
5. Observe that the assigned worker claims one short-lived lease and opens a
   fresh OpenCode session.
6. Confirm that repeated Run once requests with the same key return the same
   run and do not create a duplicate execution.
7. Inspect the Den receipt: organization, member, worker, workspace, immutable
   task and grant revisions, attempts, session, bounded usage, and only
   workspace-relative file artifacts.
8. For a recurring definition, enable the reviewed task, let Den wake a stopped
   reviewed worker without changing the exact due occurrence, and pause it
   again through the member API.
9. Queue a second run, cancel it before claim, and confirm the tenant-scoped
   receipt records cancellation without executing it.

## Driver proof

After the run-once journey passes, exercise the same bounded tick twice:

- Hosted: authenticated Vercel Cron to Den Web, then a signed Den API tick.
- Self-hosted: the opt-in Den wake-loop service from the Docker Compose
  `scheduled-tasks` profile.

Both drivers must return quickly after queueing work. They do not run OpenCode,
own task definitions, or wait for task completion.

## Failure frames

- Removed membership, an unhealthy or replaced worker, a workspace mismatch,
  an expired/revoked grant, or expanded capability requests refuse execution.
- Forged or replayed ticks are rejected.
- A worker without the execution-token scope cannot claim work.
- A stale, expired, or mismatched lease cannot heartbeat, append events, or
  complete an attempt. An expired lease retries only after the reviewed delay
  and within the reviewed attempt ceiling, then becomes an ambiguous receipt
  and pauses the task for explicit review.
- A stopped worker first retains and queues the exact due occurrence, then is
  woken. If it does not claim that occurrence by the later of the reviewed
  grace period and the 60-second minimum dispatch window, Den produces one
  missed receipt and a repairable task state.
- Cancellation is scoped to the owning organization and member. A cross-tenant
  task or run identifier is indistinguishable from a missing resource.
- Execution aborts at the smaller reviewed task/grant runtime ceiling.
- Absolute paths, workspace escapes, missing files, and file URLs never become
  portable Den file artifacts.

## Evidence boundary

Automated contract proof is included in the branch. A live Den-to-worker run,
Vercel invocation, Docker launch, and visual artifact capture are deliberately
not represented as completed until they are exercised in deployment.
