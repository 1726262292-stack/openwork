import { rm } from "node:fs/promises";

import { defineFlow, type FlowContext } from "../runner/flow.ts";
import { loadVoiceoverParagraphs } from "../runner/voiceover.ts";

const FLOW_ID = "chat-first-onboarding";
const DEFAULT_DEN_BASE_URL = "https://app.openworklabs.com";
const DEFAULT_DEN_API_BASE_URL = "https://app.openworklabs.com/api/den";
const COMPOSER_SELECTOR = '[contenteditable="true"][data-lexical-editor="true"]';
const FIRST_PROMPT = "List the files in this folder and summarize what you see.";
const SPECIFIC_FOLDER = "/tmp/openwork-eval-specific";

// Narration is loaded from the approved script (evals/voiceovers/chat-first-onboarding.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs(FLOW_ID);
if (!vo) throw new Error("Missing approved voice-over script for chat-first-onboarding.");

// Captured in Frame 3; Frame 6 proves dedupe RELATIVELY (a second automatic
// chat gets a different folder under the same root) because chat folders from
// earlier runs persist on the app host and shift the numeric suffixes.
let firstChatPath = "";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeChatFirstPrefsScript(completed: boolean): string {
  return `(() => {
    let prefs = {};
    try {
      const raw = localStorage.getItem("openwork.preferences");
      prefs = raw ? JSON.parse(raw) : {};
    } catch {
      prefs = {};
    }
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) prefs = {};
    const featureFlags = prefs.featureFlags && typeof prefs.featureFlags === "object" && !Array.isArray(prefs.featureFlags)
      ? prefs.featureFlags
      : {};
    localStorage.setItem("openwork.preferences", JSON.stringify({
      ...prefs,
      hasCompletedOnboarding: ${completed ? "true" : "false"},
      featureFlags: { ...featureFlags, chatFirstOnboarding: true },
    }));
    return true;
  })()`;
}

async function waitForDesktopBridge(ctx: FlowContext): Promise<void> {
  await ctx.waitFor("Boolean(window.__OPENWORK_ELECTRON__?.invokeDesktop)", {
    timeoutMs: 60_000,
    label: "desktop bridge",
  });
}

async function cleanupWorkspaces(ctx: FlowContext): Promise<void> {
  const result = await ctx.eval(`(async () => {
    const invoke = window.__OPENWORK_ELECTRON__.invokeDesktop;
    const info = await invoke("openworkServerInfo").catch(() => null);
    const baseUrl = info?.baseUrl || info?.connectUrl || localStorage.getItem("openwork.server.active") || "";
    const headers = {};
    const token = info?.ownerToken || info?.clientToken || localStorage.getItem("openwork.server.token") || "";
    const hostToken = info?.hostToken || localStorage.getItem("openwork.server.hostToken") || "";
    if (token) headers.authorization = "Bearer " + token;
    if (hostToken) headers["x-openwork-host-token"] = hostToken;

    const list = await invoke("workspaceBootstrap").catch(() => ({ workspaces: [] }));
    for (const workspace of list?.workspaces ?? []) {
      if (baseUrl) {
        await invoke(
          "__fetch",
          baseUrl.replace(/\\/+$/, "") + "/workspaces/" + encodeURIComponent(workspace.id),
          { method: "DELETE", headers, timeoutMs: 8_000 },
        ).catch(() => null);
      }
      await invoke("workspaceForget", workspace.id).catch(() => null);
    }

    if (baseUrl) {
      const response = await invoke("__fetch", baseUrl.replace(/\\/+$/, "") + "/workspaces", {
        method: "GET",
        headers,
        timeoutMs: 8_000,
      }).catch(() => null);
      const payload = typeof response?.body === "string" ? JSON.parse(response.body) : response?.body ?? response;
      for (const workspace of payload?.workspaces ?? payload?.items ?? []) {
        await invoke(
          "__fetch",
          baseUrl.replace(/\\/+$/, "") + "/workspaces/" + encodeURIComponent(workspace.id),
          { method: "DELETE", headers, timeoutMs: 8_000 },
        ).catch(() => null);
        await invoke("workspaceForget", workspace.id).catch(() => null);
      }
    }
    return "ok";
  })()`, { awaitPromise: true });
  ctx.assert(result === "ok", `Workspace cleanup failed: ${String(result)}`);
}

