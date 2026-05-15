type GithubDiscoveryTreeEntryKind = "blob" | "tree"

export type GithubDiscoveryTreeEntry = {
  id: string
  kind: GithubDiscoveryTreeEntryKind
  path: string
  sha: string | null
  size: number | null
}

export type GithubPluginStandard = "claude" | "openai"

export type GithubDiscoveryClassification =
  | "marketplace_repo"
  | "multi_plugin_repo"
  | "single_plugin_repo"
  | "folder_inferred_repo"
  | "unsupported"

export type GithubDiscoveredPluginSourceKind =
  | "marketplace_entry"
  | "plugin_manifest"
  | "standalone_claude"
  | "folder_inference"

export type GithubDiscoveredPluginComponentKind =
  | "skill"
  | "command"
  | "agent"
  | "hook"
  | "mcp_server"
  | "lsp_server"
  | "monitor"
  | "settings"

export type GithubDiscoveredPlugin = {
  componentKinds: GithubDiscoveredPluginComponentKind[]
  componentPaths: {
    agents: string[]
    commands: string[]
    hooks: string[]
    lspServers: string[]
    mcpServers: string[]
    monitors: string[]
    settings: string[]
    skills: string[]
  }
  description: string | null
  displayName: string
  key: string
  manifestPath: string | null
  metadata: Record<string, unknown>
  rootPath: string
  selectedByDefault: boolean
  sourceKind: GithubDiscoveredPluginSourceKind
  standard: GithubPluginStandard
  supported: boolean
  warnings: string[]
}

export type GithubMarketplaceInfo = {
  description: string | null
  name: string | null
  owner: string | null
  standard: GithubPluginStandard
  version: string | null
}

export type GithubRepoDiscoveryResult = {
  classification: GithubDiscoveryClassification
  discoveredPlugins: GithubDiscoveredPlugin[]
  marketplace: GithubMarketplaceInfo | null
  warnings: string[]
}

type MarketplaceEntry = {
  agents?: unknown
  commands?: unknown
  description?: unknown
  hooks?: unknown
  mcpServers?: unknown
  name?: unknown
  settings?: unknown
  skills?: unknown
  source?: unknown
}

type PluginMetadata = {
  description: string | null
  displayName: string | null
  metadata: Record<string, unknown>
  name: string | null
}

type ComponentBucket = keyof GithubDiscoveredPlugin["componentPaths"]

type GithubDiscoveryStandardDefinition = {
  defaultComponentCandidates: (rootPath: string) => Array<{ bucket: ComponentBucket; kind: "directory" | "file"; path: string }>
  fallbackMetadataPath?: (rootPath: string) => string | null
  id: GithubPluginStandard
  label: string
  marketplaceManifestPath: string
  pluginManifestPath: string
}

const KNOWN_COMPONENT_SEGMENTS = ["skills", "commands", "agents"] as const

const DISCOVERY_STANDARDS = [
  {
    defaultComponentCandidates: (rootPath) => [
      { bucket: "skills", kind: "directory", path: joinPath(rootPath, "skills") },
      { bucket: "skills", kind: "directory", path: joinPath(rootPath, ".claude/skills") },
      { bucket: "commands", kind: "directory", path: joinPath(rootPath, "commands") },
      { bucket: "commands", kind: "directory", path: joinPath(rootPath, ".claude/commands") },
      { bucket: "agents", kind: "directory", path: joinPath(rootPath, "agents") },
      { bucket: "agents", kind: "directory", path: joinPath(rootPath, ".claude/agents") },
      { bucket: "hooks", kind: "file", path: joinPath(rootPath, "hooks/hooks.json") },
      { bucket: "mcpServers", kind: "file", path: joinPath(rootPath, ".mcp.json") },
      { bucket: "lspServers", kind: "file", path: joinPath(rootPath, ".lsp.json") },
      { bucket: "monitors", kind: "file", path: joinPath(rootPath, "monitors/monitors.json") },
      { bucket: "settings", kind: "file", path: joinPath(rootPath, "settings.json") },
    ],
    fallbackMetadataPath: (rootPath) => joinPath(rootPath, "plugin.json"),
    id: "claude",
    label: "Claude",
    marketplaceManifestPath: ".claude-plugin/marketplace.json",
    pluginManifestPath: ".claude-plugin/plugin.json",
  },
  {
    defaultComponentCandidates: (rootPath) => [
      { bucket: "skills", kind: "directory", path: joinPath(rootPath, "skills") },
      { bucket: "mcpServers", kind: "file", path: joinPath(rootPath, ".mcp.json") },
    ],
    id: "openai",
    label: "OpenAI",
    marketplaceManifestPath: ".agents/plugins/marketplace.json",
    pluginManifestPath: ".codex-plugin/plugin.json",
  },
] satisfies GithubDiscoveryStandardDefinition[]

