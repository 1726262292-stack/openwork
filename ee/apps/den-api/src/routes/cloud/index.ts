import { and, desc, eq } from "@openwork-ee/den-db/drizzle"
import { WorkerTable, WorkerTokenTable } from "@openwork-ee/den-db/schema"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import type { Hono, MiddlewareHandler } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"
import { organizationCloudEnabled } from "../../capability-sources/cloud-rollout.js"
import { db } from "../../db.js"
import { env, type DenOrgMode } from "../../env.js"
import { orgMemberRoute } from "../../middleware/index.js"
import { jsonResponse, notFoundSchema, unauthorizedSchema } from "../../openapi.js"
import { getDaytonaSandboxRecord, refreshDaytonaSignedPreview } from "../../workers/daytona.js"
import { CLOUD_INSTANCE_BACKEND, CLOUD_INSTANCE_NAME } from "../../workers/cloud-constants.js"
import { wakeCloudWorker as defaultWakeCloudWorker } from "../../workers/cloud-lifecycle.js"
import type { OrgRouteVariables } from "../org/shared.js"
import { continueCloudProvisioning, token } from "../workers/shared.js"

type CloudRouteOptions = {
  memberRoute?: MiddlewareHandler<{ Variables: OrgRouteVariables }>
  orgMode?: DenOrgMode
  provisionerMode?: "stub" | "render" | "daytona"
  daytonaApiKey?: string
  continueProvisioning?: typeof continueCloudProvisioning
  refreshSignedPreview?: typeof refreshDaytonaSignedPreview
  ensureCloudWorker?: EnsureCloudWorker
  getSandboxRecord?: GetSandboxRecord
  wakeCloudWorker?: WakeCloudWorker
}

type CloudWorker = Pick<typeof WorkerTable.$inferSelect, "id" | "status">
type CloudSandboxRecord = Pick<NonNullable<Awaited<ReturnType<typeof getDaytonaSandboxRecord>>>, "signed_preview_url" | "signed_preview_url_expires_at">
type OrgId = typeof WorkerTable.$inferSelect.org_id
type UserId = typeof WorkerTable.$inferSelect.created_by_user_id
type CloudInstanceResponse = {
  status: "provisioning" | "waking" | "ready" | "failed"
  url: string | null
}
type EnsureCloudWorker = (input: {
  orgId: OrgId
  createdByUserId: UserId
  continueProvisioning: typeof continueCloudProvisioning
}) => Promise<CloudWorker>
type GetSandboxRecord = (workerId: CloudWorker["id"]) => Promise<CloudSandboxRecord | null>
type WakeCloudWorker = (workerId: CloudWorker["id"]) => Promise<void>

const cloudInstanceResponseSchema = z.object({
  status: z.enum(["provisioning", "waking", "ready", "failed"]),
  url: z.string().url().nullable(),
}).meta({ ref: "CloudInstanceResponse" })

function cloudNotFound() {
  return { error: "cloud_not_found" }
}

function hasDaytonaProvisioner(options: CloudRouteOptions) {
  const apiKey = options.daytonaApiKey !== undefined ? options.daytonaApiKey : env.daytona.apiKey
  return (options.provisionerMode ?? env.provisionerMode) === "daytona" && Boolean(apiKey?.trim())
}

async function getCloudWorker(orgId: OrgId) {
  const rows = await db
    .select()
    .from(WorkerTable)
    .where(and(
      eq(WorkerTable.org_id, orgId),
      eq(WorkerTable.destination, "cloud"),
      eq(WorkerTable.sandbox_backend, CLOUD_INSTANCE_BACKEND),
    ))
    .orderBy(desc(WorkerTable.created_at))
    .limit(1)

  return rows[0] ?? null
}

async function createCloudWorker(input: {
  orgId: OrgId
  createdByUserId: UserId
  continueProvisioning: typeof continueCloudProvisioning
}): Promise<CloudWorker> {
  const workerId = createDenTypeId("worker")
  const hostToken = token()
  const clientToken = token()
  const activityToken = token()

  await db.insert(WorkerTable).values({
    id: workerId,
    org_id: input.orgId,
    created_by_user_id: input.createdByUserId,
    name: CLOUD_INSTANCE_NAME,
    description: "OpenWork Cloud browser instance",
    destination: "cloud",
    status: "provisioning",
    sandbox_backend: CLOUD_INSTANCE_BACKEND,
  })

  await db.insert(WorkerTokenTable).values([
    {
      id: createDenTypeId("workerToken"),
      worker_id: workerId,
      scope: "host",
      token: hostToken,
    },
    {
      id: createDenTypeId("workerToken"),
      worker_id: workerId,
      scope: "client",
      token: clientToken,
    },
    {
      id: createDenTypeId("workerToken"),
      worker_id: workerId,
      scope: "activity",
      token: activityToken,
    },
  ])

  void input.continueProvisioning({
    workerId,
    name: CLOUD_INSTANCE_NAME,
    hostToken,
    clientToken,
    activityToken,
  })

  return { id: workerId, status: "provisioning" }
}

