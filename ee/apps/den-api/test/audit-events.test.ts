import { expect, test } from "bun:test"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { buildOrganizationAuditEvent, ORGANIZATION_AUDIT_ACTIONS } from "../src/audit-events.js"

test("organization audit events normalize org ids and keep actor context", () => {
  const organizationId = createDenTypeId("organization")
  const actorUserId = createDenTypeId("user")

  const event = buildOrganizationAuditEvent({
    organizationId,
    actorUserId,
    action: ORGANIZATION_AUDIT_ACTIONS.apiKeyCreated,
    payload: {
      apiKeyId: "api-key-id",
      orgMembershipId: "member-id",
      name: "CI key",
      prefix: "den_",
    },
  })

  expect(event.id.startsWith("aev_")).toBe(true)
  expect(event.org_id).toBe(organizationId)
  expect(event.actor_user_id).toBe(actorUserId)
  expect(event.worker_id).toBe(null)
  expect(event.action).toBe("organization.api_key.created")
  expect(event.payload).toEqual({
    apiKeyId: "api-key-id",
    orgMembershipId: "member-id",
    name: "CI key",
    prefix: "den_",
  })
})

test("organization audit events allow empty payloads", () => {
  const event = buildOrganizationAuditEvent({
    organizationId: createDenTypeId("organization"),
    actorUserId: createDenTypeId("user"),
    action: ORGANIZATION_AUDIT_ACTIONS.apiKeyDeleted,
  })

  expect(event.action).toBe("organization.api_key.deleted")
  expect(event.payload).toBe(null)
})

test("organization audit events support member lifecycle actions", () => {
  const targetOrgMembershipId = createDenTypeId("member")
  const targetUserId = createDenTypeId("user")

  const event = buildOrganizationAuditEvent({
    organizationId: createDenTypeId("organization"),
    actorUserId: createDenTypeId("user"),
    action: ORGANIZATION_AUDIT_ACTIONS.memberRoleUpdated,
    payload: {
      targetOrgMembershipId,
      targetUserId,
      previousRole: "member",
      nextRole: "admin",
    },
  })

  expect(event.action).toBe("organization.member.role_updated")
  expect(event.payload).toEqual({
    targetOrgMembershipId,
    targetUserId,
    previousRole: "member",
    nextRole: "admin",
  })
})
