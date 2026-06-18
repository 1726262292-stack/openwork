import { z } from "zod";
import {
  createLabAgent,
  updateLabAgent,
  testPrompt,
  getLabAgent,
  listLabAgents,
  getAgentUrl,
  getAgentLogs,
  stopLabAgent,
  getAgentSource,
  type AgentConfig,
  type AgentToolDef,
  type AgentMcpDef,
} from "@openwork/agent-lab";

type OpenCodeContext = {
  agent?: string;
  sessionID?: string;
  messageID?: string;
  directory?: string;
  worktree?: string;
};

const toolDefSchema = z.object({
  name: z.string().describe("Tool name in snake_case, e.g. 'lookup_order'"),
  description: z.string().describe("What the tool does — the model reads this to decide when to call it"),
  parameters: z.record(z.string(), z.unknown()).describe("JSON Schema object describing the tool's input parameters"),
  code: z.string().describe("The JavaScript body of the execute function. Receives `args` (validated against parameters). Must return a string. Example: `const status = await db.lookup(args.orderId);\\n    return status ?? 'Not found';`"),
});

const mcpDefSchema = z.object({
  name: z.string().describe("Connection name in snake_case, e.g. 'linear' or 'inventory'"),
  url: z.string().describe("MCP server URL (Streamable HTTP or SSE)"),
  tokenEnv: z.string().optional().describe("Environment variable name holding the bearer token, e.g. 'LINEAR_API_TOKEN'"),
  description: z.string().optional().describe("What this MCP server provides (written for the model)"),
});

const createArgsSchema = z.object({
  name: z.string().describe("Human-readable name for the agent, e.g. 'GitHub Issue Triage'"),
  model: z.string().describe("Model specifier: provider/model, e.g. 'anthropic/claude-sonnet-4-6' or 'openai/gpt-5.5'"),
  instructions: z.string().describe("The agent's system prompt — who it is and how it should behave"),
  tools: z.array(toolDefSchema).optional().describe("Custom tools the agent can call"),
  mcpConnections: z.array(mcpDefSchema).optional().describe("MCP server connections to wire up"),
});

const updateArgsSchema = z.object({
  agentId: z.string().describe("The agent ID returned by agent_lab_create"),
  name: z.string().optional(),
  model: z.string().optional(),
  instructions: z.string().optional().describe("Updated system prompt"),
  tools: z.array(toolDefSchema).optional().describe("Replace all tools with this list"),
  mcpConnections: z.array(mcpDefSchema).optional().describe("Replace all MCP connections with this list"),
});

const testArgsSchema = z.object({
  agentId: z.string().describe("The agent ID returned by agent_lab_create"),
  message: z.string().describe("The test message to send to the agent"),
  instanceId: z.string().optional().describe("Session instance ID. Defaults to 'test'. Use different IDs to test separate conversations."),
});

const getUrlArgsSchema = z.object({
  agentId: z.string().describe("The agent ID returned by agent_lab_create"),
});

const getSourceArgsSchema = z.object({
  agentId: z.string().describe("The agent ID returned by agent_lab_create"),
});

const stopArgsSchema = z.object({
  agentId: z.string().describe("The agent ID returned by agent_lab_create"),
});

const getLogsArgsSchema = z.object({
  agentId: z.string().describe("The agent ID returned by agent_lab_create"),
  lines: z.number().optional().describe("Number of recent log lines to return. Default 50."),
});

