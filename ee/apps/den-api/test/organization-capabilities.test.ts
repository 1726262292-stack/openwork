import { describe, expect, test } from "bun:test"
import {
  normalizeOrganizationCapabilities,
  organizationHasCapability,
  readOrganizationCapabilityOverrides,
} from "../src/organization-capabilities.js"

const defaultCapabilities = { installLinks: false, mcpConnections: false, cloud: false, orgProviderSync: false }

describe("normalizeOrganizationCapabilities", () => {
  test("defaults every capability to false when metadata is empty", () => {
    expect(normalizeOrganizationCapabilities(null)).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities(undefined)).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities({})).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities("")).toEqual(defaultCapabilities)
  })

  test("reads an explicit opt-in from record metadata", () => {
    expect(normalizeOrganizationCapabilities({ capabilities: { installLinks: true } })).toEqual({ installLinks: true, mcpConnections: false, cloud: false, orgProviderSync: false })
    expect(normalizeOrganizationCapabilities({ capabilities: { mcpConnections: true } })).toEqual({ installLinks: false, mcpConnections: true, cloud: false, orgProviderSync: false })
    expect(normalizeOrganizationCapabilities({ capabilities: { cloud: true } })).toEqual({ installLinks: false, mcpConnections: false, cloud: true, orgProviderSync: false })
    expect(normalizeOrganizationCapabilities({ capabilities: { orgProviderSync: true } })).toEqual({ installLinks: false, mcpConnections: false, cloud: false, orgProviderSync: true })
    expect(normalizeOrganizationCapabilities({ capabilities: { installLinks: false, mcpConnections: false } })).toEqual(defaultCapabilities)
  })

  test("reads an explicit opt-in from JSON string metadata", () => {
    expect(normalizeOrganizationCapabilities(JSON.stringify({ capabilities: { installLinks: true, mcpConnections: true, cloud: true, orgProviderSync: true } }))).toEqual({ installLinks: true, mcpConnections: true, cloud: true, orgProviderSync: true })
  })

  test("treats anything but literal true as off", () => {
    expect(normalizeOrganizationCapabilities({ capabilities: { installLinks: "true", mcpConnections: "true", cloud: "true", orgProviderSync: "true" } })).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities({ capabilities: { installLinks: 1, mcpConnections: 1, cloud: 1, orgProviderSync: 1 } })).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities({ capabilities: null })).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities({ capabilities: [] })).toEqual(defaultCapabilities)
    expect(normalizeOrganizationCapabilities("not json")).toEqual(defaultCapabilities)
  })

  test("ignores unrelated metadata keys", () => {
    const metadata = {
      limits: { members: 5, workers: 1 },
      plan: { tier: "enterprise", source: "manual" },
      capabilities: { installLinks: true, mcpConnections: true, cloud: true, orgProviderSync: true },
    }
    expect(normalizeOrganizationCapabilities(metadata)).toEqual({ installLinks: true, mcpConnections: true, cloud: true, orgProviderSync: true })
  })
})

describe("readOrganizationCapabilityOverrides", () => {
  test("leaves absent capability keys absent", () => {
    expect(readOrganizationCapabilityOverrides(null)).toEqual({})
    expect(readOrganizationCapabilityOverrides({})).toEqual({})
    expect(readOrganizationCapabilityOverrides({ capabilities: {} })).toEqual({})
  })

  test("preserves explicit boolean false overrides", () => {
    expect(readOrganizationCapabilityOverrides({ capabilities: { installLinks: false, mcpConnections: false, cloud: false, orgProviderSync: false } })).toEqual({ installLinks: false, mcpConnections: false, cloud: false, orgProviderSync: false })
  })

  test("ignores unrelated and non-boolean metadata", () => {
    expect(readOrganizationCapabilityOverrides({
      limits: { members: 10 },
      plan: { tier: "enterprise" },
      capabilities: { installLinks: "true", mcpConnections: 1, cloud: "true", orgProviderSync: "true", otherCapability: true },
    })).toEqual({})
  })

  test("reads explicit overrides from JSON metadata", () => {
    expect(readOrganizationCapabilityOverrides(JSON.stringify({ capabilities: { installLinks: true, mcpConnections: false, cloud: true, orgProviderSync: false } }))).toEqual({ installLinks: true, mcpConnections: false, cloud: true, orgProviderSync: false })
  })
})

describe("organizationHasCapability", () => {
  test("is false by default and true only with an explicit opt-in", () => {
    expect(organizationHasCapability(null, "installLinks")).toBe(false)
    expect(organizationHasCapability(null, "mcpConnections")).toBe(false)
    expect(organizationHasCapability(null, "cloud")).toBe(false)
    expect(organizationHasCapability(null, "orgProviderSync")).toBe(false)
    expect(organizationHasCapability({ capabilities: {} }, "installLinks")).toBe(false)
    expect(organizationHasCapability({ capabilities: {} }, "mcpConnections")).toBe(false)
    expect(organizationHasCapability({ capabilities: {} }, "cloud")).toBe(false)
    expect(organizationHasCapability({ capabilities: {} }, "orgProviderSync")).toBe(false)
    expect(organizationHasCapability({ capabilities: { installLinks: true } }, "installLinks")).toBe(true)
    expect(organizationHasCapability({ capabilities: { mcpConnections: true } }, "mcpConnections")).toBe(true)
    expect(organizationHasCapability({ capabilities: { cloud: true } }, "cloud")).toBe(true)
    expect(organizationHasCapability({ capabilities: { orgProviderSync: true } }, "orgProviderSync")).toBe(true)
    expect(organizationHasCapability(JSON.stringify({ capabilities: { installLinks: true } }), "installLinks")).toBe(true)
    expect(organizationHasCapability(JSON.stringify({ capabilities: { mcpConnections: true } }), "mcpConnections")).toBe(true)
    expect(organizationHasCapability(JSON.stringify({ capabilities: { cloud: true } }), "cloud")).toBe(true)
    expect(organizationHasCapability(JSON.stringify({ capabilities: { orgProviderSync: true } }), "orgProviderSync")).toBe(true)
  })
})