function normalizePath(value: string) {
  return value.trim().replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "")
}

function joinPath(rootPath: string, childPath: string) {
  const root = normalizePath(rootPath)
  const child = normalizePath(childPath)
  if (!root) return child
  if (!child) return root
  return `${root}/${child}`
}

function basename(path: string) {
  const normalized = normalizePath(path)
  if (!normalized) return null
  const parts = normalized.split("/")
  return parts[parts.length - 1] ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function pathDirectoryPrefixes(path: string) {
  const segments = normalizePath(path).split("/").filter(Boolean)
  const prefixes: string[] = []
  for (let index = 1; index <= segments.length; index += 1) {
    prefixes.push(segments.slice(0, index).join("/"))
  }
  return prefixes
}

function buildPathSet(entries: GithubDiscoveryTreeEntry[]) {
  const knownPaths = new Set<string>()
  for (const entry of entries) {
    const normalizedPath = normalizePath(entry.path)
    if (!normalizedPath) continue
    knownPaths.add(normalizedPath)
    for (const prefix of pathDirectoryPrefixes(normalizedPath)) {
      knownPaths.add(prefix)
    }
  }
  return knownPaths
}

function hasPath(knownPaths: Set<string>, path: string) {
  const normalized = normalizePath(path)
  return normalized.length > 0 && knownPaths.has(normalized)
}

function hasDescendant(knownPaths: Set<string>, path: string) {
  const normalized = normalizePath(path)
  if (!normalized) return false
  for (const candidate of knownPaths) {
    if (candidate === normalized || candidate.startsWith(`${normalized}/`)) {
      return true
    }
  }
  return false
}

function readJsonMap(fileTextByPath: Record<string, string | null | undefined>, path: string) {
  const text = fileTextByPath[normalizePath(path)]
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function readPluginMetadataFromManifest(manifest: Record<string, unknown>): PluginMetadata {
  const interfaceMetadata = isRecord(manifest.interface) ? manifest.interface : null
  return {
    description: asString(interfaceMetadata?.shortDescription)
      ?? asString(interfaceMetadata?.longDescription)
      ?? asString(manifest.description),
    displayName: asString(interfaceMetadata?.displayName) ?? asString(manifest.name),
    metadata: manifest,
    name: asString(manifest.name),
  }
}

function readPluginMetadata(
  fileTextByPath: Record<string, string | null | undefined>,
  rootPath: string,
  standard: GithubPluginStandard,
  manifestPath?: string | null,
): PluginMetadata {
  const definition = DISCOVERY_STANDARDS.find((entry) => entry.id === standard)
  const manifestCandidate = manifestPath
    ? normalizePath(manifestPath)
    : normalizePath(joinPath(rootPath, definition?.pluginManifestPath ?? ""))
  const explicitManifest = manifestCandidate ? readJsonMap(fileTextByPath, manifestCandidate) : null
  if (isRecord(explicitManifest)) {
    return readPluginMetadataFromManifest(explicitManifest)
  }

  const fallbackPath = definition?.fallbackMetadataPath?.(rootPath)
  const fallbackPluginJson = fallbackPath ? readJsonMap(fileTextByPath, fallbackPath) : null
  if (isRecord(fallbackPluginJson)) {
    return readPluginMetadataFromManifest(fallbackPluginJson)
  }

  return {
    description: null,
    displayName: null,
    metadata: {},
    name: null,
  }
}

function collectComponentPaths(knownPaths: Set<string>, rootPath: string, standard: GithubPluginStandard) {
  const componentPaths = {
    agents: [] as string[],
    commands: [] as string[],
    hooks: [] as string[],
    lspServers: [] as string[],
    mcpServers: [] as string[],
    monitors: [] as string[],
    settings: [] as string[],
    skills: [] as string[],
  }

  const definition = DISCOVERY_STANDARDS.find((entry) => entry.id === standard)
  const candidates = definition?.defaultComponentCandidates(rootPath) ?? []

  for (const candidate of candidates) {
    if (!candidate.path) continue
    const matches = candidate.kind === "directory"
      ? hasDescendant(knownPaths, candidate.path)
      : hasPath(knownPaths, candidate.path)
    if (matches) {
      componentPaths[candidate.bucket].push(candidate.path)
    }
  }

  return componentPaths
}

function readPathArray(value: unknown) {
  if (typeof value === "string") {
    const normalized = asString(value)
    return normalized ? [normalized] : []
  }

  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const normalized = asString(entry)
        return normalized ? [normalized] : []
      })
    : []
}

