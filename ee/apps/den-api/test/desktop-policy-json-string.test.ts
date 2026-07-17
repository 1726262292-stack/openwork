import { expect, test } from "bun:test"
import {
  calculateEffectiveDesktopPolicy,
  normalizeDefaultDesktopPolicyValue,
  normalizeDesktopPolicyDocument,
  normalizeDesktopPolicyDocumentWrite,
  normalizeDesktopPolicyValue,
  normalizeOnboardingPromptConfig,
} from "@openwork/types/den/desktop-policies"

const onboardingPrompts = ["Create a workspace", "Connect your tools"]
const onboardingPromptDescriptions = ["Workspace setup", "Tool setup"]

test("normalizes MariaDB stringified desktop policy documents", () => {
  const policyJson = JSON.stringify({
    allowCustomProviders: false,
    onboardingPrompts,
    onboardingPromptDescriptions,
  })

  expect(normalizeDesktopPolicyValue(policyJson)).toEqual({ allowCustomProviders: false })
  expect(normalizeDefaultDesktopPolicyValue(policyJson).allowCustomProviders).toBe(false)
  expect(normalizeDefaultDesktopPolicyValue(policyJson).allowZenModel).toBe(true)
  expect(normalizeDesktopPolicyDocument(policyJson)).toEqual({
    allowCustomProviders: false,
    onboardingPrompts,
    onboardingPromptDescriptions,
  })
  expect(normalizeDesktopPolicyDocumentWrite(policyJson)).toEqual({
    allowCustomProviders: false,
    onboardingPrompts,
    onboardingPromptDescriptions,
  })
  expect(normalizeOnboardingPromptConfig(policyJson)).toEqual({
    onboardingPrompts,
    onboardingPromptDescriptions,
  })
  expect(calculateEffectiveDesktopPolicy({
    orgPolicyCount: 1,
    defaultPolicy: normalizeDesktopPolicyValue(policyJson),
    assignedPolicies: [],
  }).allowCustomProviders).toBe(false)
})

test("keeps defaults for invalid desktop policy strings", () => {
  const invalidPolicyJson = "{allowCustomProviders:false"
  const defaults = normalizeDefaultDesktopPolicyValue(invalidPolicyJson)

  expect(normalizeDesktopPolicyValue(invalidPolicyJson)).toEqual({})
  expect(defaults.allowCustomProviders).toBe(true)
  expect(defaults.allowZenModel).toBe(true)
})

test("keeps object desktop policy values unchanged", () => {
  const policy = {
    allowCustomProviders: false,
    allowZenModel: true,
  }

  expect(normalizeDesktopPolicyValue(policy)).toEqual(policy)
  expect(normalizeDesktopPolicyDocumentWrite(policy)).toEqual(policy)
})