const SYSTEM_INSTRUCTION = `
## Agent Lab — Build and Refine One Agent

You have tools to build, test, and iteratively refine AI agents using the Flue framework. Agents run locally inside OpenWork on a temporary HTTP server with a chat UI, and can be tested immediately.

### Core approach: one agent, progressively better

You are building ONE agent and making it better step by step. Not many agents — one agent that gets progressively more capable.

The loop:
1. **Create minimal** — just instructions + model. No tools, no MCP. Test immediately.
2. **Test** — send a realistic prompt. Show the result.
3. **Add one thing** — based on the test, add ONE capability: better instructions, one tool, or one MCP connection.
4. **Test again** — did it help? Show the difference.
5. **Repeat** — each iteration adds or refines one thing.

Never add multiple things at once. If the user asks for three features, build them one at a time, testing between each.

### Instructions first

Before adding tools, try improving the instructions. Most quality comes from clear, specific instructions. Be explicit about:
- The agent's role and persona
- What format responses should be in
- What the agent should and shouldn't do
- Examples of good responses

### Adding tools

A tool lets the agent take action. When adding a tool via agent_lab_update:
- 'name': snake_case (e.g. lookup_order)
- 'description': when to use it — the model reads this to decide
- 'parameters': JSON Schema object (e.g. {"type":"object","properties":{"id":{"type":"string"}},"required":["id"]})
- 'code': async function body. Receives 'args' (validated). Returns a string. Can use await, fetch, process.env.

Example tool code:
const res = await fetch("https://api.example.com/items/" + args.id);
const data = await res.json();
return JSON.stringify(data);

After adding a tool, test with a prompt that should trigger it. Check agent_lab_get_logs if it doesn't fire.

### MCP connections

MCP gives the agent tools from an external server. When adding via agent_lab_update:
- 'name': connection name (e.g. linear)
- 'url': MCP server URL (Streamable HTTP or SSE)
- 'tokenEnv': env var name holding the bearer token (e.g. LINEAR_API_TOKEN)

The agent auto-discovers tools. Test after connecting.

### Testing

After EVERY change, test immediately with agent_lab_test_prompt. Pick a realistic message that exercises the agent's actual purpose — not "hello".

If the test fails:
1. Call agent_lab_get_logs to see what went wrong
2. Read the error
3. Fix it
4. Test again
5. Never report a failure without trying to fix it

### Browser testing

After the agent basically works, open it in the browser so the user can try it:
1. agent_lab_get_url → get the URLs
2. openwork_browser_open_url → open the Slack URL (\${baseUrl}/slack) — this gives the user a Slack-like interface with channels (#general, #support, #random) and direct messages
3. The user can switch channels and chat with the agent in each one — each channel is a separate conversation session
4. Alternatively, the chat URL (\${baseUrl}/) gives a simpler chat bubble interface
`;