function resolveDeclaredPaths(input: {
  knownPaths: Set<string>
  rootPath: string
  values: unknown
} & { directory?: boolean; file?: boolean }) {
  const paths: string[] = []
  for (const value of readPathArray(input.values)) {
    const candidate = joinPath(input.rootPath, value)
    if (!candidate && !input.rootPath) {
      continue
    }
    if ((input.directory && hasDescendant(input.knownPaths, candidate)) || (input.file && hasPath(input.knownPaths, candidate))) {
      paths.push(candidate)
    }
  }
  return paths
}

function declaredComponentPaths(input: {
  declared: Partial<Record<keyof GithubDiscoveredPlugin["componentPaths"], unknown>>
  knownPaths: Set<string>
  rootPath: string
}) {
  return {
    agents: resolveDeclaredPaths({ directory: true, knownPaths: input.knownPaths, rootPath: input.rootPath, values: input.declared.agents }),
    commands: resolveDeclaredPaths({ directory: true, knownPaths: input.knownPaths, rootPath: input.rootPath, values: input.declared.commands }),
    hooks: resolveDeclaredPaths({ directory: true, file: true, knownPaths: input.knownPaths, rootPath: input.rootPath, values: input.declared.hooks }),
    lspServers: [],
    mcpServers: resolveDeclaredPaths({ file: true, knownPaths: input.knownPaths, rootPath: input.rootPath, values: input.declared.mcpServers }),
    monitors: [],
    settings: resolveDeclaredPaths({ file: true, knownPaths: input.knownPaths, rootPath: input.rootPath, values: input.declared.settings }),
    skills: resolveDeclaredPaths({ directory: true, knownPaths: input.knownPaths, rootPath: input.rootPath, values: input.declared.skills }),
  } satisfies GithubDiscoveredPlugin["componentPaths"]
}

function marketplaceComponentPaths(entry: MarketplaceEntry, knownPaths: Set<string>, rootPath: string) {
  return declaredComponentPaths({
    declared: {
      agents: entry.agents,
      commands: entry.commands,
      hooks: entry.hooks,
      mcpServers: entry.mcpServers,
      settings: entry.settings,
      skills: entry.skills,
    },
    knownPaths,
    rootPath,
  })
}

function hasAnyComponentPaths(componentPaths: GithubDiscoveredPlugin["componentPaths"]) {
  return Object.values(componentPaths).some((paths) => paths.length > 0)
}

function componentKindsFromPaths(componentPaths: GithubDiscoveredPlugin["componentPaths"]): GithubDiscoveredPluginComponentKind[] {
  const kinds: GithubDiscoveredPluginComponentKind[] = []
  if (componentPaths.skills.length > 0) kinds.push("skill")
  if (componentPaths.commands.length > 0) kinds.push("command")
  if (componentPaths.agents.length > 0) kinds.push("agent")
  if (componentPaths.hooks.length > 0) kinds.push("hook")
  if (componentPaths.mcpServers.length > 0) kinds.push("mcp_server")
  if (componentPaths.lspServers.length > 0) kinds.push("lsp_server")
  if (componentPaths.monitors.length > 0) kinds.push("monitor")
  if (componentPaths.settings.length > 0) kinds.push("settings")
  return kinds
}

