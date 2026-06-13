import { expect, test } from "bun:test"
import {
  cloneOrganizationPermissionCatalog,
  filterOrganizationPermissionRecord,
  validateAssignableOrganizationPermissionRecord,
  validateOrganizationPermissionRecord,
  type OrganizationPermissionRecord,
  type OrganizationRolePermission,
} from "../src/organization-access.js"

function role(roleName: string, permission: OrganizationPermissionRecord): OrganizationRolePermission {
  return {
    role: roleName,
    permission,
  }
}

test("organization role permissions reject unknown resources", () => {
  expect(validateOrganizationPermissionRecord({
    billing: ["delete"],
  })).toEqual({
    ok: false,
    error: "invalid_permission",
    message: 'Unsupported permission resource "billing".',
  })
})

test("organization role permissions reject unknown actions", () => {
  expect(validateOrganizationPermissionRecord({
    organization: ["create"],
  })).toEqual({
    ok: false,
    error: "invalid_permission",
    message: 'Unsupported permission action "organization.create".',
  })
})

test("organization role permissions allow catalog permissions", () => {
  expect(validateOrganizationPermissionRecord({
    ac: ["read"],
    invitation: ["create", "cancel"],
  })).toEqual({ ok: true })
})

test("organization role permissions cannot exceed the assigner permission set", () => {
  const limitedPermission = { ac: ["read"] }
  const roles = [
    role("limited", limitedPermission),
  ]

  expect(validateAssignableOrganizationPermissionRecord({
    permission: { ac: ["delete"] },
    roleValue: "limited",
    roles,
  })).toEqual({
    ok: false,
    error: "invalid_permission",
    message: 'Cannot assign permission "ac.delete".',
  })
})

test("organization owners can assign permissions from the fixed catalog", () => {
  const ownerPermission = cloneOrganizationPermissionCatalog()
  const roles = [
    role("owner", ownerPermission),
  ]

  expect(validateAssignableOrganizationPermissionRecord({
    permission: ownerPermission,
    roleValue: "owner",
    roles,
  })).toEqual({ ok: true })
})

test("legacy stored permissions are filtered to the catalog when read", () => {
  expect(filterOrganizationPermissionRecord({
    ac: ["read", "delete", "unknown"],
    billing: ["delete"],
  })).toEqual({
    ac: ["read", "delete"],
  })
})
