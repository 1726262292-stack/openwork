import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Narration is loaded from the approved script (evals/voiceovers/search-routed-capabilities.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs("search-routed-capabilities");

const FLOW_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(FLOW_DIR, "../fixtures/acme-glossary-mcp.mjs");

const MCP_NAME = "acme-glossary";
const GLOSSARY_CAPABILITY = "mcp:acme-glossary:lookup_glossary";
const GLOSSARY_PROMPT = "What does 'blue-forty' mean in our team glossary?";
const GLOSSARY_DEFINITION = "quarterly priority launch";

const SKILL_NAME = "release-runbook";
const SKILL_CAPABILITY = "skill:release-runbook";
const SKILL_DESCRIPTION = "Acme release runbook — steps to cut, verify, and announce a release.";
const SKILL_CONTENT = `---
name: ${SKILL_NAME}
description: ${SKILL_DESCRIPTION}
---

# Acme release runbook

## Steps

1. Freeze the branch.
2. Cut the release tag.
3. Verify artifacts.
4. Announce in #releases.
`;

const state = {
  serverPort: null,
  workspaceId: null,
  workspacePath: null,
  sessionId: null,
  runbookStepText: "Announce in #releases",
  cloudCapabilityName: "postMemory",
  sawGlossaryDefinition: false,
  sawRunbookViaCapabilities: false,
};

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitUntil(ctx, predicate, { timeoutMs = 20_000, label = "condition" } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await predicate();
      if (result) return result;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  ctx.assert(false, `Timed out after ${timeoutMs}ms waiting for ${label}${lastError ? ` (${lastError.message})` : ""}`);
}

// In-page OpenWork server access using the app's own port/token from localStorage.
// This mirrors the serverCallExpr pattern in extensions-export-portable.flow.mjs;
// no eval flow hardcodes ports or tokens.
// The localStorage port is an override mirror that can go stale when the
// embedded server restarts (e.g. after MCP writes). Discover the live port by
// probing candidates gathered from localStorage and the app's own recent
// server traffic (resource timing; cleared + resampled when the buffer is full).
const discoverServerPortExpr = `(async () => {
  const token = localStorage.getItem("openwork.server.token");
  if (!token) return { ok: false, error: "no server token" };
  const resourcePorts = () => performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => /^http:\\/\\/127\\.0\\.0\\.1:\\d+\\//.test(name))
    .map((name) => new URL(name).port);
  const probe = async (port) => {
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/workspaces", {
        headers: { Authorization: "Bearer " + token },
      });
      return response.ok;
    } catch {
      return false;
    }
  };
  const tried = new Set();
  const tryAll = async (candidates) => {
    for (const port of candidates) {
      if (!port || tried.has(port)) continue;
      tried.add(port);
      if (await probe(port)) return port;
    }
    return null;
  };
  const stored = localStorage.getItem("openwork.server.port");
  let port = await tryAll([stored, ...resourcePorts().reverse()]);
  if (!port) {
    performance.clearResourceTimings();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    port = await tryAll(resourcePorts().reverse());
  }
  return port ? { ok: true, port } : { ok: false, error: "no live server port found" };
})()`;

const serverCallExpr = (port, pathTemplate, init) => `(async () => {
  const token = localStorage.getItem("openwork.server.token");
  const hostToken = localStorage.getItem("openwork.server.hostToken");
  if (!token) return { ok: false, error: "no server token in localStorage" };
  const base = "http://127.0.0.1:" + ${JSON.stringify(port)};
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  if (hostToken) headers["X-OpenWork-Host-Token"] = hostToken;
  const wsResponse = await fetch(base + "/workspaces", { headers });
  if (!wsResponse.ok) return { ok: false, error: "workspaces " + wsResponse.status };
  const wsPayload = await wsResponse.json();
  const workspaces = Array.isArray(wsPayload) ? wsPayload : wsPayload.items ?? wsPayload.workspaces ?? [];
  const active = localStorage.getItem("openwork.react.activeWorkspace");
  const fromHash = (window.location.hash.match(/workspace\\/([^/]+)/) ?? [])[1];
  const workspace = workspaces.find((entry) => entry.id === (fromHash || active)) ?? workspaces[0];
  if (!workspace) return { ok: false, error: "no workspace" };
  const requestInit = ${JSON.stringify(init ?? {})};
  const response = await fetch(base + ${JSON.stringify(pathTemplate)}.replace(":id", encodeURIComponent(workspace.id)), {
    ...requestInit,
    headers: { ...headers, ...(requestInit.headers ?? {}) },
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  return {
    ok: response.ok,
    status: response.status,
    workspaceId: workspace.id,
    workspacePath: workspace.path ?? workspace.folderPath ?? workspace.root ?? null,
    payload,
    raw: text,
  };
})()`;

async function resolveServerPort(ctx, { fresh = false } = {}) {
  if (!fresh && state.serverPort) return state.serverPort;
  const result = await ctx.eval(discoverServerPortExpr, { awaitPromise: true });
  ctx.assert(result?.ok && result.port, `Could not discover the live OpenWork server port: ${JSON.stringify(result)}`);
  state.serverPort = result.port;
  return result.port;
}

async function serverCall(ctx, pathTemplate, init, { tolerate = false } = {}) {
  // The embedded server can restart onto a new port mid-run (MCP writes);
  // discover the live port up front and re-discover once on failure.
  let result = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = await resolveServerPort(ctx, { fresh: attempt > 0 });
    try {
      result = await ctx.eval(serverCallExpr(port, pathTemplate, init), { awaitPromise: true });
      if (result && result.ok === false && /Failed to fetch|no live server/i.test(String(result.error ?? ""))) {
        throw new Error(String(result.error));
      }
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await sleep(1_500);
    }
  }
  if (!tolerate) {
    ctx.assert(result?.ok, `Server call ${pathTemplate} failed: ${result?.status ?? "?"} ${JSON.stringify(result?.payload ?? result ?? {}).slice(0, 500)}`);
  }
  if (result?.workspaceId) state.workspaceId = result.workspaceId;
  if (result?.workspacePath) state.workspacePath = result.workspacePath;
  return result;
}

