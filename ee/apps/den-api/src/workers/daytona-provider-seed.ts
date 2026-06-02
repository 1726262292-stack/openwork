export type DaytonaLlmProviderSeedSource = {
  providerId: string
  providerConfig: Record<string, unknown>
  apiKey: string | null
}

export type DaytonaProviderSeed = {
  provider: Record<string, Record<string, unknown>>
  env: Record<string, string>
}

const shellEnvNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function providerEnvNames(providerConfig: Record<string, unknown>) {
  const env = providerConfig.env
  if (!Array.isArray(env)) {
    return []
  }

  return env.filter((value): value is string => (
    typeof value === "string" && shellEnvNamePattern.test(value)
  ))
}

export function buildDaytonaProviderSeed(providers: DaytonaLlmProviderSeedSource[]) {
  const seed: DaytonaProviderSeed = {
    provider: {},
    env: {},
  }

  for (const provider of providers) {
    const providerId = provider.providerId.trim()
    if (!providerId) {
      continue
    }

    seed.provider[providerId] = provider.providerConfig

    if (!provider.apiKey) {
      continue
    }

    for (const envName of providerEnvNames(provider.providerConfig)) {
      seed.env[envName] = provider.apiKey
    }
  }

  if (Object.keys(seed.provider).length === 0) {
    return null
  }

  return seed
}

export function buildShellEnvAssignments(env: Record<string, string>) {
  return Object.entries(env)
    .filter(([key]) => shellEnvNamePattern.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ` ${key}=${shellQuote(value)}`)
    .join("")
}

export function buildDaytonaProviderSeedScript(input: {
  configPath: string
  seed: DaytonaProviderSeed | null
}) {
  if (!input.seed) {
    return ""
  }

  const configPayload = Buffer.from(JSON.stringify({ provider: input.seed.provider })).toString("base64")
  const script = [
    'const fs = require("node:fs")',
    'const path = require("node:path")',
    'const target = process.argv[1]',
    'const raw = Buffer.from(process.env.OPENWORK_DAYTONA_PROVIDER_CONFIG_B64 || "", "base64").toString("utf8")',
    'const seed = JSON.parse(raw)',
    'fs.mkdirSync(path.dirname(target), { recursive: true })',
    'let existing = {}',
    'if (fs.existsSync(target)) {',
    '  try { existing = JSON.parse(fs.readFileSync(target, "utf8")) } catch {}',
    '}',
    'const existingProvider = existing.provider && typeof existing.provider === "object" && !Array.isArray(existing.provider) ? existing.provider : {}',
    'const next = { ...existing, provider: { ...existingProvider, ...seed.provider } }',
    'fs.writeFileSync(target, JSON.stringify(next, null, 2) + "\\n")',
  ].join("; ")

  return [
    `OPENWORK_DAYTONA_PROVIDER_CONFIG_B64=${shellQuote(configPayload)} node -e ${shellQuote(script)} ${shellQuote(input.configPath)}`,
  ].join("\n")
}
