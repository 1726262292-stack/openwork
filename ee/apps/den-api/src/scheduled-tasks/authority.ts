import { and, eq, isNull } from "@openwork-ee/den-db/drizzle"
import { MemberTable, WorkerTable } from "@openwork-ee/den-db/schema"
import type {
  ScheduledTaskDefinition,
  ScheduledTaskGrant,
  ScheduledTaskPlacement,
} from "@openwork/types/scheduled-tasks"
import { scheduledTaskPlacementIdentity } from "@openwork/scheduled-tasks"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "../db.js"
import { getWorkerTokensAndConnect } from "../routes/workers/shared.js"
import { CLOUD_INSTANCE_BACKEND } from "../workers/cloud-constants.js"

const CAPABILITY_ACTIONS = new Map([
  ["workspace.files.read", "read"],
  ["workspace.files.write", "write"],
])

export type DenScheduledTaskAuthorityFailure = {
  ok: false
  code:
    | "invalid-placement"
    | "invalid-grant"
    | "capability-unavailable"
    | "credential-unavailable"
    | "membership-unavailable"
    | "worker-unavailable"
    | "worker-stopped"
    | "worker-starting"
    | "workspace-unavailable"
  message: string
}

export type DenScheduledTaskAuthorityResult =
  | { ok: true }
  | DenScheduledTaskAuthorityFailure

type MemberRow = typeof MemberTable.$inferSelect
type WorkerRow = typeof WorkerTable.$inferSelect

export type DenScheduledTaskWorkerAvailability =
  | "ready"
  | "wakeable-stopped"
  | "starting"
  | "unavailable"

export function classifyDenScheduledTaskWorker(
  worker: Pick<
    WorkerRow,
    "created_by_user_id" | "destination" | "sandbox_backend" | "status"
  > | null,
  memberUserId: string,
): DenScheduledTaskWorkerAvailability {
  if (
    !worker
    || worker.created_by_user_id !== memberUserId
    || worker.destination !== "cloud"
    || worker.sandbox_backend !== CLOUD_INSTANCE_BACKEND
  ) return "unavailable"
  if (worker.status === "stopped") return "wakeable-stopped"
  if (worker.status === "provisioning") return "starting"
  return worker.status === "healthy" ? "ready" : "unavailable"
}

export interface DenScheduledTaskAuthorityStore {
  getActiveMember(input: {
    organizationId: MemberRow["organizationId"]
    membershipId: MemberRow["id"]
  }): Promise<MemberRow | null>
  getWorker(input: {
    organizationId: WorkerRow["org_id"]
    workerId: WorkerRow["id"]
  }): Promise<WorkerRow | null>
  resolveWorkspaceId(worker: WorkerRow): Promise<string | null>
}

export const databaseDenScheduledTaskAuthorityStore: DenScheduledTaskAuthorityStore = {
  async getActiveMember(input) {
    const [member] = await db
      .select()
      .from(MemberTable)
      .where(and(
        eq(MemberTable.id, input.membershipId),
        eq(MemberTable.organizationId, input.organizationId),
        isNull(MemberTable.removedAt),
      ))
      .limit(1)
    return member ?? null
  },
  async getWorker(input) {
    const [worker] = await db
      .select()
      .from(WorkerTable)
      .where(and(
        eq(WorkerTable.id, input.workerId),
        eq(WorkerTable.org_id, input.organizationId),
      ))
      .limit(1)
    return worker ?? null
  },
  async resolveWorkspaceId(worker) {
    const result = await getWorkerTokensAndConnect(worker)
    if ("error" in result) return null
    return result.connect?.workspaceId ?? null
  },
}

function fail(
  code: DenScheduledTaskAuthorityFailure["code"],
  message: string,
): DenScheduledTaskAuthorityFailure {
  return { ok: false, code, message }
}

function sameModel(
  left: ScheduledTaskDefinition["model"],
  right: ScheduledTaskGrant["model"],
) {
  return left.providerId === right.providerId
    && left.modelId === right.modelId
    && left.agent === right.agent
}

function validateCapabilityReferences(placement: ScheduledTaskPlacement) {
  const seen = new Set<string>()
  for (const reference of placement.capabilityReferences) {
    const expectedAction = CAPABILITY_ACTIONS.get(reference.id)
    if (
      reference.source !== "openwork"
      || !expectedAction
      || reference.actionClass !== expectedAction
      || seen.has(reference.id)
    ) {
      return fail(
        "capability-unavailable",
        "Remote Scheduled Tasks currently allow only reviewed workspace file read/write capabilities.",
      )
    }
    seen.add(reference.id)
  }
  return { ok: true as const }
}

