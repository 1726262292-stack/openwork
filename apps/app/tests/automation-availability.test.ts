import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (relative: string) =>
  readFileSync(join(import.meta.dir, "..", relative), "utf8")

/**
 * Automations shipped out of preview: there is no per-device feature flag any
 * more. The control surface is available on desktop and web behind the live
 * Den availability probe. The execution bridge remains desktop-only.
 */
describe("Automations availability", () => {
  test("no preview feature flag remains in the local preferences", () => {
    const source = read("src/react-app/kernel/local-provider.tsx")
    expect(source).not.toContain("automations:")

    const flags = read("src/react-app/domains/settings/state/feature-flags-preferences.ts")
    expect(flags).not.toContain("automations")
  })

  test("the shell exposes the route and Den probe on desktop and web", () => {
    const source = read("src/react-app/shell/session-route.tsx")
    expect(source).not.toContain("featureFlags?.automations")
    expect(source).toContain("const automationsRouteActive = automationsRouteRequested")
    expect(source).not.toContain("navigate(\"/\", { replace: true })")
    expect(source).toContain("if (!denAuth.isSignedIn || !authToken || !organizationId)")
    expect(source).toContain("const automationsNavigationAvailable = automationsSupported")
  })

  test("the runner bridge registers on desktop without an opt-in", () => {
    const providers = read("src/react-app/shell/providers.tsx")
    expect(providers).toContain("<AutomationRunnerBridge enabled={isDesktopRuntime()} />")
    expect(providers).not.toContain("featureFlags")

    const bridge = read("src/react-app/domains/automations/automation-runner-bridge.tsx")
    expect(bridge).toContain("!enabled || status !== \"signed_in\"")
    expect(bridge).toContain("[enabled, status]")
    expect(bridge).toContain('automationRunnerConfigure", null')
  })

  test("the in-chat proposal tool only blocks on sign-in", () => {
    const proposal = read("src/components/tools/openwork-automation-proposal.tsx")
    expect(proposal).not.toContain("automationsEnabled")
    expect(proposal).toContain("Sign in to OpenWork Cloud")
    expect(proposal).toContain("resolveProposalModel")
    expect(proposal).toContain("data-automation-model-resolution")
  })

  test("the automations capability is discoverable on web and desktop", () => {
    const controls = read("src/react-app/shell/control/control-provider.tsx")
    expect(controls).toContain('{ id: "automations", label: "Automations"')
    expect(controls).not.toContain('...(isDesktopRuntime()\n            ? [{ id: "automations"')
  })
})
