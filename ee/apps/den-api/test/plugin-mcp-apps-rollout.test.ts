import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const denApiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function probe(script: string, env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, ["--conditions", "development", "--eval", script], {
    cwd: denApiRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      TMPDIR: process.env.TMPDIR ?? "",
      DATABASE_URL: "mysql://root:password@127.0.0.1:3306/openwork_test",
      DB_MODE: "mysql",
      DEN_DB_ENCRYPTION_KEY: "x".repeat(32),
      BETTER_AUTH_SECRET: "y".repeat(32),
      BETTER_AUTH_URL: "https://den.openwork.test",
      OPENWORK_DEV_MODE: "0",
      PROVISIONER_MODE: "stub",
      ...Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    },
  })
}

function probeDeploymentGate(value?: string) {
  return probe(`
    const { env } = await import("./src/env.ts")
    console.log(JSON.stringify(env.pluginMcpAppsEnabled))
  `, { DEN_PLUGIN_MCP_APPS_ENABLED: value })
}

function probeEffectiveGates(env: Record<string, string | undefined>, organizationCapabilities: Record<string, boolean>) {
  return probe(`
    const { env } = await import("./src/env.ts")
    const { pluginInstalledMcpAppsEnabled } = await import("./src/capability-sources/plugin-mcp-apps-rollout.ts")
    const { remoteMcpAppsEnabled } = await import("./src/capability-sources/remote-mcp-apps-rollout.ts")
    const metadata = { capabilities: ${JSON.stringify(organizationCapabilities)} }
    console.log(JSON.stringify({
      installed: pluginInstalledMcpAppsEnabled(metadata, { deploymentEnabled: env.pluginMcpAppsEnabled }),
      native: remoteMcpAppsEnabled(metadata, { deploymentEnabled: env.remoteMcpAppsEnabled }),
    }))
  `, env)
}

test("the plugin-installed MCP App deployment gate defaults off and requires an explicit true", () => {
  const unset = probeDeploymentGate()
  const disabled = probeDeploymentGate("false")
  const enabled = probeDeploymentGate("true")

  expect(unset.status).toBe(0)
  expect(unset.stdout.trim()).toBe("false")
  expect(disabled.status).toBe(0)
  expect(disabled.stdout.trim()).toBe("false")
  expect(enabled.status).toBe(0)
  expect(enabled.stdout.trim()).toBe("true")
})

test("the installed-App gate needs both deployment and organization opt-ins and stays independent from the native MCP App gate", () => {
  // Nothing set: both units stay off.
  const allOff = probeEffectiveGates({}, {})
  expect(allOff.status).toBe(0)
  expect(JSON.parse(allOff.stdout)).toEqual({ installed: false, native: false })

  // Deployment opt-in without the organization capability fails closed.
  const deploymentOnly = probeEffectiveGates({ DEN_PLUGIN_MCP_APPS_ENABLED: "true" }, {})
  expect(JSON.parse(deploymentOnly.stdout)).toEqual({ installed: false, native: false })

  // Organization capability without the deployment opt-in fails closed.
  const organizationOnly = probeEffectiveGates({}, { pluginMcpApps: true })
  expect(JSON.parse(organizationOnly.stdout)).toEqual({ installed: false, native: false })

  // The native gate never leaks into the installed-App unit, and vice versa.
  const nativeOnlyEverything = probeEffectiveGates(
    { DEN_REMOTE_MCP_APPS_ENABLED: "true", DEN_PLUGIN_MCP_APPS_ENABLED: "true" },
    { remoteMcpApps: true },
  )
  expect(JSON.parse(nativeOnlyEverything.stdout)).toEqual({ installed: false, native: true })

  const installedOnlyEverything = probeEffectiveGates(
    { DEN_REMOTE_MCP_APPS_ENABLED: "true", DEN_PLUGIN_MCP_APPS_ENABLED: "true" },
    { pluginMcpApps: true },
  )
  expect(JSON.parse(installedOnlyEverything.stdout)).toEqual({ installed: true, native: false })

  const bothEnabled = probeEffectiveGates(
    { DEN_REMOTE_MCP_APPS_ENABLED: "true", DEN_PLUGIN_MCP_APPS_ENABLED: "true" },
    { pluginMcpApps: true, remoteMcpApps: true },
  )
  expect(JSON.parse(bothEnabled.stdout)).toEqual({ installed: true, native: true })
})
