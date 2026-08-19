import { expect, test } from "bun:test"
import { DEN_ACCOUNT_CONFIG } from "@openwork-ee/den-core/account-linking-policy"

test("SSO can implicitly link a verified-domain provider to an existing unverified Den user", () => {
  expect(DEN_ACCOUNT_CONFIG.accountLinking.enabled).toBe(true)
  expect(DEN_ACCOUNT_CONFIG.accountLinking.requireLocalEmailVerified).toBe(false)
})
