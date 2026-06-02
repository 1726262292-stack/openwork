import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildDaytonaProviderSeed,
  buildDaytonaProviderSeedScript,
  buildShellEnvAssignments,
} from "../src/workers/daytona-provider-seed.js"

const openworkProviderConfig = {
  id: "openwork",
  name: "OpenWork",
  npm: "@openrouter/ai-sdk-provider",
  env: ["OPENWORK_API_KEY"],
  api: "https://inference.openwork.test/api/v1",
  options: {
    baseURL: "https://inference.openwork.test/api/v1",
  },
}

describe("Daytona provider seeding", () => {
  test("builds opencode provider config and env vars from accessible LLM providers", () => {
    const seed = buildDaytonaProviderSeed([
      {
        providerId: "openwork",
        providerConfig: openworkProviderConfig,
        apiKey: "ow_inf_test_key",
      },
    ])

    expect(seed?.provider.openwork).toEqual(openworkProviderConfig)
    expect(seed?.env.OPENWORK_API_KEY).toBe("ow_inf_test_key")
  })

  test("ignores unsafe env var names before rendering shell assignments", () => {
    const seed = buildDaytonaProviderSeed([
      {
        providerId: "custom",
        providerConfig: {
          env: ["SAFE_KEY", "BAD-NAME", "$(whoami)"],
        },
        apiKey: "secret",
      },
    ])

    expect(buildShellEnvAssignments(seed?.env ?? {})).toBe(" SAFE_KEY='secret'")
  })

  test("writes provider config without embedding provider API keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openwork-daytona-provider-seed-"))
    const configPath = join(dir, "opencode.jsonc")
    await writeFile(configPath, JSON.stringify({ theme: "dark", provider: { existing: { env: ["EXISTING_KEY"] } } }, null, 2), "utf8")

    const seed = buildDaytonaProviderSeed([
      {
        providerId: "openwork",
        providerConfig: openworkProviderConfig,
        apiKey: "ow_inf_should_not_be_written",
      },
    ])
    const script = buildDaytonaProviderSeedScript({ configPath, seed })

    expect(script).not.toContain("ow_inf_should_not_be_written")

    const proc = Bun.spawn(["sh", "-lc", script])
    expect(await proc.exited).toBe(0)

    const text = await readFile(configPath, "utf8")
    expect(text).toContain('"theme": "dark"')
    expect(text).toContain('"existing"')
    expect(text).toContain('"openwork"')
    expect(text).not.toContain("ow_inf_should_not_be_written")
  })
})
