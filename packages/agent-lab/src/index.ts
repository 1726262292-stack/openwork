import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, rm, readFile, symlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { generateAppTs } from "./app-template.js";

export type AgentToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  code: string;
};

export type AgentMcpDef = {
  name: string;
  url: string;
  tokenEnv?: string;
  description?: string;
};

export type AgentConfig = {
  name: string;
  model: string;
  instructions: string;
  tools?: AgentToolDef[];
  mcpConnections?: AgentMcpDef[];
};

export type LabAgent = {
  id: string;
  name: string;
  projectDir: string;
  port: number;
  baseUrl: string;
  process: ChildProcess;
  config: AgentConfig;
  logs: string[];
};

const BASE_PORT = 4820;
let nextPort = BASE_PORT;
const agents = new Map<string, LabAgent>();
const LAB_ROOT = join(tmpdir(), "openwork-agent-lab");

function allocatePort(): number {
  return nextPort++;
}

function agentId(): string {
  return `agent_${randomBytes(6).toString("hex")}`;
}

function projectDirFor(name: string, id: string): string {
  return join(LAB_ROOT, `${sanitizeAgentName(name)}_${id.slice(6, 14)}`);
}

function sanitizeAgentName(input: string): string {
  const slug = input.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return slug || "agent";
}

const SECRETS_FILE = "/tmp/openwork-agent-lab-secrets.env";

function loadSecretsFile(): Record<string, string> {
  try {
    const content = readFileSync(SECRETS_FILE, "utf8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        result[key] = val;
      }
    }
    return result;
  } catch {
    return {};
  }
}

const secretsFromFile = loadSecretsFile();

function getEnv(key: string): string | undefined {
  return process.env[key] ?? secretsFromFile[key];
}

const PROVIDER_KEY_PATTERNS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "XAI_API_KEY",
  "PERPLEXITY_API_KEY",
  "RESEND_API_KEY",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "LINEAR_API_KEY",
  "LINEAR_API_TOKEN",
  "GITHUB_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
  "NOTION_API_KEY",
  "NOTION_TOKEN",
];

function generateEnvFile(): string {
  const lines: string[] = [];
  for (const key of PROVIDER_KEY_PATTERNS) {
    const val = getEnv(key);
    if (val) lines.push(`${key}=${val}`);
  }
  return lines.join("\n") + "\n";
}

function generateAgentModule(config: AgentConfig): string {
  const toolImports = (config.tools ?? []).map((t) => `import ${t.name}Tool from "../tools/${t.name}.ts";`).join("\n");
  const toolRefs = (config.tools ?? []).map((t) => `${t.name}Tool`).join(", ");
  const mcpConnections = config.mcpConnections ?? [];
  const hasMcp = mcpConnections.length > 0;
  const needsAsync = hasMcp;

  const mcpImports = hasMcp ? `, connectMcpServer` : "";
  const mcpSetup = hasMcp
    ? mcpConnections.map((m) => {
        const tokenExpr = m.tokenEnv ? `process.env.${m.tokenEnv} ?? ""` : '""';
        return [
          `  const ${m.name}Mcp = await connectMcpServer(${JSON.stringify(m.name)}, {`,
          `    url: ${JSON.stringify(m.url)},`,
          `    headers: { Authorization: "Bearer " + (${tokenExpr}) },`,
          `  });`,
        ].join("\n");
      }).join("\n")
    : "";
  const mcpToolRefs = hasMcp ? mcpConnections.map((m) => `...${m.name}Mcp.tools`).join(", ") : "";
  const allTools = [toolRefs, mcpToolRefs].filter(Boolean).join(", ");

  if (needsAsync) {
    return `import { createAgent${mcpImports} } from "@flue/runtime";
${toolImports}

export const route = (c, next) => next();

export default createAgent(async () => {
${mcpSetup}
  return {
    model: ${JSON.stringify(config.model)},
    instructions: ${JSON.stringify(config.instructions)},
${allTools ? `    tools: [${allTools}],` : ""}
  };
});
`;
  }

  return `import { createAgent } from "@flue/runtime";
${toolImports}

export const route = (c, next) => next();

export default createAgent(() => ({
  model: ${JSON.stringify(config.model)},
  instructions: ${JSON.stringify(config.instructions)},
${allTools ? `  tools: [${allTools}],` : ""}
}));
`;
}