export default async () => ({
  "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
    output.system.push(SYSTEM_INSTRUCTION);
  },
  tool: {
    agent_lab_create: {
      description: "Create a new Flue agent and start it running locally. Returns the agent ID, base URL, and agent name. The agent is immediately testable via HTTP. Use this to start building an agent from a description of what it should do.",
      args: createArgsSchema.shape,
      async execute(rawArgs: unknown, _context: OpenCodeContext) {
        const args = createArgsSchema.parse(rawArgs);
        const config: AgentConfig = {
          name: args.name,
          model: args.model,
          instructions: args.instructions,
          tools: (args.tools ?? []) as AgentToolDef[],
          mcpConnections: (args.mcpConnections ?? []) as AgentMcpDef[],
        };
        const agent = await createLabAgent(config);
        return JSON.stringify({
          agentId: agent.id,
          name: agent.name,
          baseUrl: agent.baseUrl,
          chatUrl: `${agent.baseUrl}/`,
          slackUrl: `${agent.baseUrl}/slack`,
          testUrl: `${agent.baseUrl}/agents/${agent.name}/test`,
          status: "running",
          message: `Agent is running. URLs:\n- Chat UI: ${agent.baseUrl}/\n- Slack UI: ${agent.baseUrl}/slack\n\nUse agent_lab_test_prompt to test it, or openwork_browser_open_url with the Slack URL to let the user interact in a Slack-like interface.`,
        }, null, 2);
      },
    },
    agent_lab_update: {
      description: "Update an existing agent's configuration (instructions, model, tools, MCP connections). The agent hot-reloads automatically. Use this to iterate after testing.",
      args: updateArgsSchema.shape,
      async execute(rawArgs: unknown, _context: OpenCodeContext) {
        const args = updateArgsSchema.parse(rawArgs);
        const config: Partial<AgentConfig> = {};
        if (args.name) config.name = args.name;
        if (args.model) config.model = args.model;
        if (args.instructions) config.instructions = args.instructions;
        if (args.tools) config.tools = args.tools as AgentToolDef[];
        if (args.mcpConnections) config.mcpConnections = args.mcpConnections as AgentMcpDef[];
        const agent = await updateLabAgent(args.agentId, config);
        return JSON.stringify({
          agentId: agent.id,
          name: agent.name,
          baseUrl: agent.baseUrl,
          status: "updated",
          message: "Agent updated and reloaded. Test it again with agent_lab_test_prompt.",
        }, null, 2);
      },
    },
    agent_lab_test_prompt: {
      description: "Send a test message to a running agent and get its response. Use this to verify the agent works after creating or updating it.",
      args: testArgsSchema.shape,
      async execute(rawArgs: unknown, _context: OpenCodeContext) {
        const args = testArgsSchema.parse(rawArgs);
        try {
          const result = await testPrompt(args.agentId, args.message, args.instanceId);
          return JSON.stringify({
            response: result.text,
            agentId: args.agentId,
          }, null, 2);
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            agentId: args.agentId,
            hint: "If the agent just started, it may still be initializing. Wait a moment and try again. If the error persists, check that the model name and API key are correct.",
          }, null, 2);
        }
      },
    },
    agent_lab_get_url: {
      description: "Get the HTTP base URL of a running agent. Use this URL with openwork_browser_open_url to let the user interact with the agent in the built-in browser. The agent endpoint is POST <baseUrl>/agents/<agentName>/<instanceId> with body { \"text\": \"message\" }.",
      args: getUrlArgsSchema.shape,
      async execute(rawArgs: unknown, _context: OpenCodeContext) {
        const args = getUrlArgsSchema.parse(rawArgs);
        const url = getAgentUrl(args.agentId);
        const agent = getLabAgent(args.agentId);
        if (!url || !agent) {
          return JSON.stringify({ error: `Agent ${args.agentId} not found. Use agent_lab_list to see running agents.` }, null, 2);
        }
        return JSON.stringify({
          baseUrl: url,
          chatUrl: `${url}/`,
          slackUrl: `${url}/slack`,
          agentName: agent.name,
          testEndpoint: `${url}/agents/${agent.name}/test`,
          message: `Open the agent in the browser:\n- Slack UI: ${url}/slack (Slack-like interface with channels)\n- Chat UI: ${url}/ (simple chat bubbles)\n\nUse openwork_browser_open_url with the Slack URL for the best experience.`,
        }, null, 2);
      },
    },
    agent_lab_list: {
      description: "List all agents currently running in the Agent Lab. Returns each agent's ID, name, base URL, and status.",
      args: {},
      async execute() {
        const agents = listLabAgents();
        return JSON.stringify({
          agents: agents.map((a) => ({
            agentId: a.id,
            name: a.name,
            baseUrl: a.baseUrl,
            model: a.config.model,
            tools: (a.config.tools ?? []).map((t) => t.name),
            mcpConnections: (a.config.mcpConnections ?? []).map((m) => m.name),
          })),
          count: agents.length,
        }, null, 2);
      },
    },
    agent_lab_get_source: {
      description: "Get the generated TypeScript source files for an agent. Use this when the user wants to deploy — these files are a standard Flue project that can deploy to any Node host.",
      args: getSourceArgsSchema.shape,
      async execute(rawArgs: unknown, _context: OpenCodeContext) {
        const args = getSourceArgsSchema.parse(rawArgs);
        try {
          const files = await getAgentSource(args.agentId);
          return JSON.stringify({
            agentId: args.agentId,
            files,
            deployHint: "These files form a standard Flue project. To deploy: npm install, set ANTHROPIC_API_KEY (or other provider key), and run 'npx flue build --target node && node dist/server.mjs' on Render, Fly.io, Railway, or any Node host.",
          }, null, 2);
        } catch (error) {
          return JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2);
        }
      },
    },
    agent_lab_stop: {
      description: "Stop a running agent and clean up its temporary project files. Use this when the user is done with an agent or wants to start fresh.",
      args: stopArgsSchema.shape,
      async execute(rawArgs: unknown, _context: OpenCodeContext) {
        const args = stopArgsSchema.parse(rawArgs);
        await stopLabAgent(args.agentId);
        return JSON.stringify({ agentId: args.agentId, status: "stopped" }, null, 2);
      },
    },
    agent_lab_get_logs: {
      description: "Get recent logs from a running agent's dev server. Use this to debug build errors, crashes, or unexpected behavior. Shows flue dev output including build errors, TypeScript errors, and runtime errors.",
      args: getLogsArgsSchema.shape,
      async execute(rawArgs: unknown, _context: OpenCodeContext) {
        const args = getLogsArgsSchema.parse(rawArgs);
        const logs = getAgentLogs(args.agentId, args.lines ?? 50);
        return JSON.stringify({ agentId: args.agentId, logs, count: logs.length }, null, 2);
      },
    },
  },
});
