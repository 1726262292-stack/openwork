import { expect, test } from "bun:test"
import { isDenTypeId } from "@openwork-ee/utils/typeid"
import { ensureDenAccountId } from "../src/account-id-policy.js"

test("assigns a Den TypeID when Better Auth supplies no local account ID", () => {
  const account = ensureDenAccountId({
    accountId: "owner@openworklabs.com",
    providerId: "openwork-sso-org_example",
  })

  expect(isDenTypeId("account", account.id)).toBe(true)
  expect(account.accountId).toBe("owner@openworklabs.com")
})

test("replaces a foreign local account ID without changing the IdP account ID", () => {
  const account = ensureDenAccountId({
    id: "5Y5SfV3e1PaIhwtbz5RD7uN8bMX9U",
    accountId: "owner@openworklabs.com",
    providerId: "openwork-sso-org_example",
  })

  expect(isDenTypeId("account", account.id)).toBe(true)
  expect(account.id).not.toBe("5Y5SfV3e1PaIhwtbz5RD7uN8bMX9U")
  expect(account.accountId).toBe("owner@openworklabs.com")
})

test("preserves an existing valid Den account TypeID", () => {
  const original = ensureDenAccountId({ accountId: "owner@openworklabs.com" }).id
  const account = ensureDenAccountId({
    id: original,
    accountId: "owner@openworklabs.com",
  })

  expect(account.id).toBe(original)
})