function pluginManifestWarnings(input: {
  knownPaths: Set<string>
  metadata: PluginMetadata
  rootPath: string
  standard: GithubPluginStandard
}) {
  if (input.standard !== "openai") {
    return []
  }

  const appPaths = resolveDeclaredPaths({
    file: true,
    knownPaths: input.knownPaths,
    rootPath: input.rootPath,
    values: input.metadata.metadata.apps,
  })
  if (appPaths.length === 0) {
    return []
  }

  return [
    appPaths.length === 1
      ? `OpenAI app bundle ${appPaths[0]} is not imported yet. OpenWork will import the plugin's skills and MCP servers only.`
      : "OpenAI app bundles are not imported yet. OpenWork will import the plugin's skills and MCP servers only.",
  ]
}

function buildDiscoveredPlugin(input: {
  componentPathsOverride?: GithubDiscoveredPlugin["componentPaths"] | null
  description?: string | null
  displayName?: string | null
  fileTextByPath: Record<string, string | null | undefined>
  key: string
  knownPaths: Set<string>
  manifestPath?: string | null
  rootPath: string
  sourceKind: GithubDiscoveredPluginSourceKind
  standard: GithubPluginStandard
  supported?: boolean
  warnings?: string[]
}) {
  const metadata = readPluginMetadata(input.fileTextByPath, input.rootPath, input.standard, input.manifestPath)
  const manifestDeclaredPaths = declaredComponentPaths({
    declared: metadata.metadata,
    knownPaths: input.knownPaths,
    rootPath: input.rootPath,
  })
  const componentPaths = input.componentPathsOverride
    ?? (hasAnyComponentPaths(manifestDeclaredPaths) ? manifestDeclaredPaths : collectComponentPaths(input.knownPaths, input.rootPath, input.standard))
  const displayName = metadata.displayName
    || input.displayName?.trim()
    || metadata.name
    || basename(input.rootPath)
    || "Repository plugin"
  const derivedWarnings = pluginManifestWarnings({
    knownPaths: input.knownPaths,
    metadata,
    rootPath: input.rootPath,
    standard: input.standard,
  })
  const warnings = [...(input.warnings ?? []), ...derivedWarnings]
  const supported = input.supported === false
    ? false
    : !(warnings.length > 0 && !hasAnyComponentPaths(componentPaths))

  return {
    componentKinds: componentKindsFromPaths(componentPaths),
    componentPaths,
    description: input.description ?? metadata.description,
    displayName,
    key: input.key,
    manifestPath: input.manifestPath
      ? normalizePath(input.manifestPath)
      : (hasPath(input.knownPaths, joinPath(input.rootPath, discoveryDefinition(input.standard).pluginManifestPath))
          ? joinPath(input.rootPath, discoveryDefinition(input.standard).pluginManifestPath)
          : null),
    metadata: metadata.metadata,
    rootPath: normalizePath(input.rootPath),
    selectedByDefault: supported,
    sourceKind: input.sourceKind,
    standard: input.standard,
    supported,
    warnings,
  } satisfies GithubDiscoveredPlugin
}

function discoveryDefinition(standard: GithubPluginStandard) {
  return DISCOVERY_STANDARDS.find((entry) => entry.id === standard) ?? DISCOVERY_STANDARDS[0]
}

function localMarketplaceRoot(entry: MarketplaceEntry) {
  if (typeof entry.source === "string") {
    return normalizePath(entry.source)
  }

  if (!isRecord(entry.source)) {
    return null
  }

  const sourceType = asString(entry.source.source)
  if (sourceType && sourceType !== "local") {
    return null
  }

  if (typeof entry.source.url === "string") {
    return null
  }

  const localPath = asString(entry.source.path)
  return localPath ? normalizePath(localPath) : null
}