export function validateDenScheduledTaskGrant(input: {
  definition: ScheduledTaskDefinition
  grant: ScheduledTaskGrant
}): DenScheduledTaskAuthorityResult {
  const placement = input.definition.placement
  if (!placement || placement.target.kind !== "den-worker") {
    return fail("invalid-placement", "The reviewed task must target a Den worker.")
  }
  if (
    placement.schedulerOwner !== "den"
    || placement.executionAvailability !== "cloud"
    || placement.executionPrincipal.kind !== "den-membership"
  ) {
    return fail("invalid-placement", "The task placement is not a Den Cloud placement.")
  }
  const capabilityValidation = validateCapabilityReferences(placement)
  if (!capabilityValidation.ok) return capabilityValidation

  if (
    !input.grant.placement
    || input.grant.placementIdentity !== scheduledTaskPlacementIdentity(placement)
    || scheduledTaskPlacementIdentity(input.grant.placement)
      !== scheduledTaskPlacementIdentity(placement)
  ) {
    return fail("invalid-grant", "The grant does not bind the reviewed Den placement.")
  }
  if (input.grant.filesystemScope?.kind !== "den-worker-relative-roots") {
    return fail("invalid-grant", "Den grants require worker-relative filesystem roots.")
  }
  if (input.grant.authorizedWorkspaceRoots.length > 0) {
    return fail("invalid-grant", "Den grants cannot contain local absolute workspace roots.")
  }
  const capabilityIds = [...placement.capabilityReferences]
    .map((reference) => reference.id)
    .sort()
  const grantCapabilityIds = [...input.grant.capabilityIds].sort()
  if (JSON.stringify(capabilityIds) !== JSON.stringify(grantCapabilityIds)) {
    return fail("invalid-grant", "The grant capability set differs from the reviewed placement.")
  }
  if (
    input.grant.actionClasses.some((action) => action === "execute")
    || input.grant.communicationPolicy !== "deny"
    || input.grant.destructiveActionPolicy !== "deny"
    || input.grant.selfModificationPolicy !== "deny"
  ) {
    return fail("invalid-grant", "The grant exceeds the initial remote execution policy.")
  }
  if (
    (input.grant.filesystem.read && !input.grant.actionClasses.includes("read"))
    || (input.grant.filesystem.write && !input.grant.actionClasses.includes("write"))
    || !sameModel(input.definition.model, input.grant.model)
    || input.definition.maximumRuntimeMs !== input.grant.maximumRuntimeMs
  ) {
    return fail("invalid-grant", "The grant does not exactly match the reviewed task definition.")
  }
  if (input.definition.model.providerId || input.definition.model.modelId) {
    return fail(
      "credential-unavailable",
      "Explicit provider credentials are not yet supported for remote Scheduled Tasks.",
    )
  }
  return { ok: true }
}

export async function validateCurrentDenScheduledTaskAuthority(input: {
  definition: ScheduledTaskDefinition
  grant: ScheduledTaskGrant
  now: number
  store?: DenScheduledTaskAuthorityStore
}): Promise<DenScheduledTaskAuthorityResult> {
  const grantValidation = validateDenScheduledTaskGrant(input)
  if (!grantValidation.ok) return grantValidation

  const placement = input.definition.placement
  if (!placement || placement.target.kind !== "den-worker") {
    return fail("invalid-placement", "The reviewed task must target a Den worker.")
  }
  if (placement.executionPrincipal.kind !== "den-membership") {
    return fail("invalid-placement", "The reviewed task must execute as a Den membership.")
  }
  if (input.grant.revokedAt !== null) {
    return fail("invalid-grant", "The reviewed grant was revoked.")
  }
  if (input.grant.expiresAt !== null && input.grant.expiresAt <= input.now) {
    return fail("invalid-grant", "The reviewed grant expired.")
  }

  const store = input.store ?? databaseDenScheduledTaskAuthorityStore
  const organizationId = normalizeDenTypeId(
    "organization",
    placement.target.organizationId,
  )
  const member = await store.getActiveMember({
    organizationId,
    membershipId: normalizeDenTypeId(
      "member",
      placement.executionPrincipal.membershipId,
    ),
  })
  if (!member?.userId) {
    return fail("membership-unavailable", "The execution membership is no longer active.")
  }
  const worker = await store.getWorker({
    organizationId,
    workerId: normalizeDenTypeId("worker", placement.target.workerId),
  })
  const availability = classifyDenScheduledTaskWorker(worker, member.userId)
  if (availability === "unavailable") {
    return fail("worker-unavailable", "The reviewed worker is unavailable to this member.")
  }
  if (availability === "wakeable-stopped") {
    return fail("worker-stopped", "The reviewed worker is stopped and can be woken.")
  }
  if (availability === "starting") {
    return fail("worker-starting", "The reviewed worker is starting.")
  }
  if (!worker) return fail("worker-unavailable", "The reviewed worker is unavailable to this member.")
  const workspaceId = await store.resolveWorkspaceId(worker)
  if (workspaceId !== placement.target.workspaceId) {
    return fail("workspace-unavailable", "The reviewed worker workspace is no longer available.")
  }
  return { ok: true }
}