async function resolveWorkspace(ctx) {
  if (state.workspaceId && state.workspacePath) {
    return { workspaceId: state.workspaceId, workspacePath: state.workspacePath };
  }
  const result = await serverCall(ctx, "/workspace/:id/mcp");
  ctx.assert(Boolean(result.workspaceId), "Could not resolve OpenWork workspace id.");
  ctx.assert(Boolean(result.workspacePath), "Could not resolve OpenWork workspace path from /workspaces.");
  return { workspaceId: result.workspaceId, workspacePath: result.workspacePath };
}

async function writeRunbookSkill(ctx) {
  const { workspacePath } = await resolveWorkspace(ctx);
  const skillDir = join(workspacePath, ".opencode", "skills", "acme-tools", SKILL_NAME);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), SKILL_CONTENT, "utf8");
  ctx.log(`Wrote marketplace-style nested skill ${SKILL_NAME} at ${skillDir}/SKILL.md`);
}

async function listMcp(ctx) {
  const result = await serverCall(ctx, "/workspace/:id/mcp");
  const items = result.payload?.items ?? [];
  ctx.assert(Array.isArray(items), "GET /workspace/:id/mcp did not return an items array.");
  return { items, engineSync: result.payload?.engineSync ?? null };
}

function findMcp(items, name) {
  return items.find((item) => item?.name === name) ?? null;
}

async function assertServerMcpSearchRouted(ctx) {
  const { items } = await listMcp(ctx);
  const entry = findMcp(items, MCP_NAME);
  ctx.assert(Boolean(entry), `${MCP_NAME} is missing from server MCP config.`);
  ctx.assert(entry.config?.routing === "search", `${MCP_NAME} routing is ${JSON.stringify(entry.config?.routing)}, expected "search".`);
  ctx.assert(entry.source === "config.remote", `${MCP_NAME} source is ${entry.source}, expected config.remote.`);
  return entry;
}

