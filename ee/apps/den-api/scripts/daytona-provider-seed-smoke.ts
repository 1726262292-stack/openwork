import { Daytona } from "@daytonaio/sdk"
import {
  buildDaytonaProviderSeed,
  buildDaytonaProviderSeedScript,
  buildShellEnvAssignments,
  shellQuote,
} from "../src/workers/daytona-provider-seed.js"

function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function optionalEnv(name: string, fallback: string) {
  const value = process.env[name]?.trim()
  return value ? value : fallback
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

async function main() {
  const apiKey = requiredEnv("DAYTONA_API_KEY")
  const apiUrl = optionalEnv("DAYTONA_API_URL", "https://app.daytona.io/api")
  const target = process.env.DAYTONA_TARGET?.trim()
  const snapshot = process.env.DAYTONA_SNAPSHOT?.trim()
  const image = optionalEnv("DAYTONA_SANDBOX_IMAGE", "node:22-bookworm-slim")
  const createTimeoutSeconds = Number(process.env.DAYTONA_CREATE_TIMEOUT_SECONDS ?? "300")
  const deleteTimeoutSeconds = Number(process.env.DAYTONA_DELETE_TIMEOUT_SECONDS ?? "120")
  const commandTimeoutSeconds = Number(process.env.DAYTONA_SMOKE_COMMAND_TIMEOUT_SECONDS ?? "120")
  const name = slug(`den-provider-seed-smoke-${Date.now().toString(36)}`).slice(0, 63)

  const daytona = new Daytona({
    apiKey,
    apiUrl,
    ...(target ? { target } : {}),
  })

  const common = {
    name,
    public: false,
    autoStopInterval: 0,
    autoArchiveInterval: 0,
    autoDeleteInterval: 0,
    ephemeral: true,
    labels: {
      "openwork.den.provider": "daytona",
      "openwork.den.type": "provider-seed-smoke",
    },
    envVars: {
      DEN_RUNTIME_PROVIDER: "daytona-provider-seed-smoke",
    },
    resources: {
      cpu: 1,
      memory: 1,
      disk: 4,
    },
  }

  const sandbox = await daytona.create(
    snapshot ? { ...common, snapshot } : { ...common, image },
    { timeout: createTimeoutSeconds },
  )

  try {
    const smokeKey = "ow_inf_smoke_key"
    const seed = buildDaytonaProviderSeed([
      {
        providerId: "openwork",
        providerConfig: {
          id: "openwork",
          name: "OpenWork",
          npm: "@openrouter/ai-sdk-provider",
          env: ["OPENWORK_API_KEY"],
          api: "https://inference.openwork.test/api/v1",
          options: {
            baseURL: "https://inference.openwork.test/api/v1",
          },
        },
        apiKey: smokeKey,
      },
    ])

    const configPath = "/tmp/openwork-daytona-provider-seed/opencode.jsonc"
    const validateConfigScript = [
      'const fs = require("node:fs")',
      'const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))',
      'if (!config.provider || !config.provider.openwork) throw new Error("openwork_provider_missing")',
      `if (JSON.stringify(config).includes(${JSON.stringify(smokeKey)})) throw new Error("api_key_written_to_config")`,
    ].join("; ")
    const validateEnvScript = `if (process.env.OPENWORK_API_KEY !== ${JSON.stringify(smokeKey)}) throw new Error("openwork_api_key_env_missing")`
    const commandScript = [
      "set -eu",
      buildDaytonaProviderSeedScript({ configPath, seed }),
      `node -e ${shellQuote(validateConfigScript)} ${shellQuote(configPath)}`,
      `${buildShellEnvAssignments(seed?.env ?? {})} node -e ${shellQuote(validateEnvScript)}`,
      "command -v opencode >/dev/null 2>&1 || { echo 'opencode missing; set DAYTONA_SNAPSHOT to the OpenWork runtime snapshot' >&2; exit 2; }",
      "opencode --version",
    ].join("\n")

    const result = await sandbox.process.executeCommand(
      `sh -lc ${shellQuote(commandScript)}`,
      undefined,
      undefined,
      commandTimeoutSeconds,
    )

    if (result.exitCode !== 0) {
      throw new Error(result.result?.trim() || `smoke command exited with ${result.exitCode}`)
    }

    console.log(JSON.stringify({ ok: true, sandboxId: sandbox.id, output: result.result?.trim() ?? "" }, null, 2))
  } finally {
    await sandbox.delete(deleteTimeoutSeconds).catch((error) => {
      const message = error instanceof Error ? error.message : "unknown_error"
      console.warn(`[daytona-smoke] failed to delete sandbox ${sandbox.id}: ${message}`)
    })
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown_error"
  console.error(message)
  process.exit(1)
})