function pluginRootFromManifestPath(path: string, standard: GithubPluginStandard) {
  const normalizedPath = normalizePath(path)
  const pluginManifestPath = discoveryDefinition(standard).pluginManifestPath
  if (normalizedPath === pluginManifestPath) {
    return ""
  }

  const suffix = `/${pluginManifestPath}`
  return normalizedPath.endsWith(suffix) ? normalizedPath.slice(0, -suffix.length) : null
}

function pluginRootsFromManifests(entries: GithubDiscoveryTreeEntry[], standard: GithubPluginStandard) {
  return entries
    .map((entry) => pluginRootFromManifestPath(entry.path, standard))
    .filter((path): path is string => path !== null)
}

function inferredRootsFromKnownFolders(entries: GithubDiscoveryTreeEntry[]) {
  const inferred = new Set<string>()
  for (const entry of entries) {
    const normalized = normalizePath(entry.path)
    if (!normalized) continue
    const segments = normalized.split("/")
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      if (!KNOWN_COMPONENT_SEGMENTS.includes(segment as (typeof KNOWN_COMPONENT_SEGMENTS)[number])) {
        continue
      }
      const rootSegments = segments.slice(0, index)
      if (rootSegments.length === 1 && rootSegments[0] === ".claude") {
        inferred.add("")
        continue
      }
      inferred.add(rootSegments.join("/"))
      break
    }
  }
  return [...inferred]
}

function marketplaceInfoFromManifest(manifest: Record<string, unknown>, standard: GithubPluginStandard): GithubMarketplaceInfo {
  const interfaceMetadata = isRecord(manifest.interface) ? manifest.interface : null
  return {
    description: asString(manifest.description)
      ?? asString(interfaceMetadata?.shortDescription)
      ?? asString(interfaceMetadata?.longDescription),
    name: asString(interfaceMetadata?.displayName) ?? asString(manifest.name),
    owner: isRecord(manifest.owner)
      ? asString(manifest.owner.name) ?? asString(manifest.owner.login) ?? asString(manifest.owner)
      : asString(manifest.owner),
    standard,
    version: asString(manifest.version),
  }
}

function supportedManifestWarning() {
  return "OpenWork currently supports Claude and OpenAI plugins and marketplaces. Add `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, `.agents/plugins/marketplace.json`, or `.codex-plugin/plugin.json` to this repository."
}

