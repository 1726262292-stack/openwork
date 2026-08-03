# Scheduled Tasks module

Scheduled Tasks delivers one independently useful local workflow: a person can
create a disabled workspace task, review its exact authority, run it once in a
fresh session, and inspect the durable receipt and produced files.

The feature is packaged behind four boundaries:

1. `execution.ts` is the engine-neutral execution and cancellation port.
2. `scheduled-task-service.ts`, the store, schedule calculator, and scheduler
   own task policy and persistence without importing OpenCode.
3. `opencode-execution-adapter.ts` is the only OpenCode implementation of the
   execution port.
4. `module.ts` is the host composition root. It owns the database, authority
   adapter, artifact resolver, routes, scheduler lifecycle, and shutdown.

`apps/server/src/server.ts` may create, register, start, and stop the module;
it must not assemble Scheduled Tasks internals. The desktop consumes the
server API through the narrow `ScheduledTasksClient` contract in the Scheduled
Tasks UI domain.

Recurring daily and weekly execution uses the same domain and execution port.
It does not grant broader authority, create a second app-side scheduler, or
make the domain depend on OpenCode. Cloud and closed-app scheduling remain
outside this local-running module.
