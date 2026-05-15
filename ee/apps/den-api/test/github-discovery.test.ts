import { describe, expect, test } from "bun:test"
import { buildGithubRepoDiscovery, type GithubDiscoveryTreeEntry } from "../src/routes/org/plugin-system/github-discovery.js"

function blob(path: string): GithubDiscoveryTreeEntry {
  return { id: path, kind: "blob", path, sha: null, size: null }
}

describe("github discovery", () => {
  test("classifies Claude marketplace repos and resolves local plugin roots", () => {
    const result = buildGithubRepoDiscovery({
      entries: [
        blob(".claude-plugin/marketplace.json"),
        blob("plugins/sales/.claude-plugin/plugin.json"),
        blob("plugins/sales/skills/hello/SKILL.md"),
        blob("plugins/sales/commands/deploy.md"),
      ],
      fileTextByPath: {
        ".claude-plugin/marketplace.json": JSON.stringify({
          plugins: [
            { name: "sales", description: "Sales workflows", source: "./plugins/sales" },
          ],
        }),
        "plugins/sales/.claude-plugin/plugin.json": JSON.stringify({
          name: "sales",
          description: "Sales plugin",
        }),
      },
    })

    expect(result.classification).toBe("marketplace_repo")
    expect(result.discoveredPlugins).toHaveLength(1)
    expect(result.discoveredPlugins[0]).toMatchObject({
      displayName: "sales",
      rootPath: "plugins/sales",
      sourceKind: "marketplace_entry",
      standard: "claude",
    })
    expect(result.discoveredPlugins[0]?.componentPaths.skills).toEqual(["plugins/sales/skills"])
    expect(result.discoveredPlugins[0]?.componentPaths.commands).toEqual(["plugins/sales/commands"])
  })

  test("classifies OpenAI marketplace repos and resolves plugin manifests from local entries", () => {
    const result = buildGithubRepoDiscovery({
      entries: [
        blob(".agents/plugins/marketplace.json"),
        blob("plugins/research/.codex-plugin/plugin.json"),
        blob("plugins/research/skills/triage/SKILL.md"),
        blob("plugins/research/.mcp.json"),
      ],
      fileTextByPath: {
        ".agents/plugins/marketplace.json": JSON.stringify({
          name: "local-example-plugins",
          interface: { displayName: "Local Example Plugins" },
          plugins: [
            {
              name: "research-helper",
              source: {
                source: "local",
                path: "./plugins/research",
              },
              policy: {
                authentication: "ON_INSTALL",
                installation: "AVAILABLE",
              },
              category: "Productivity",
            },
          ],
        }),
        "plugins/research/.codex-plugin/plugin.json": JSON.stringify({
          name: "research-helper",
          version: "0.1.0",
          description: "Bundle reusable skills and app integrations.",
          skills: "./skills/",
          mcpServers: "./.mcp.json",
          interface: {
            displayName: "Research Helper",
            shortDescription: "Reusable skills and MCP servers",
          },
        }),
      },
    })

    expect(result.classification).toBe("marketplace_repo")
    expect(result.marketplace).toMatchObject({
      name: "Local Example Plugins",
      standard: "openai",
    })
    expect(result.discoveredPlugins).toHaveLength(1)
    expect(result.discoveredPlugins[0]).toMatchObject({
      displayName: "Research Helper",
      rootPath: "plugins/research",
      sourceKind: "marketplace_entry",
      standard: "openai",
    })
    expect(result.discoveredPlugins[0]?.componentPaths.skills).toEqual(["plugins/research/skills"])
    expect(result.discoveredPlugins[0]?.componentPaths.mcpServers).toEqual(["plugins/research/.mcp.json"])
  })

  test("treats marketplace source './' as the current repo root", () => {
    const result = buildGithubRepoDiscovery({
      entries: [
        blob(".claude-plugin/marketplace.json"),
        blob("skills/agent-browser/SKILL.md"),
        blob("skills/other-skill/SKILL.md"),
      ],
      fileTextByPath: {
        ".claude-plugin/marketplace.json": JSON.stringify({
          plugins: [
            {
              name: "agent-browser",
              description: "Automates browser interactions for web testing, form filling, screenshots, and data extraction",
              source: "./",
              strict: false,
              skills: ["./skills/agent-browser"],
              category: "development",
            },
          ],
        }),
      },
    })

    expect(result.classification).toBe("marketplace_repo")
    expect(result.warnings).toEqual([])
    expect(result.discoveredPlugins).toHaveLength(1)
    expect(result.discoveredPlugins[0]).toMatchObject({
      displayName: "agent-browser",
      rootPath: "",
      sourceKind: "marketplace_entry",
      standard: "claude",
      supported: true,
    })
    expect(result.discoveredPlugins[0]?.componentPaths.skills).toEqual(["skills/agent-browser"])
  })

  test("warns when an OpenAI plugin only exposes app bundles", () => {
    const result = buildGithubRepoDiscovery({
      entries: [
        blob(".codex-plugin/plugin.json"),
        blob(".app.json"),
      ],
      fileTextByPath: {
        ".codex-plugin/plugin.json": JSON.stringify({
          name: "app-only-plugin",
          apps: "./.app.json",
          interface: {
            displayName: "App Only Plugin",
          },
        }),
      },
    })

    expect(result.classification).toBe("single_plugin_repo")
    expect(result.discoveredPlugins).toHaveLength(1)
    expect(result.discoveredPlugins[0]).toMatchObject({
      displayName: "App Only Plugin",
      standard: "openai",
      supported: false,
    })
    expect(result.discoveredPlugins[0]?.warnings[0]).toContain("OpenAI app bundle")
  })

  test("treats folder-only repos as unsupported without supported manifests", () => {
    const result = buildGithubRepoDiscovery({
      entries: [
        blob("Sales/skills/pitch/SKILL.md"),
        blob("Sales/commands/release.md"),
        blob("finance/agents/reviewer.md"),
        blob("finance/commands/audit.md"),
      ],
      fileTextByPath: {
        "Sales/plugin.json": JSON.stringify({ name: "Sales", description: "Sales tools" }),
      },
    })

    expect(result.classification).toBe("unsupported")
    expect(result.discoveredPlugins).toEqual([])
    expect(result.warnings[0]).toContain("supports Claude and OpenAI plugins and marketplaces")
  })

  test("treats standalone .claude directories as unsupported without plugin manifests", () => {
    const result = buildGithubRepoDiscovery({
      entries: [
        blob(".claude/skills/research/SKILL.md"),
        blob(".claude/commands/publish.md"),
      ],
      fileTextByPath: {},
    })

    expect(result.classification).toBe("unsupported")
    expect(result.discoveredPlugins).toEqual([])
    expect(result.warnings[0]).toContain("supports Claude and OpenAI plugins and marketplaces")
  })
})
