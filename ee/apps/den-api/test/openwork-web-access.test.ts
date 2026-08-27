import { expect, test } from "bun:test"
import {
  hasOpenWorkWebComplimentaryAccess,
  resolveOpenWorkWebAccess,
  setOpenWorkWebComplimentaryAccess,
} from "../src/openwork-web-access.js"

test("complimentary Web access is an explicit metadata grant that preserves unrelated settings", () => {
  const original = {
    brandAppName: "OpenWork Internal",
    capabilities: { cloud: true },
    complimentaryAccess: { futureProduct: true },
  }
  const granted = setOpenWorkWebComplimentaryAccess(original, true)

  expect(hasOpenWorkWebComplimentaryAccess(granted)).toBe(true)
  expect(granted).toMatchObject({
    brandAppName: "OpenWork Internal",
    capabilities: { cloud: true },
    complimentaryAccess: { futureProduct: true, openworkWeb: true },
  })
  expect(original.complimentaryAccess).toEqual({ futureProduct: true })

  const revoked = setOpenWorkWebComplimentaryAccess(granted, false)
  expect(hasOpenWorkWebComplimentaryAccess(revoked)).toBe(false)
  expect(revoked).toMatchObject({
    brandAppName: "OpenWork Internal",
    capabilities: { cloud: true },
    complimentaryAccess: { futureProduct: true },
  })
})

test("revoking the only complimentary grant removes the empty metadata group", () => {
  expect(setOpenWorkWebComplimentaryAccess({ complimentaryAccess: { openworkWeb: true } }, false)).toEqual({})
})

test("complimentary Web access fails closed behind the deployment switch", () => {
  expect(resolveOpenWorkWebAccess({
    deploymentAvailable: false,
    hasEligibleSubscription: false,
    complimentaryAccess: true,
  })).toEqual({
    hasAccess: false,
    accessSource: null,
    complimentaryAccess: true,
  })

  expect(resolveOpenWorkWebAccess({
    deploymentAvailable: true,
    hasEligibleSubscription: false,
    complimentaryAccess: true,
  })).toEqual({
    hasAccess: true,
    accessSource: "complimentary",
    complimentaryAccess: true,
  })
})

test("an eligible paid subscription remains the authoritative source when both grants are present", () => {
  expect(resolveOpenWorkWebAccess({
    deploymentAvailable: true,
    hasEligibleSubscription: true,
    complimentaryAccess: true,
  })).toEqual({
    hasAccess: true,
    accessSource: "subscription",
    complimentaryAccess: true,
  })
})
