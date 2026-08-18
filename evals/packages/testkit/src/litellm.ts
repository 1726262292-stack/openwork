import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkipError } from "./needs.ts";

const IMAGE = "ghcr.io/berriai/litellm:v1.97.0@sha256:468c25f35f3e5ec4e414974f00deab93337b1b4d9953cabcfd3722e59415f834";
const COMMAND_TIMEOUT_MS = 180_000;
const STARTUP_TIMEOUT_MS = 90_000;

export interface LiteLlmUpstreamRequest {
  receivedAt: string;
  model: string;
  tokenId: string;
  bodyText: string;
}

export interface LiteLlmHandle extends AsyncDisposable {
  baseUrl: string;
  apiKey: string;
  upstreamKey: string;
  tokenId(key: string): string;
  waitForUpstreamRequest(input: { model: string; key: string; since: string; timeoutMs: number }): Promise<LiteLlmUpstreamRequest>;
  upstreamRequests(input: { since: string }): LiteLlmUpstreamRequest[];
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], timeout = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} failed: ${error.message}\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function tokenId(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function bearerToken(value: string | undefined): string {
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function redact(text: string, secrets: string[]): string {
  return secrets.reduce((result, secret) => result.split(secret).join("[REDACTED]"), text);
}

function startWitness(modelId: string, reply: string, requests: LiteLlmUpstreamRequest[]): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && path === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: modelId, object: "model", owned_by: "openwork-testkit" }] }));
      return;
    }
    if (request.method !== "POST" || (path !== "/v1/chat/completions" && path !== "/chat/completions")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }

    let bodyText = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { bodyText += chunk; });
    request.on("end", () => {
      let body: unknown = null;
      try { body = JSON.parse(bodyText); } catch { body = null; }
      const model = isRecord(body) && typeof body.model === "string" ? body.model : "";
      requests.push({
        receivedAt: new Date().toISOString(),
        model,
        tokenId: tokenId(bearerToken(request.headers.authorization)),
        bodyText,
      });
      const id = `chatcmpl-${randomBytes(8).toString("hex")}`;
      if (isRecord(body) && body.stream === true) {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        response.end("data: [DONE]\n\n");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id,
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 },
      }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("LiteLLM upstream witness did not bind a TCP port."));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

async function mappedPort(container: string): Promise<number> {
  const result = await run("docker", ["port", container, "4000/tcp"], 10_000);
  const match = result.stdout.match(/:(\d+)\s*$/m);
  const port = match ? Number(match[1]) : 0;
  if (!Number.isInteger(port) || port <= 0) throw new Error(`docker port returned an invalid mapping: ${result.stdout.trim()}`);
  return port;
}

async function waitForProxy(container: string, apiKey: string, modelId: string): Promise<number> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let port = 0;
  let last = "proxy not queried";
  while (Date.now() < deadline) {
    try {
      port ||= await mappedPort(container);
      const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(3_000),
      });
      const body: unknown = await response.json();
      const models = isRecord(body) && Array.isArray(body.data) ? body.data.filter(isRecord) : [];
      if (response.ok && models.some((model) => model.id === modelId)) return port;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`LiteLLM did not expose model ${modelId} within ${STARTUP_TIMEOUT_MS}ms (last observation: ${last}).`);
}

export async function liteLlm(input: { modelId: string; reply: string }): Promise<LiteLlmHandle> {
  try {
    await run("docker", ["info"], 15_000);
  } catch {
    throw new SkipError("Docker daemon is unavailable");
  }

  const requests: LiteLlmUpstreamRequest[] = [];
  const masterKey = `sk-openwork-master-${randomBytes(24).toString("hex")}`;
  const upstreamKey = `sk-openwork-upstream-${randomBytes(24).toString("hex")}`;
  const container = `openwork-litellm-${randomBytes(8).toString("hex")}`;
  let root = "";
  let witness: Server | null = null;
  try {
    const startedWitness = await startWitness(input.modelId, input.reply, requests);
    witness = startedWitness.server;
    root = await realpath(await mkdtemp(join(tmpdir(), "openwork-litellm-")));
    const configPath = join(root, "config.yaml");
    await writeFile(configPath, JSON.stringify({
      model_list: [{
        model_name: input.modelId,
        litellm_params: {
          model: `openai/${input.modelId}`,
          api_base: `http://host.docker.internal:${startedWitness.port}/v1`,
          api_key: upstreamKey,
        },
      }],
      general_settings: { master_key: masterKey },
    }), { mode: 0o600 });
    await run("docker", [
      "create", "--name", container,
      "--add-host", "host.docker.internal:host-gateway",
      "--publish", "127.0.0.1::4000",
      IMAGE, "--config", "/app/config.yaml", "--port", "4000",
    ]);
    await run("docker", ["cp", configPath, `${container}:/app/config.yaml`], 30_000);
    await run("docker", ["start", container], 30_000);
    const port = await waitForProxy(container, masterKey, input.modelId);
    let disposed = false;
    return {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: masterKey,
      upstreamKey,
      tokenId,
      upstreamRequests({ since }) {
        return requests.filter((request) => request.receivedAt >= since).map((request) => ({ ...request }));
      },
      async waitForUpstreamRequest({ model, key, since, timeoutMs }) {
        const deadline = Date.now() + timeoutMs;
        const expectedTokenId = tokenId(key);
        while (Date.now() < deadline) {
          const found = requests.find((request) => request.receivedAt >= since && request.model === model && request.tokenId === expectedTokenId);
          if (found) return { ...found };
          await sleep(100);
        }
        const observed = requests.filter((request) => request.receivedAt >= since).map(({ receivedAt, model: observedModel, tokenId: observedTokenId }) => ({ receivedAt, model: observedModel, tokenId: observedTokenId }));
        throw new Error(`Upstream did not receive model ${model} with token fingerprint ${expectedTokenId}. Observed: ${JSON.stringify(observed)}`);
      },
      async [Symbol.asyncDispose]() {
        if (disposed) return;
        disposed = true;
        await run("docker", ["rm", "--force", container], 20_000).catch(() => undefined);
        await Promise.all([
          rm(root, { recursive: true, force: true }),
          closeServer(startedWitness.server),
        ]);
      },
    };
  } catch (error) {
    const logs = await run("docker", ["logs", container], 10_000).then((result) => result.stdout + result.stderr, () => "");
    await run("docker", ["rm", "--force", container], 20_000).catch(() => undefined);
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    if (witness) await closeServer(witness).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redact(`${message}${logs ? `\nDocker logs:\n${logs}` : ""}`, [masterKey, upstreamKey]));
  }
}
