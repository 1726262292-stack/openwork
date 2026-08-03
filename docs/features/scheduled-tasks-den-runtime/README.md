# Scheduled Tasks: Den runtime

## Deliverable value

> My reviewed task runs in Den while every personal device is offline.

This branch supplies the remote runtime behind that outcome. It is deliberately
layered on the portable Scheduled Tasks domain from commit `7352171ea`; it does
not fork the domain model and it does not import Den concerns into the shared
package.

## Scope

The delivery is a Den run-once vertical slice plus a bounded recurring runtime:

- Den owns the MySQL task, revision, grant, run, attempt, event, artifact, and
  tick-invocation records.
- A member can list and inspect owned tasks, create a disabled Den draft, review
  its bounded authority, queue or cancel an idempotent run once, enable or pause
  a reviewed recurring task, and read the durable receipt.
- Only an active member's healthy, currently bound worker can execute the
  reviewed placement.
- The worker authenticates with a dedicated execution token, claims a short
  lease, heartbeats it, appends ordered events, and completes the attempt.
- Expired leases retry after the reviewed delay and only inside the reviewed
  attempt ceiling; exhaustion becomes an ambiguous receipt and pauses the task
  for explicit review before any future occurrence can run.
- A stopped reviewed cloud worker atomically retains and queues the exact due
  occurrence before Den wakes it. If the worker does not claim that occurrence
  by the later of the reviewed grace period and the 60-second minimum dispatch
  window, Den records one visible missed receipt and pauses the task for repair.
- The worker reuses the existing OpenCode execution adapter in a fresh session.
  It aborts at the smaller of the task and grant runtime ceilings.
- File authority is expressed as paths relative to the Den worker workspace;
  local absolute roots never cross the Den boundary.
- A Vercel cron route and an opt-in self-hosted Den loop send the same signed,
  replay-protected tick request. Neither driver stores task policy or runs the
  agent itself.

The member endpoints are:

- `GET /v1/scheduled-tasks`
- `POST /v1/scheduled-tasks`
- `GET /v1/scheduled-tasks/:taskId`
- `POST /v1/scheduled-tasks/:taskId/review`
- `POST /v1/scheduled-tasks/:taskId/enable`
- `POST /v1/scheduled-tasks/:taskId/pause`
- `POST /v1/scheduled-tasks/:taskId/runs`
- `GET /v1/scheduled-tasks/:taskId/runs/:runId`
- `POST /v1/scheduled-tasks/:taskId/runs/:runId/cancel`

The worker endpoints are claim, heartbeat, ordered event append, and completion
under `/v1/workers/:id/scheduled-task-*`. The internal tick endpoint is
`POST /internal/scheduled-tasks/tick`.

## Boundaries

The portable `@openwork/scheduled-tasks` package owns schedules, occurrence and
placement identity, state transitions, and narrow ports. The separate
`@openwork/scheduled-tasks-den` package owns the Den worker wire contract and
signed tick client. A tenant-bound Den repository implements the same portable
repository port as SQLite and runs the same ten-check conformance suite. This
branch otherwise owns only Den persistence and authority, worker
materialization, and hosted/self-hosted wake adapters.

It does not change the Scheduled Tasks React UI, the local SQLite repository,
the macOS background driver, or the OpenCode execution policy. Switching a task
from local to Den still requires a new placement and a new review; no local
filesystem grant is reused.

## Configuration

Hosted Den Web requires `CRON_SECRET`, `DEN_API_BASE`, and a separate
`DEN_SCHEDULED_TASKS_INTERNAL_SECRET` of at least 32 characters. Self-hosted Den
can enable the dedicated Compose service with the `scheduled-tasks` profile and
the same internal secret.

Workers receive a separately scoped execution token only through provisioning.
That token is not returned with the public worker credentials.

## Verification performed

- Portable Scheduled Tasks typecheck and tests.
- OpenWork server typecheck and Den worker tests.
- Den API typecheck plus service, route, security, and wake-loop tests.
- Den database package typecheck.
- Disposable MySQL proof of the shared ten-check repository contract plus
  tenant scoping, pause-versus-tick transaction fencing, retry and ambiguity
  behavior, serialized execution-token creation, unclaimed manual-run
  recovery, and concurrent missed-occurrence idempotency. The Den database CI
  job provisions the schema and reruns this proof.
- Den Web cron tests.
- Relevant worker-provisioning regression tests.
- Docker Compose `scheduled-tasks` profile rendering.
- Patch whitespace validation.

## Proof still required in deployment

This candidate has not changed live Den, Vercel, Daytona, or Docker state. The
release acceptance journey remains: create and review a disabled task, run it
once on a healthy worker with all personal devices offline, inspect the fresh
session and workspace artifact, and read the durable Den receipt. Run the same
journey through the Vercel and self-hosted wake drivers before enabling recurring
cloud tasks.

Draft update and preview APIs, post-ambiguity repair controls, scheduler health
telemetry, and the Den UI remain follow-up work. The current member-facing
deliverable is the API-backed reviewed remote runtime; it does not claim a
finished visual management experience.
