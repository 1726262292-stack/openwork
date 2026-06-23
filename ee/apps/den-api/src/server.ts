import { serve } from "@hono/node-server"
import app from "./app.js"
import { env } from "./env.js"
import { startScimMaintenanceLoop } from "./scim-maintenance.js"
import { startWorkerProvisioningReconcileLoop } from "./workers/reconciler.js"

startScimMaintenanceLoop()
startWorkerProvisioningReconcileLoop()

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`den-api listening on ${info.port}`)
})
