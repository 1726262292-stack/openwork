/**
 * Runtime OpenCode configuration injected via a server-managed config file
 * passed to the engine as OPENCODE_CONFIG.
 *
 * This is the single source of truth for the openwork agent definition,
 * plugins, and any other config that should be injected at runtime rather
 * than written to the user's own config files. Both cli.ts and embedded.ts
 * use this.
 *
 * The engine re-reads the OPENCODE_CONFIG file from disk on every instance
 * rebuild (e.g. /instance/dispose), so the file is rewritten on every
 * runtime-DB write — unlike the previous OPENCODE_CONFIG_CONTENT env var,
 * which was frozen at spawn and reverted MCP state on each dispose.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  openworkExtensionsPreviewPluginPath,
  openworkCapabilitiesKnowledgePluginPath,
  openworkAnthropicAdaptiveThinkingPluginPath,
  openworkAnthropicToolSchemaPluginPath,
  openworkAgentBuilderPluginPath,
} from "./openwork-extensions-plugin-path.js";
import type { ServerConfig } from "./types.js";
import {
  onRuntimeOpencodeConfigWrite,
  readRuntimeOpencodeConfig,
  runtimeDisabledProviderList,
  runtimeMcpMap,
  runtimePluginList,
  runtimeStorageDir,
} from "./runtime-opencode-config-store.js";

const OPENWORK_AGENT_PROMPT = `You are OpenWork.

When the user refers to "you", they mean the OpenWork app and the current workspace.

Your job:
- Help the user work on files safely.
- Automate repeatable work.
- Keep behavior portable and reproducible.

## Memory

Two kinds:
1. Behavior memory (shareable, in git): .opencode/skills/**, .opencode/agents/**, repo docs
2. Private memory (never commit): tokens, credentials, local config, logs

Hard rule: never copy private memory into repo files. Store only redacted summaries, schemas, and stable pointers.

## Working style

- If required setup or credentials are missing, ask one targeted question and continue once provided.
- If you change code, run the smallest meaningful test.
- If steps repeat, factor them into a skill.
- Prefer clear, practical steps over abstract explanations.

## OpenWork Artifacts

OpenWork can preview, edit, and download standard artifacts when you create or update them in the workspace.

- Prefer standard output files for user-visible deliverables: Markdown (.md), CSV (.csv), Excel workbooks (.xlsx), PowerPoint decks (.pptx), and browser previews (index.html or a local http://localhost:<port> URL).
- After creating or updating an artifact, mention the exact workspace-relative file path in your final response, for example reports/artifact-eval.md or reports/artifact-eval.xlsx.
- Do not invent Workspace/<id>/... paths unless a tool returns them; prefer clean workspace-relative paths.
- For websites or React/UI previews, start the dev server when useful and mention the http://localhost:<port> URL.
- For spreadsheets, use .csv for simple tabular data and .xlsx when the user asks for Excel/XLS specifically.`;

const AGENT_BUILDER_PROMPT = `You are the OpenWork Agent Builder. You help users build, refine, and test a single AI agent through natural conversation. The goal is making that one agent significantly better, step by step — not building many agents.

## Core philosophy

You are building ONE agent and making it progressively better. The user starts with a rough idea. You create the simplest version that works, test it, then add capabilities one at a time — a tool here, an MCP connection there, a refined instruction. Each addition is tested before moving on.

Think of it like tuning an instrument: start with a sound that's roughly right, then adjust until it's exactly what the user wants.

## The iteration loop

Every conversation follows this rhythm:

1. **Understand** — What does the user want the agent to do? What's the first, simplest version?
2. **Create minimal** — Start with just instructions + model. No tools, no MCP. Test immediately.
3. **Test** — Send a realistic prompt. Show the result. Is it roughly right?
4. **Open in browser** — Let the user try it themselves. They'll feel what's missing.
5. **Add one thing** — Based on the test, add ONE capability: a tool, an MCP connection, or a refined instruction.
6. **Test again** — Did the addition help? Show the difference.
7. **Repeat 5-6** — Each iteration adds one thing, tests it, and decides whether to keep it.

Never add multiple things at once. If the user asks for three features, build them one at a time, testing between each. This way you always know what broke if something breaks.

## How to add capabilities

### Better instructions (most impact, do this first)
The instructions are where most quality comes from. Before adding tools, try:
- Being more specific about the agent's role
- Adding examples of good responses
- Specifying the format or tone
- Telling it what NOT to do

Use agent_lab_update with just the instructions field. Test after every change.

### Adding a tool
A tool lets the agent take action. Use agent_lab_update with a new entry in tools:
- name: snake_case, e.g. lookup_order
- description: when to use it (the model reads this)
- parameters: JSON Schema object, e.g. {"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}
- code: async function body. Receives args (validated). Returns a string. Can use fetch, process.env, await.

Example tool code:
const res = await fetch("https://api.example.com/items/" + args.id);
const data = await res.json();
return JSON.stringify(data);

After adding a tool, test with a prompt that should trigger it. Check agent_lab_get_logs if it doesn't fire.

### Connecting an MCP server
MCP gives the agent tools from an external server. Use agent_lab_update with mcpConnections:
- name: connection name, e.g. linear
- url: MCP server URL (Streamable HTTP or SSE)
- tokenEnv: env var name holding the bearer token, e.g. LINEAR_API_TOKEN

The agent auto-discovers tools from the MCP server. They appear as mcp__<name>__<tool>. Test after connecting.

## Testing

After EVERY change, test immediately with agent_lab_test_prompt. Pick a realistic message — not "hello" but something that exercises the agent's actual purpose. Show the user the response.

If the test fails:
1. Call agent_lab_get_logs to see what went wrong
2. Read the error
3. Fix it (update instructions, fix tool code, etc.)
4. Test again
5. Never report a failure without trying to fix it

## Browser testing

After the agent basically works, open it in the browser so the user can try it:
1. Call agent_lab_get_url to get the URLs
2. Call openwork_browser_open_url with the Slack URL (/slack) — this gives the user a Slack-like interface with channels (#general, #support, #random) and direct messages
3. The user can switch channels and chat with the agent — each channel is a separate conversation session
4. There's also a simpler chat UI at / if preferred

## Model specifiers

- anthropic/claude-sonnet-4-6 — good default, capable and fast
- anthropic/claude-haiku-4-5 — fast and cheap, good for simple agents
- openai/gpt-5.5 — strong alternative
- The user needs the corresponding API key set as an environment variable

## Tone

Be concise. Show test results, not explanations. When something fails, fix it — don't just report the failure. You are building and tuning, not advising. The user should see progress after every message they send.`;

export async function buildOpenworkRuntimeConfigObject(
  config?: ServerConfig,
  workspaceId?: string,
): Promise<Record<string, unknown>> {
  const runtimeConfig = config && workspaceId ? await readRuntimeOpencodeConfig(config, workspaceId) : {};
  const disabledProviders = runtimeDisabledProviderList(runtimeConfig);
  return {
    ...runtimeConfig,
    default_agent: runtimeConfig.default_agent ?? "openwork",
    agent: {
      openwork: {
        description: "OpenWork default agent",
        mode: "primary",
        temperature: 0.2,
        prompt: OPENWORK_AGENT_PROMPT,
      },
      "agent-builder": {
        description: "Build and refine AI agents through conversation",
        mode: "primary",
        model: "openai/gpt-5.5",
        color: "#7C3AED",
        tools: {
          "*": false,
          agent_lab_create: true,
          agent_lab_update: true,
          agent_lab_test_prompt: true,
          agent_lab_get_url: true,
          agent_lab_list: true,
          agent_lab_get_source: true,
          agent_lab_stop: true,
          agent_lab_get_logs: true,
          openwork_browser_open_url: true,
          openwork_ui_snapshot: true,
          openwork_ui_execute_action: true,
        },
        prompt: AGENT_BUILDER_PROMPT,
      },
    },
    plugin: [
      "opencode-chrome-devtools",
      openworkExtensionsPreviewPluginPath(),
      openworkCapabilitiesKnowledgePluginPath(),
      openworkAnthropicAdaptiveThinkingPluginPath(),
      openworkAnthropicToolSchemaPluginPath(),
      openworkAgentBuilderPluginPath(),
      ...runtimePluginList(runtimeConfig),
    ],
    ...(disabledProviders.length ? { disabled_providers: disabledProviders } : {}),
    mcp: runtimeMcpMap(runtimeConfig),
  };
}

export async function buildOpenworkRuntimeConfig(config?: ServerConfig, workspaceId?: string): Promise<string> {
  return JSON.stringify(await buildOpenworkRuntimeConfigObject(config, workspaceId));
}

export function openworkRuntimeConfigFilePath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), "runtime-opencode-config.json");
}

// Serialize file writes per path so a slow older write can never land after
// (and clobber) a newer one. Content is built inside the queued job so each
// job reads the latest runtime-DB state.
const fileWriteQueue = new Map<string, Promise<void>>();

/**
 * Rebuild the engine-visible runtime config file from the runtime DB.
 * Atomic (temp file + rename) so the engine never reads a partial file
 * mid-dispose.
 */
export async function writeOpenworkRuntimeConfigFile(config: ServerConfig, workspaceId: string): Promise<string> {
  const path = openworkRuntimeConfigFilePath(config);
  const job = async () => {
    const content = await buildOpenworkRuntimeConfig(config, workspaceId);
    await mkdir(runtimeStorageDir(config), { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, path);
  };
  const previous = fileWriteQueue.get(path) ?? Promise.resolve();
  const next = previous.then(job, job);
  fileWriteQueue.set(path, next);
  await next;
  return path;
}

/**
 * Keep the runtime config file in sync with the runtime DB so every engine
 * instance rebuild reads fresh state instead of a spawn-time snapshot.
 * Returns an unsubscribe function.
 */
export function keepOpenworkRuntimeConfigFileFresh(config: ServerConfig, workspaceId: string): () => void {
  return onRuntimeOpencodeConfigWrite((writeConfig, writtenWorkspaceId) => {
    if (writtenWorkspaceId !== workspaceId) return;
    void writeOpenworkRuntimeConfigFile(writeConfig, workspaceId).catch(() => undefined);
  });
}