async function ensureCloudWorker(input: {
  orgId: OrgId
  createdByUserId: UserId
  continueProvisioning: typeof continueCloudProvisioning
}) {
  const existing = await getCloudWorker(input.orgId)
  if (existing) {
    return existing
  }

  return createCloudWorker(input)
}

async function resolveCloudInstance(input: {
  worker: CloudWorker
  refreshSignedPreview: typeof refreshDaytonaSignedPreview
  getSandboxRecord: GetSandboxRecord
  startWake: (workerId: CloudWorker["id"]) => void
}): Promise<CloudInstanceResponse> {
  if (input.worker.status === "failed") {
    return { status: "failed", url: null }
  }

  if (input.worker.status === "stopped") {
    input.startWake(input.worker.id)
    return { status: "waking", url: null }
  }

  const sandbox = await input.getSandboxRecord(input.worker.id)
  if (input.worker.status === "provisioning" && sandbox) {
    return { status: "waking", url: null }
  }

  if (!sandbox) {
    return { status: "provisioning", url: null }
  }

  if (sandbox.signed_preview_url_expires_at.getTime() > Date.now()) {
    return { status: "ready", url: sandbox.signed_preview_url }
  }

  try {
    const refreshed = await input.refreshSignedPreview(input.worker.id)
    if (!refreshed) {
      return { status: "failed", url: null }
    }
    return { status: "ready", url: refreshed.signed_preview_url }
  } catch {
    return { status: "failed", url: null }
  }
}

export function registerCloudRoutes<T extends { Variables: OrgRouteVariables }>(
  app: Hono<T>,
  options: CloudRouteOptions = {},
) {
  const orgMemberRouteMiddleware = options.memberRoute ?? orgMemberRoute()
  const continueProvisioning = options.continueProvisioning ?? continueCloudProvisioning
  const refreshSignedPreview = options.refreshSignedPreview ?? refreshDaytonaSignedPreview
  const ensureWorker = options.ensureCloudWorker ?? ensureCloudWorker
  const getSandboxRecord = options.getSandboxRecord ?? getDaytonaSandboxRecord
  const wakeCloudWorker = options.wakeCloudWorker ?? defaultWakeCloudWorker
  const wakingWorkers = new Set<CloudWorker["id"]>()

  function startWake(workerId: CloudWorker["id"]) {
    if (wakingWorkers.has(workerId)) {
      return
    }

    wakingWorkers.add(workerId)
    void wakeCloudWorker(workerId)
      .catch(() => undefined)
      .finally(() => {
        wakingWorkers.delete(workerId)
      })
  }

  app.get(
    "/v1/cloud/instance",
    describeRoute({
      tags: ["Cloud"],
      summary: "Get the active organization's Cloud instance",
      description: "Starts the active organization's OpenWork Cloud browser instance when needed and returns its browser URL once ready.",
      responses: {
        200: jsonResponse("Cloud instance status returned successfully.", cloudInstanceResponseSchema),
        401: jsonResponse("The caller must be signed in to open Cloud.", unauthorizedSchema),
        404: jsonResponse("Cloud is not available for this organization.", notFoundSchema),
      },
    }),
    orgMemberRouteMiddleware,
    async (c) => {
      const payload = c.get("organizationContext")
      if (!organizationCloudEnabled(payload.organization.metadata, { orgMode: options.orgMode ?? env.orgMode })) {
        return c.json(cloudNotFound(), 404)
      }

      if (!hasDaytonaProvisioner(options)) {
        return c.json(cloudNotFound(), 404)
      }

      const user = c.get("user")
      if (!user?.id) {
        return c.json({ error: "unauthorized" }, 401)
      }

      const worker = await ensureWorker({
        orgId: payload.organization.id,
        createdByUserId: user.id,
        continueProvisioning,
      })
      const instance = await resolveCloudInstance({ worker, refreshSignedPreview, getSandboxRecord, startWake })

      return c.json(instance)
    },
  )
}