async function cleanupAndSeed(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 60_000, label: "control API" });
  await ctx.eval(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`);
  await serverCall(ctx, `/workspace/:id/mcp/${encodeURIComponent(MCP_NAME)}`, { method: "DELETE" }, { tolerate: true });
  await writeRunbookSkill(ctx);
  // Programmatic setup uses the same OpenWork server path that the app's connect
  // flows use. The real user-facing action in frame 1 is the UI switch flip;
  // the Add Custom App modal's command field is whitespace-split, which is a
  // poor fit for an eval-owned absolute fixture path.
  await serverCall(ctx, "/workspace/:id/mcp", {
    method: "POST",
    body: JSON.stringify({
      name: MCP_NAME,
      config: { type: "local", command: ["node", FIXTURE_PATH] },
    }),
  });
}

async function openMcpSettings(ctx) {
  await ctx.navigateHash("/settings/extensions/mcp");
  await ctx.expectHashIncludes("/settings/extensions/mcp");
  await ctx.waitForText("My Extensions", { timeoutMs: 30_000 });
  await ctx.waitFor("document.body.innerText.toLowerCase().includes('your apps')", { timeoutMs: 30_000, label: "Your apps section" });
  await ctx.waitForText(MCP_NAME, { timeoutMs: 30_000 });
}

async function openAcmeMcpDetails(ctx) {
  await ctx.waitFor(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => (candidate.textContent ?? '').includes(${JSON.stringify(MCP_NAME)}));
    if (!button) return false;
    button.scrollIntoView({ block: 'center' });
    if (button.nextElementSibling?.innerText?.includes(${JSON.stringify("On-demand via search")})) return true;
    button.click();
    return true;
  })()`, { timeoutMs: 30_000, label: `${MCP_NAME} row opened` });
  await ctx.waitFor(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => (candidate.textContent ?? '').includes(${JSON.stringify(MCP_NAME)}));
    return Boolean(button?.nextElementSibling?.innerText?.includes(${JSON.stringify("On-demand via search")}));
  })()`, { timeoutMs: 15_000, label: `${MCP_NAME} routing switch visible` });
}

async function flipAcmeRoutingSwitchOn(ctx) {
  const result = await ctx.waitFor(`(() => {
    const rowButton = [...document.querySelectorAll('button')]
      .find((candidate) => (candidate.textContent ?? '').includes(${JSON.stringify(MCP_NAME)}));
    const details = rowButton?.nextElementSibling;
    const control = details?.querySelector('[role="switch"][aria-label="On-demand via search"], button[aria-label="On-demand via search"]');
    if (!control) return null;
    const checked = control.getAttribute('aria-checked') === 'true' || control.hasAttribute('data-checked');
    if (checked) return 'already-on';
    control.scrollIntoView({ block: 'center' });
    control.click();
    return 'clicked-on';
  })()`, { timeoutMs: 15_000, label: "On-demand via search switch clickable" });
  ctx.log(`Routing switch result: ${result}`);
  await ctx.waitFor(`(() => {
    const rowButton = [...document.querySelectorAll('button')]
      .find((candidate) => (candidate.textContent ?? '').includes(${JSON.stringify(MCP_NAME)}));
    const details = rowButton?.nextElementSibling;
    const control = details?.querySelector('[role="switch"][aria-label="On-demand via search"], button[aria-label="On-demand via search"]');
    return Boolean(control && (control.getAttribute('aria-checked') === 'true' || control.hasAttribute('data-checked')));
  })()`, { timeoutMs: 30_000, label: "On-demand via search switch checked" });
}

async function waitForNoReloadingMcp(ctx) {
  await ctx.waitFor(
    `!document.body.innerText.includes(${JSON.stringify("Reloading MCP servers")})`,
    { timeoutMs: 30_000, label: "Reloading MCP servers toast gone" },
  );
  await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 30_000, label: "control API after MCP reload" });
}

async function readEngineMcpStatus(ctx) {
  // This is the same engine-facing source the MCP settings store uses:
  // opencodeClient.mcp.status({ directory }). We reach it through the OpenWork
  // workspace-scoped /opencode proxy using the app's own server token.
  const workspacePath = state.workspacePath ?? (await resolveWorkspace(ctx)).workspacePath;
  const port = await resolveServerPort(ctx);
  const result = await ctx.eval(`(async () => {
    const port = ${JSON.stringify(port)};
    const token = localStorage.getItem('openwork.server.token');
    const hostToken = localStorage.getItem('openwork.server.hostToken');
    const workspaceId = ${JSON.stringify(state.workspaceId ?? "")}
      || (window.location.hash.match(/workspace\\/([^/]+)/) ?? [])[1]
      || localStorage.getItem('openwork.react.activeWorkspace');
    if (!port || !token || !workspaceId) return { ok: false, error: 'missing server auth or workspace id' };
    const base = 'http://127.0.0.1:' + port;
    const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    if (hostToken) headers['X-OpenWork-Host-Token'] = hostToken;
    const query = ${JSON.stringify(workspacePath)} ? '?directory=' + encodeURIComponent(${JSON.stringify(workspacePath)}) : '';
    const paths = [
      '/workspace/' + encodeURIComponent(workspaceId) + '/opencode/mcp/status' + query,
      '/workspace/' + encodeURIComponent(workspaceId) + '/opencode/mcp' + query,
    ];
    const attempts = [];
    for (const path of paths) {
      const response = await fetch(base + path, { headers });
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch { payload = { message: text }; }
      attempts.push({ path, status: response.status, payload });
      if (response.ok) {
        const names = (() => {
          if (Array.isArray(payload)) return payload.map((item) => item?.name).filter(Boolean);
          if (!payload || typeof payload !== 'object') return [];
          for (const key of ['items', 'servers', 'data']) {
            const value = payload[key];
            if (Array.isArray(value)) return value.map((item) => item?.name).filter(Boolean);
          }
          return Object.keys(payload);
        })();
        return { ok: true, path, payload, names };
      }
    }
    return { ok: false, attempts };
  })()`, { awaitPromise: true });
  ctx.assert(result?.ok, `Could not read engine MCP status through /opencode proxy: ${JSON.stringify(result).slice(0, 800)}`);
  return result;
}

async function assertEngineDoesNotListAcme(ctx) {
  const status = await readEngineMcpStatus(ctx);
  const names = Array.isArray(status.names) ? status.names : [];
  ctx.assert(!names.includes(MCP_NAME), `Engine MCP status still lists ${MCP_NAME}: ${names.join(", ")}`);
  ctx.log(`Engine MCP status via ${status.path}: ${names.length ? names.join(", ") : "no engine MCP names"}`);
  return status;
}

async function newSession(ctx) {
  await ctx.navigateHash("/session");
  await ctx.waitFor(
    "window.__openworkControl?.listActions?.().find((a) => a.id === 'session.create_task')?.disabled === false",
    { timeoutMs: 45_000, label: "session.create_task available" },
  );
  await ctx.control("session.create_task");
  const route = await ctx.waitFor(`(() => {
    const route = window.__openworkControl.snapshot().route || window.location.hash || '';
    const match = route.match(/ses_[A-Za-z0-9]+/);
    return match?.[0] ?? null;
  })()`, { timeoutMs: 30_000, label: "brand-new session route" });
  await ctx.waitFor(
    "Boolean(document.querySelector('[contenteditable=\"true\"][data-lexical-editor=\"true\"]') || document.querySelector('textarea'))",
    { timeoutMs: 30_000, label: "composer mounted" },
  );
  // Let the freshly mounted lexical composer finish wiring up before set_text.
  await sleep(1_200);
  state.sessionId = route;
}

// One task per session: the composer's Run task submission is a task, so each
// agent question in this demo gets its own fresh session.
async function askInFreshSession(ctx, prompt) {
  await newSession(ctx);
  await setComposerText(ctx, prompt);
  await sendComposer(ctx);
}

async function setComposerText(ctx, text) {
  await ctx.waitFor(
    "window.__openworkControl?.listActions?.().some((a) => a.id === 'composer.set_text' && !a.disabled)",
    { timeoutMs: 30_000, label: "composer.set_text available" },
  );
  await ctx.control("composer.set_text", { text });
  // The lexical composer applies set_text asynchronously; sending before it
  // lands submits an empty message. Wait until the text is really there.
  await waitUntil(ctx, async () => (await readComposerText(ctx)).includes(text.slice(0, 40)), {
    timeoutMs: 15_000,
    label: "composer text applied",
  });
}

async function readComposerText(ctx) {
  const value = await ctx.eval(`(() => {
    const textarea = document.querySelector("textarea");
    if (textarea && typeof textarea.value === "string" && textarea.value.trim()) return textarea.value;
    const editable = document.querySelector('[contenteditable="true"]');
    return editable ? editable.innerText : "";
  })()`);
  return typeof value === "string" ? value : "";
}

async function sendComposer(ctx, text) {
  if (text !== undefined) await setComposerText(ctx, text);
  await ctx.waitFor(
    "window.__openworkControl?.listActions?.().find((a) => a.id === 'composer.send')?.disabled === false",
    { timeoutMs: 30_000, label: "composer.send enabled" },
  );
  await sleep(600);
  await ctx.control("composer.send");
}

async function waitForAssistantIdle(ctx, timeoutMs = 180_000) {
  await ctx.waitFor(
    "!Boolean([...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Stop'))",
    { timeoutMs, label: "assistant run finished" },
  );
}

async function readTranscriptText(ctx, count = 30) {
  const result = await ctx.control("session.read_transcript", { count });
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  return messages.map((message) => `${message.role}: ${message.text}`).join("\n\n");
}

async function latestMessageText(ctx) {
  const result = await ctx.control("session.latest_message");
  return typeof result?.text === "string" ? result.text : "";
}

async function waitForTranscript(ctx, predicate, { timeoutMs = 120_000, label }) {
  return waitUntil(ctx, async () => {
    const text = await readTranscriptText(ctx);
    return predicate(text) ? text : false;
  }, { timeoutMs, label });
}

function countToolCalls(transcript, toolName) {
  return (transcript.match(new RegExp(`\\[tool:${escapeRegExp(toolName)}\\]`, "g")) ?? []).length;
}

async function visibleText(ctx) {
  return ctx.eval("document.body.innerText");
}

async function assertCapabilitySearchApiHasGlossary(ctx) {
  const result = await serverCall(ctx, "/workspace/:id/capabilities/search?q=glossary%20term%20lookup");
  const matches = result.payload?.matches ?? [];
  const names = matches.map((match) => match?.name).filter(Boolean);
  ctx.assert(names.includes(GLOSSARY_CAPABILITY), `Capability search did not return ${GLOSSARY_CAPABILITY}: ${names.join(", ")}`);
  const match = matches.find((item) => item?.name === GLOSSARY_CAPABILITY);
  ctx.assert(match?.routing === "search", `${GLOSSARY_CAPABILITY} routing is ${match?.routing}, expected search.`);
}

async function assertCloudSearchApi(ctx) {
  const result = await serverCall(ctx, "/workspace/:id/capabilities/search?q=save%20a%20memory");
  const matches = result.payload?.matches ?? [];
  const cloudMatch = matches.find((match) => match?.source === "cloud");
  ctx.assert(Boolean(cloudMatch), `No cloud capability returned for save a memory: ${JSON.stringify(matches).slice(0, 800)}`);
  state.cloudCapabilityName = cloudMatch.name ?? state.cloudCapabilityName;
  ctx.log(`Cloud capability match: ${JSON.stringify(cloudMatch).slice(0, 500)}`);
  return cloudMatch;
}

export default {
  id: "search-routed-capabilities",
  title: "Connections and plugins are found and run via search_capabilities/execute_capability — never pasted into the harness",
  kind: "user-facing",
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("A server-managed MCP connection can be switched to on-demand capability search", {
          voiceover: vo[0],
          action: async () => {
            await cleanupAndSeed(ctx);
            await openMcpSettings(ctx);
            await openAcmeMcpDetails(ctx);
            await flipAcmeRoutingSwitchOn(ctx);
          },
          assert: async () => {
            await waitForNoReloadingMcp(ctx);
            await assertServerMcpSearchRouted(ctx);
            await ctx.expectText("On-demand via search");
            await ctx.expectText("The agent finds this connection with capability search when it needs it, instead of loading its tools into every session.");
          },
          screenshot: { name: "frame-1-routing-switch", requireText: ["On-demand via search"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("The search-routed connection remains saved in OpenWork but absent from the OpenCode engine MCP list", {
          voiceover: vo[1],
          action: async () => {
            await openMcpSettings(ctx);
            await openAcmeMcpDetails(ctx);
          },
          assert: async () => {
            await assertServerMcpSearchRouted(ctx);
            await assertEngineDoesNotListAcme(ctx);
            await ctx.expectText("On-demand");
          },
          screenshot: { name: "frame-2-engine-absence", requireText: ["On-demand"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("A plain glossary question is composed without naming tools, connections, or search", {
          voiceover: vo[2],
          action: async () => {
            await newSession(ctx);
            await setComposerText(ctx, GLOSSARY_PROMPT);
          },
          assert: async () => {
            // The witness is the composer itself: it holds exactly the plain
            // question (user messages render as structured parts, so the
            // transcript is not a reliable witness for user text).
            const composerText = await readComposerText(ctx);
            ctx.assert(composerText.trim() === GLOSSARY_PROMPT, `Composer text is ${JSON.stringify(composerText)}, expected the plain glossary question.`);
            ctx.assert(!GLOSSARY_PROMPT.toLowerCase().includes("tool") && !GLOSSARY_PROMPT.toLowerCase().includes("search"), "The prompt must not mention tools or search.");
            await ctx.waitForText("blue-forty", { timeoutMs: 15_000 });
          },
          screenshot: { name: "frame-3-plain-question", requireText: ["blue-forty"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("The agent searches capabilities and receives the glossary MCP tool as a match", {
          voiceover: vo[3],
          action: async () => {
            await sendComposer(ctx);
          },
          assert: async () => {
            const transcript = await waitForTranscript(ctx, (text) => (
              text.includes("[tool:search_capabilities]") && text.includes(GLOSSARY_CAPABILITY)
            ), { timeoutMs: 120_000, label: `search_capabilities result containing ${GLOSSARY_CAPABILITY}` });
            ctx.assert(transcript.includes("lookup_glossary"), "Glossary tool name missing from search_capabilities transcript output.");
            await assertCapabilitySearchApiHasGlossary(ctx);
            await ctx.waitForText("search capabilities", { timeoutMs: 30_000 });
          },
          screenshot: { name: "frame-4-capability-search", requireText: ["search capabilities"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        await ctx.prove("execute_capability runs the glossary MCP tool just-in-time and the answer includes the definition", {
          voiceover: vo[4],
          action: async () => {},
          assert: async () => {
            await waitForTranscript(ctx, (text) => (
              text.includes("[tool:execute_capability]") &&
              text.includes(GLOSSARY_CAPABILITY) &&
              text.toLowerCase().includes(GLOSSARY_DEFINITION)
            ), { timeoutMs: 180_000, label: "execute_capability glossary definition" });
            await ctx.waitFor(
              `document.body.innerText.toLowerCase().includes(${JSON.stringify(GLOSSARY_DEFINITION)})`,
              { timeoutMs: 60_000, label: "visible glossary definition" },
            );
            await waitForAssistantIdle(ctx);
            await ctx.expectNoText("Something went wrong");
            state.sawGlossaryDefinition = true;
          },
          screenshot: { name: "frame-5-definition-answer", requireText: [GLOSSARY_DEFINITION], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Frame 6",
      run: async (ctx) => {
        await ctx.prove("A plugin-namespaced release runbook skill is found and executed through the same capability router", {
          voiceover: vo[5],
          action: async () => {
            // Frame 3's "plain question" promise applies to the glossary turn;
            // here the user explicitly reaches for capabilities, which is how
            // plugin content is meant to be discovered.
            await askInFreshSession(ctx, "Search your capabilities for our release runbook and run what you find — what are the steps?");
          },
          assert: async () => {
            // The binding witness: an execute_capability call whose output
            // carries the skill's own content (only obtainable by running
            // skill:release-runbook through the router).
            const executeCarriedSkillContent = (text) =>
              text.split("\n").some((line) =>
                line.includes("[tool:execute_capability]") &&
                line.includes(SKILL_CAPABILITY) &&
                (line.includes("Freeze the branch") || line.includes("Announce in #releases")));
            await waitForTranscript(ctx, (text) => (
              countToolCalls(text, "search_capabilities") >= 1 &&
              text.includes(SKILL_CAPABILITY) &&
              executeCarriedSkillContent(text)
            ), { timeoutMs: 180_000, label: "release runbook read via search_capabilities -> execute_capability" });
            await waitForAssistantIdle(ctx);
            const body = await visibleText(ctx);
            state.runbookStepText = body.includes("Announce in #releases") ? "Announce in #releases" : "Freeze the branch";
            ctx.assert(body.includes(state.runbookStepText), `Runbook step ${state.runbookStepText} is not visible.`);
            state.sawRunbookViaCapabilities = true;
          },
          screenshot: { name: "frame-6-plugin-skill", requireText: ["release runbook"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Frame 7",
      run: async (ctx) => {
        await ctx.prove("When OpenWork Cloud Control is connected, capability search includes cloud matches in the same surface", {
          voiceover: vo[6],
          action: async () => {
            const { items } = await listMcp(ctx);
            const cloud = findMcp(items, "openwork-cloud");
            ctx.assert(Boolean(cloud && cloud.config?.enabled !== false), "openwork-cloud connection not present — sign into OpenWork Cloud before running frame 7");
            await askInFreshSession(ctx, "Search your capabilities: how would you save a memory for me?");
          },
          assert: async () => {
            const cloudMatch = await assertCloudSearchApi(ctx);
            const transcript = await waitForTranscript(ctx, (text) => (
              countToolCalls(text, "search_capabilities") >= 1 &&
              (text.includes(cloudMatch.name) || text.includes("postMemory") || /source[\\\": ]+cloud/i.test(text))
            ), { timeoutMs: 180_000, label: "cloud capability in search_capabilities transcript output" });
            ctx.assert(transcript.toLowerCase().includes("memory"), "Cloud capability transcript output does not mention memory.");
            await waitForAssistantIdle(ctx);
            await waitUntil(ctx, async () => {
              const latest = await latestMessageText(ctx);
              return !latest.trim().startsWith("[tool:") && /memory/i.test(latest) && (latest.includes(state.cloudCapabilityName) || /postmemory/i.test(latest) || /save/i.test(latest));
            }, { timeoutMs: 120_000, label: "assistant reply references the memory capability" });
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: { name: "frame-7-cloud-capability", requireText: ["memory"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Frame 8",
      run: async (ctx) => {
        await ctx.prove("Connections and plugin skills remain search-discovered capabilities, not engine config pasted into every session", {
          voiceover: vo[7],
          action: async () => {
            // Full circle: back to the connection that was never pasted into
            // the engine, after the agent used it (and a plugin skill, and
            // cloud capabilities) through search + execute alone.
            await openMcpSettings(ctx);
            await openAcmeMcpDetails(ctx);
          },
          assert: async () => {
            await assertEngineDoesNotListAcme(ctx);
            await assertServerMcpSearchRouted(ctx);
            ctx.assert(state.sawGlossaryDefinition === true, "The glossary definition was never observed in frame 5.");
            ctx.assert(state.sawRunbookViaCapabilities === true, "The runbook skill was never observed via execute_capability in frame 6.");
            await ctx.expectText("On-demand");
          },
          screenshot: { name: "frame-8-still-not-in-harness", requireText: ["On-demand via search"], rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};
