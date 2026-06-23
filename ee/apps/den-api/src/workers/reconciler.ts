import { and, asc, eq, isNull, lt } from "@openwork-ee/den-db/drizzle"
import { WorkerTable, WorkerTokenTable } from "@openwork-ee/den-db/schema"
import { db } from "../db.js"
import { env } from "../env.js"
import { continueCloudProvisioning } from "../routes/workers/shared.js"

type ProvisioningWorker = typeof WorkerTable.$inferSelect

let workerProvisioningReconcileRunning = false

function tokenByScope(
  tokens: Array<typeof WorkerTokenTable.$inferSelect>,
  scope: typeof WorkerTokenTable.$inferSelect.scope,
) {
  return tokens.find((entry) => entry.scope === scope)?.token ?? null
}

async function reconcileWorker(worker: ProvisioningWorker) {
  const tokens = await db
    .select()
    .from(WorkerTokenTable)
    .where(and(eq(WorkerTokenTable.worker_id, worker.id), isNull(WorkerTokenTable.revoked_at)))

  const hostToken = tokenByScope(tokens, "host")
  const clientToken = tokenByScope(tokens, "client")
  const activityToken = tokenByScope(tokens, "activity")

  if (!hostToken || !clientToken || !activityToken) {
    await db
      .update(WorkerTable)
      .set({ status: "failed" })
      .where(and(eq(WorkerTable.id, worker.id), eq(WorkerTable.status, "provisioning")))
    console.error(`[workers] provisioning reconcile failed for ${worker.id}: missing worker tokens`)
    return
  }

  await continueCloudProvisioning({
    workerId: worker.id,
    name: worker.name,
    hostToken,
    clientToken,
    activityToken,
  })
}

export async function reconcileStaleProvisioningWorkers() {
  const staleBefore = new Date(Date.now() - env.workerProvisioningReconcileStaleMs)
  const workers = await db
    .select()
    .from(WorkerTable)
    .where(and(
      eq(WorkerTable.destination, "cloud"),
      eq(WorkerTable.status, "provisioning"),
      lt(WorkerTable.updated_at, staleBefore),
    ))
    .orderBy(asc(WorkerTable.updated_at))
    .limit(env.workerProvisioningReconcileBatchSize)

  for (const worker of workers) {
    console.info(`[workers] reconciling stale provisioning worker ${worker.id}`)
    await reconcileWorker(worker)
  }

  return { checked: workers.length }
}

export function startWorkerProvisioningReconcileLoop(
  intervalMs = env.workerProvisioningReconcileIntervalMs,
) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return () => undefined
  }

  const run = () => {
    if (workerProvisioningReconcileRunning) {
      return
    }

    workerProvisioningReconcileRunning = true
    void reconcileStaleProvisioningWorkers()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[workers][provisioning_reconcile_failed] reason=${message}`)
      })
      .finally(() => {
        workerProvisioningReconcileRunning = false
      })
  }

  const timer = setInterval(run, intervalMs)
  timer.unref()
  run()
  return () => clearInterval(timer)
}