function generateToolModule(tool: AgentToolDef): string {
  return `import { defineTool } from "@flue/runtime";

export default defineTool({
  name: ${JSON.stringify(tool.name)},
  description: ${JSON.stringify(tool.description)},
  parameters: ${JSON.stringify(tool.parameters)},
  execute: async (args) => {
${indent(tool.code, 4)}
  },
});
`;
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text.split("\n").map((l) => pad + l).join("\n");
}

async function writeProject(dir: string, config: AgentConfig): Promise<void> {
  await mkdir(join(dir, "agents"), { recursive: true });
  await mkdir(join(dir, "tools"), { recursive: true });

  await writeFile(join(dir, "agents", `${sanitizeAgentName(config.name)}.ts`), generateAgentModule(config));
  await writeFile(join(dir, "app.ts"), generateAppTs(sanitizeAgentName(config.name), config.name));

  for (const tool of config.tools ?? []) {
    await writeFile(join(dir, "tools", `${tool.name}.ts`), generateToolModule(tool));
  }

  await writeFile(join(dir, "package.json"), JSON.stringify({
    name: sanitizeAgentName(config.name),
    type: "module",
    dependencies: { "@flue/runtime": "0.11.1", hono: "^4.6.0" },
  }, null, 2));

  await writeFile(join(dir, ".env"), generateEnvFile());

  await symlinkNodeModules(dir);
}

async function symlinkNodeModules(dir: string): Promise<void> {
  const runtimeNodeModules = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules");
  try {
    await symlink(runtimeNodeModules, join(dir, "node_modules"), "dir");
  } catch {
    // symlink might already exist
  }
}

function findFlueBin(): string {
  const configUrl = import.meta.resolve("@flue/cli/config");
  const configPath = fileURLToPath(configUrl);
  const pkgDir = join(dirname(configPath), "..");
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { bin: Record<string, string> };
  return join(pkgDir, pkg.bin.flue);
}

function attachLogCapture(child: ChildProcess, logs: string[]): void {
  const capture = (label: string) => (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split("\n")) {
      if (line.trim()) logs.push(`[${label}] ${line.trim()}`);
    }
  };
  child.stdout?.on("data", capture("stdout"));
  child.stderr?.on("data", capture("stderr"));
}