export function buildGithubRepoDiscovery(input: {
  entries: GithubDiscoveryTreeEntry[]
  fileTextByPath: Record<string, string | null | undefined>
}) {
  const knownPaths = buildPathSet(input.entries)
  const warnings: string[] = []

  const marketplaceDefinitions = DISCOVERY_STANDARDS.filter((definition) => hasPath(knownPaths, definition.marketplaceManifestPath))
  if (marketplaceDefinitions.length > 0) {
    const definition = marketplaceDefinitions[0]
    if (marketplaceDefinitions.length > 1) {
      warnings.push(`Multiple marketplace manifests were detected. OpenWork is using the ${definition.label} marketplace manifest at ${definition.marketplaceManifestPath}.`)
    }

    const marketplaceJson = readJsonMap(input.fileTextByPath, definition.marketplaceManifestPath)
    const marketplaceEntries = isRecord(marketplaceJson) && Array.isArray(marketplaceJson.plugins)
      ? marketplaceJson.plugins.filter(isRecord) as MarketplaceEntry[]
      : []

    const marketplaceInfo = isRecord(marketplaceJson)
      ? marketplaceInfoFromManifest(marketplaceJson, definition.id)
      : {
          description: null,
          name: null,
          owner: null,
          standard: definition.id,
          version: null,
        } satisfies GithubMarketplaceInfo

    const discoveredPlugins = marketplaceEntries.map((entry, index) => {
      const rootPath = localMarketplaceRoot(entry)
      if (rootPath === null) {
        const warning = "Marketplace entry points at an external source and cannot be auto-mapped from this connected repo yet."
        warnings.push(warning)
        return buildDiscoveredPlugin({
          description: asString(entry.description),
          displayName: asString(entry.name) ?? `Marketplace plugin ${index + 1}`,
          fileTextByPath: input.fileTextByPath,
          key: `${definition.id}:marketplace:${asString(entry.name) ?? index}`,
          knownPaths,
          manifestPath: null,
          rootPath: "",
          sourceKind: "marketplace_entry",
          standard: definition.id,
          supported: false,
          warnings: [warning],
        })
      }

      return buildDiscoveredPlugin({
        componentPathsOverride: (() => {
          const override = marketplaceComponentPaths(entry, knownPaths, rootPath)
          return hasAnyComponentPaths(override) ? override : null
        })(),
        description: asString(entry.description),
        displayName: asString(entry.name),
        fileTextByPath: input.fileTextByPath,
        key: `${definition.id}:marketplace:${rootPath}`,
        knownPaths,
        manifestPath: joinPath(rootPath, definition.pluginManifestPath),
        rootPath,
        sourceKind: "marketplace_entry",
        standard: definition.id,
      })
    })

    return {
      classification: "marketplace_repo",
      discoveredPlugins,
      marketplace: marketplaceInfo,
      warnings,
    } satisfies GithubRepoDiscoveryResult
  }

  const manifestPlugins = [...new Map(
    DISCOVERY_STANDARDS.flatMap((definition) => pluginRootsFromManifests(input.entries, definition.id).map((rootPath) => [
      `${definition.id}:${rootPath}`,
      { rootPath, standard: definition.id },
    ]))
  ).values()]

  if (manifestPlugins.length > 0) {
    if (new Set(manifestPlugins.map((entry) => entry.standard)).size > 1) {
      warnings.push("Multiple plugin standards were detected. OpenWork will import supported manifests from each standard.")
    }

    const discoveredPlugins = manifestPlugins.map(({ rootPath, standard }) => buildDiscoveredPlugin({
      fileTextByPath: input.fileTextByPath,
      key: `${standard}:manifest:${rootPath || "root"}`,
      knownPaths,
      manifestPath: joinPath(rootPath, discoveryDefinition(standard).pluginManifestPath),
      rootPath,
      sourceKind: "plugin_manifest",
      standard,
    }))

    return {
      classification: manifestPlugins.length === 1 ? "single_plugin_repo" : "multi_plugin_repo",
      discoveredPlugins,
      marketplace: null,
      warnings,
    } satisfies GithubRepoDiscoveryResult
  }

  // Intentionally disabled for now: directory-based inference can over-classify
  // arbitrary repos as plugins. Until we support a broader compatibility model,
  // discovery should only accept explicit marketplace or plugin manifests.
  // const inferredRoots = inferredRootsFromKnownFolders(input.entries)
  // const standaloneRoot = inferredRoots.includes("") && (
  //   hasDescendant(knownPaths, ".claude/skills")
  //   || hasDescendant(knownPaths, ".claude/commands")
  //   || hasDescendant(knownPaths, ".claude/agents")
  // )
  // const folderRoots = standaloneRoot ? inferredRoots : inferredRoots.filter((root) => root !== "")
  //
  // if (folderRoots.length > 0) {
  //   const discoveredPlugins = folderRoots.map((rootPath) => buildDiscoveredPlugin({
  //     fileTextByPath: input.fileTextByPath,
  //     key: `${standaloneRoot && rootPath === "" ? "standalone" : "folder"}:${rootPath || "root"}`,
  //     knownPaths,
  //     rootPath,
  //     sourceKind: standaloneRoot && rootPath === "" ? "standalone_claude" : "folder_inference",
  //     standard: "claude",
  //   }))
  //
  //   return {
  //     classification: "folder_inferred_repo",
  //     discoveredPlugins,
  //     marketplace: null,
  //     warnings,
  //   } satisfies GithubRepoDiscoveryResult
  // }
  void inferredRootsFromKnownFolders

  warnings.push(supportedManifestWarning())

  return {
    classification: "unsupported",
    discoveredPlugins: [],
    marketplace: null,
    warnings,
  } satisfies GithubRepoDiscoveryResult
}