async function resetChatsRoot(ctx: FlowContext): Promise<void> {
  const root = await ctx.eval(`(async () => {
    const config = await window.__OPENWORK_ELECTRON__.invokeDesktop("chatsRootSet", null);
    return config.root;
  })()`, { awaitPromise: true });
  if (typeof root === "string") {
    const normalized = root.replace(/\\/g, "/");
    if (normalized.includes("openwork-dev-data") && normalized.endsWith("/OpenWork/chats")) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function resetToFreshChatWelcome(ctx: FlowContext): Promise<void> {
  await waitForDesktopBridge(ctx);
  await cleanupWorkspaces(ctx);
  await resetChatsRoot(ctx);
  await ctx.eval(`(async () => {
    const defaultBaseUrl = ${JSON.stringify(DEFAULT_DEN_BASE_URL)};
    const defaultApiBaseUrl = ${JSON.stringify(DEFAULT_DEN_API_BASE_URL)};
    const persisted = await window.__OPENWORK_ELECTRON__.invokeDesktop("setDesktopBootstrapConfig", {
      baseUrl: defaultBaseUrl,
      apiBaseUrl: defaultApiBaseUrl,
      requireSignin: false,
    }).catch(() => null);
    localStorage.setItem("openwork.den.baseUrl", persisted?.baseUrl || defaultBaseUrl);
    localStorage.setItem("openwork.den.apiBaseUrl", persisted?.apiBaseUrl || defaultApiBaseUrl);
    localStorage.removeItem("openwork.den.authToken");
    localStorage.removeItem("openwork.den.activeOrgId");
    localStorage.removeItem("openwork.den.activeOrgSlug");
    localStorage.removeItem("openwork.den.activeOrgName");
    localStorage.setItem("openwork.developerMode", "0");
    localStorage.removeItem("openwork.react.activeWorkspace");
    localStorage.removeItem("openwork.react.sessionByWorkspace");
    ${writeChatFirstPrefsScript(false)};
    location.hash = "#/welcome";
    location.reload();
    return true;
  })()`, { awaitPromise: true });
  await ctx.waitForText("Welcome to OpenWork", { timeoutMs: 60_000 });
}

async function stageChatWelcome(ctx: FlowContext): Promise<void> {
  await ctx.eval(`(() => {
    localStorage.setItem("openwork.developerMode", "0");
    ${writeChatFirstPrefsScript(false)};
    location.hash = "#/welcome";
    location.reload();
    return true;
  })()`);
  await ctx.waitForText("Welcome to OpenWork", { timeoutMs: 60_000 });
  await ctx.waitForText("Start chatting", { timeoutMs: 30_000 });
}

async function currentWorkspacePath(ctx: FlowContext): Promise<string> {
  const path = await ctx.eval(`(async () => {
    const list = await window.__OPENWORK_ELECTRON__.invokeDesktop("workspaceBootstrap");
    const selectedId = list.selectedId || list.activeId || list.workspaces?.[0]?.id || "";
    const workspace = (list.workspaces ?? []).find((entry) => entry.id === selectedId) || list.workspaces?.[0];
    return workspace?.path || "";
  })()`, { awaitPromise: true });
  return typeof path === "string" ? path : "";
}

async function waitForWorkspacePath(ctx: FlowContext, expected: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastPath = "";
  while (Date.now() - startedAt < timeoutMs) {
    lastPath = await currentWorkspacePath(ctx);
    if (lastPath === expected) return;
    await sleep(500);
  }
  ctx.assert(false, `Expected workspace path ${expected}, got ${lastPath}`);
}

async function assertWorkspaceDirectoryMatchesSession(ctx: FlowContext): Promise<void> {
  const proof = await ctx.eval(`(async () => {
    const parts = location.hash.split("/");
    const workspaceIndex = parts.indexOf("workspace");
    const sessionIndex = parts.indexOf("session");
    const workspaceId = workspaceIndex >= 0 ? decodeURIComponent(parts[workspaceIndex + 1] || "") : "";
    const sessionId = sessionIndex >= 0 ? decodeURIComponent(parts[sessionIndex + 1] || "") : "";
    if (!workspaceId || !sessionId) return "missing route ids: " + location.hash;

    const invoke = window.__OPENWORK_ELECTRON__.invokeDesktop;
    const list = await invoke("workspaceBootstrap");
    const workspace = (list.workspaces ?? []).find((entry) => entry.id === workspaceId);
    if (!workspace?.path) return "workspace path missing";

    const info = await invoke("openworkServerInfo");
    const baseUrl = info?.baseUrl || info?.connectUrl || "";
    if (!baseUrl) return "server url missing";
    const headers = {};
    const token = info?.ownerToken || info?.clientToken || "";
    if (token) headers.authorization = "Bearer " + token;
    if (info?.hostToken) headers["x-openwork-host-token"] = info.hostToken;
    const response = await invoke(
      "__fetch",
      baseUrl.replace(/\\/+$/, "") + "/workspace/" + encodeURIComponent(workspaceId) + "/sessions/" + encodeURIComponent(sessionId),
      { method: "GET", headers, timeoutMs: 8_000 },
    );
    if (response.status < 200 || response.status >= 300) return "session read failed: " + response.status;
    const payload = JSON.parse(response.body);
    const directory = payload?.item?.directory || "";
    return directory === workspace.path ? "ok" : "directory " + directory + " did not match " + workspace.path;
  })()`, { awaitPromise: true });
  ctx.assert(proof === "ok", `Expected the session directory to equal the chat folder path: ${String(proof)}`);
}

export default defineFlow({
  id: FLOW_ID,
  title: "First run opens a ready chat backed by an automatic per-chat folder",
  kind: "user-facing",
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("Chat-first onboarding starts on welcome without asking for a folder", {
          voiceover: vo[0],
          action: async () => {
            await resetToFreshChatWelcome(ctx);
          },
          assert: async () => {
            await ctx.expectText("Start chatting");
            await ctx.expectNoText("Pick a folder");
            await ctx.expectText("Review");
            await ctx.expectText("Reuse");
            const locationLine = await ctx.eval(`(() => {
              const el = document.querySelector('[data-testid="welcome-chats-location"]');
              return el?.textContent || "";
            })()`);
            ctx.assert(
              typeof locationLine === "string" && locationLine.includes("Chats are saved in"),
              `Expected chats location line, got ${String(locationLine)}`,
            );
            await ctx.expectText("Change location");
          },
          screenshot: {
            name: "frame-1",
            requireText: ["Start chatting", "Chats are saved in"],
            rejectText: ["Pick a folder"],
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("Start chatting creates the automatic folder and lands directly in an empty chat", {
          voiceover: vo[1],
          action: async () => {
            await ctx.clickText("Start chatting", { selector: "button", timeoutMs: 30_000 });
            await ctx.waitFor('location.hash.includes("/workspace/") && location.hash.includes("/session")', {
              timeoutMs: 120_000,
              label: "workspace session route",
            });
            await ctx.waitForText("What do you need done?", { timeoutMs: 60_000 });
          },
          assert: async () => {
            await ctx.expectText("Summarize my week");
            await ctx.expectText("Clean up a spreadsheet");
            await ctx.expectText("Draft a document");
            await ctx.expectText("Automate a web task");
            await ctx.expectNoText("Power your first task");
          },
          screenshot: {
            name: "frame-2",
            requireText: ["What do you need done?", "Summarize my week"],
            rejectText: ["Power your first task"],
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("The chat footer shows the automatic folder and the bridge agrees it is under the chats root", {
          voiceover: vo[2],
          action: async () => {
            await ctx.waitFor(`(() => {
              const text = document.querySelector('[data-testid="chat-lives-in"]')?.textContent || "";
              return text.includes("This chat lives in") && text.includes("OpenWork/chats/");
            })()`, { timeoutMs: 60_000, label: "chat location whisper" });
          },
          assert: async () => {
            const text = await ctx.eval(`document.querySelector('[data-testid="chat-lives-in"]')?.textContent || ""`);
            ctx.assert(
              typeof text === "string" && text.includes("This chat lives in") && text.includes("OpenWork/chats/"),
              `Expected chat lives-in footer, got ${String(text)}`,
            );
            await ctx.expectText("Use a specific folder");
            const proof = await ctx.eval(`(async () => {
              const invoke = window.__OPENWORK_ELECTRON__.invokeDesktop;
              const list = await invoke("workspaceBootstrap");
              const config = await invoke("chatsConfigGet");
              const workspaces = list?.workspaces ?? [];
              if (workspaces.length !== 1) return "workspace count " + workspaces.length;
              const workspacePath = workspaces[0]?.path || "";
              if (!workspacePath.includes("OpenWork") || !workspacePath.includes("chats") || !workspacePath.includes("new-chat")) {
                return "unexpected workspace path " + workspacePath;
              }
              if (!workspacePath.replace(/\\\\/g, "/").startsWith(config.root.replace(/\\\\/g, "/"))) {
                return "root " + config.root + " was not a prefix of " + workspacePath;
              }
              return "ok";
            })()`, { awaitPromise: true });
            ctx.assert(proof === "ok", `Expected one new-chat workspace under chats root: ${String(proof)}`);
            firstChatPath = await currentWorkspacePath(ctx);
            ctx.assert(firstChatPath.length > 0, "Expected to capture the first chat's workspace path.");
          },
          screenshot: { name: "frame-3", requireText: ["This chat lives in"] },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("Sending a first prompt keeps the session bound to the chat folder", {
          voiceover: vo[3],
          action: async () => {
            if (!ctx.client) {
              ctx.assert(false, "CDP client is required to type in the Lexical composer.");
              return;
            }
            await ctx.trustedClick(COMPOSER_SELECTOR, { timeoutMs: 30_000 });
            await ctx.client.send("Input.insertText", { text: FIRST_PROMPT });
            await ctx.clickText("Run task", { selector: "button", timeoutMs: 30_000 });
          },
          assert: async () => {
            await ctx.waitForText(FIRST_PROMPT, { timeoutMs: 30_000 });
            await ctx.expectNoText("Something went wrong");
            await assertWorkspaceDirectoryMatchesSession(ctx);
          },
          screenshot: { name: "frame-4", requireText: [FIRST_PROMPT] },
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        await ctx.prove("Change location opens the global chats location dialog with default and custom choices", {
          voiceover: vo[4],
          action: async () => {
            await stageChatWelcome(ctx);
            await ctx.clickText("Change location", { selector: "button", timeoutMs: 30_000 });
          },
          assert: async () => {
            await ctx.expectText("Default location");
            await ctx.expectText("Recommended");
            await ctx.expectText("Custom folder");
            await ctx.expectText("Browse");
            await ctx.expectText("Cancel");
            await ctx.expectText("Save");
            const rootShown = await ctx.eval(`(async () => {
              const config = await window.__OPENWORK_ELECTRON__.invokeDesktop("chatsConfigGet");
              const dialog = document.querySelector('[role="dialog"]');
              return Boolean(dialog?.textContent?.includes(config.displayRoot));
            })()`, { awaitPromise: true });
            ctx.assert(rootShown === true, "Expected the default card to show the chats root display path.");
          },
          screenshot: { name: "frame-5", requireText: ["Default location", "Custom folder"] },
        });
        await ctx.clickText("Cancel", { selector: '[role="dialog"] button', timeoutMs: 15_000 });
      },
    },
    {
      name: "Frame 6",
      run: async (ctx) => {
        await ctx.prove("A second automatic chat dedupes its folder, and an empty chat can switch to a specific project folder", {
          voiceover: vo[5],
          action: async () => {
            await rm(SPECIFIC_FOLDER, { recursive: true, force: true });
            await ctx.clickText("Start chatting", { selector: "button", timeoutMs: 30_000 });
            await ctx.waitFor('location.hash.includes("/workspace/") && location.hash.includes("/session")', {
              timeoutMs: 120_000,
              label: "second workspace session route",
            });
            // Dedupe proof, relative form: the second automatic chat lands in a
            // DIFFERENT new-chat-* folder than the first one.
            const dedupeDeadline = Date.now() + 60_000;
            let secondChatPath = "";
            while (Date.now() < dedupeDeadline) {
              secondChatPath = await currentWorkspacePath(ctx);
              if (secondChatPath && secondChatPath !== firstChatPath && secondChatPath.includes("new-chat")) break;
              await sleep(500);
            }
            ctx.assert(
              secondChatPath !== "" && secondChatPath !== firstChatPath && secondChatPath.includes("new-chat"),
              `Expected a deduped second chat folder distinct from ${firstChatPath}, got ${secondChatPath}`,
            );
            await ctx.waitFor(`(() => {
              const text = document.querySelector('[data-testid="chat-lives-in"]')?.textContent || "";
              return text.includes("This chat lives in");
            })()`, { timeoutMs: 60_000, label: "second chat whisper" });
            await ctx.clickText("Use a specific folder", { selector: "button", timeoutMs: 30_000 });
            await ctx.clickText("Custom folder", { selector: "button", timeoutMs: 15_000 });
            await ctx.fill('[data-testid="change-location-path"]', SPECIFIC_FOLDER, { timeoutMs: 15_000 });
            await ctx.clickText("Save", { selector: '[role="dialog"] button', timeoutMs: 15_000 });
            await ctx.waitFor('location.hash.includes("/workspace/") && location.hash.includes("/session")', {
              timeoutMs: 120_000,
              label: "specific folder workspace route",
            });
            await waitForWorkspacePath(ctx, SPECIFIC_FOLDER, 120_000);
          },
          assert: async () => {
            const workspacePath = await currentWorkspacePath(ctx);
            ctx.assert(workspacePath === SPECIFIC_FOLDER, `Expected workspace path ${SPECIFIC_FOLDER}, got ${workspacePath}`);
            const whisperPresent = await ctx.eval(`Boolean(document.querySelector('[data-testid="chat-lives-in"]'))`);
            ctx.assert(whisperPresent === false, "Expected the chats-root footer to disappear outside the chats root.");
          },
          screenshot: { name: "frame-6", rejectText: ["This chat lives in"] },
        });
      },
    },
  ],
});