function waitForBuild(logs: string[], timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const startLen = logs.length;
  return new Promise((resolve, reject) => {
    const check = setInterval(() => {
      const recentLogs = logs.slice(startLen).join("\n");
      if (recentLogs.includes("Build complete") || recentLogs.includes("Built in")) {
        clearInterval(check);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(check);
        resolve();
      }
    }, 200);
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Agent server did not become healthy within ${timeoutMs}ms at ${baseUrl}`);
}

export async function createLabAgent(config: AgentConfig): Promise<LabAgent> {
  const id = agentId();
  const dir = projectDirFor(config.name, id);
  const port = allocatePort();
  const logs: string[] = [];

  await mkdir(dir, { recursive: true });
  await writeProject(dir, config);

  const flueBin = findFlueBin();
  const envVars: Record<string, string> = { ...process.env as Record<string, string> };
  for (const key of PROVIDER_KEY_PATTERNS) {
    const val = getEnv(key);
    if (val) envVars[key] = val;
  }
  const child = spawn("node", [flueBin, "dev", "--target", "node", "--port", String(port)], {
    cwd: dir,
    env: envVars,
    stdio: ["ignore", "pipe", "pipe"],
  });

  attachLogCapture(child, logs);
  const baseUrl = `http://127.0.0.1:${port}`;
  const agent: LabAgent = {
    id,
    name: sanitizeAgentName(config.name),
    projectDir: dir,
    port,
    baseUrl,
    process: child,
    config,
    logs,
  };

  try {
    await waitForHealth(baseUrl);
  } catch (err) {
    child.kill();
    throw new Error(`${err instanceof Error ? err.message : err}\n\nLogs:\n${logs.slice(-20).join("\n")}`);
  }

  agents.set(id, agent);
  return agent;
}

export async function updateLabAgent(id: string, config: Partial<AgentConfig>): Promise<LabAgent> {
  const agent = agents.get(id);
  if (!agent) throw new Error(`Agent ${id} not found`);
  const merged = { ...agent.config, ...config };
  agent.config = merged;
  await writeProject(agent.projectDir, merged);
  await waitForBuild(agent.logs);
  return agent;
}

export async function testPrompt(id: string, message: string, instanceId?: string): Promise<{ text: string; events: unknown[] }> {
  const agent = agents.get(id);
  if (!agent) throw new Error(`Agent ${id} not found`);
  const inst = instanceId ?? "test";

  const postRes = await fetch(`${agent.baseUrl}/agents/${agent.name}/${inst}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!postRes.ok) {
    const body = await postRes.text().catch(() => "");
    throw new Error(`Agent POST returned ${postRes.status}: ${body}`);
  }

  const { streamUrl, offset } = (await postRes.json()) as { streamUrl: string; offset: string };

  const events: unknown[] = [];
  let text = "";

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await fetch(`${streamUrl}?offset=${offset}`);
    if (!res.ok) continue;
    const batch = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(batch) || batch.length === 0) continue;

    for (const event of batch) {
      events.push(event);
      const type = event.type as string;

      if (type === "message_start" || type === "message_end") {
        const msg = event.message as Record<string, unknown> | undefined;
        const content = msg?.content as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part.type === "text" && typeof part.text === "string") {
              text += part.text;
            }
          }
        }
      }

      if (type === "operation") {
        if (event.isError) {
          const error = event.error as Record<string, unknown> | string | undefined;
          const msg = typeof error === "object" && error?.message ? error.message : String(error ?? "Agent failed");
          throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
        }
        return { text, events };
      }
    }
  }

  return { text, events };
}

export function getLabAgent(id: string): LabAgent | undefined {
  return agents.get(id);
}

export function listLabAgents(): LabAgent[] {
  return [...agents.values()];
}

export function getAgentUrl(id: string): string | undefined {
  return agents.get(id)?.baseUrl;
}

export function getAgentLogs(id: string, lines = 50): string[] {
  const agent = agents.get(id);
  if (!agent) return [];
  return agent.logs.slice(-lines);
}

export async function stopLabAgent(id: string): Promise<void> {
  const agent = agents.get(id);
  if (!agent) return;
  agent.process.kill();
  await rm(agent.projectDir, { recursive: true, force: true }).catch(() => {});
  agents.delete(id);
}

export async function stopAllLabAgents(): Promise<void> {
  const ids = [...agents.keys()];
  await Promise.all(ids.map(stopLabAgent));
}

export async function getAgentSource(id: string): Promise<Record<string, string>> {
  const agent = agents.get(id);
  if (!agent) throw new Error(`Agent ${id} not found`);
  const files: Record<string, string> = {};
  files[`agents/${agent.name}.ts`] = await readFile(join(agent.projectDir, "agents", `${agent.name}.ts`), "utf8");
  files["app.ts"] = await readFile(join(agent.projectDir, "app.ts"), "utf8");
  files["package.json"] = await readFile(join(agent.projectDir, "package.json"), "utf8");
  for (const tool of agent.config.tools ?? []) {
    files[`tools/${tool.name}.ts`] = await readFile(join(agent.projectDir, "tools", `${tool.name}.ts`), "utf8");
  }
  return files;
}
