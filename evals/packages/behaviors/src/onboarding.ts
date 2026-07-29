import type { Surface } from "@openwork/cdp";
import { clickButton, evalIn, fill, go, waitFor, waitForText } from "./desktop.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const COMPOSER_INPUT_SELECTOR = [
  'textarea[placeholder="Describe your task…"]',
  'textarea[placeholder="Describe your task..."]',
  '[contenteditable="true"][aria-placeholder="Describe your task…"]',
  '[contenteditable="true"][aria-placeholder="Describe your task..."]',
].join(", ");

export interface OnboardingResetFacts {
  deletedWorkspaceIds: string[];
  route: string;
  welcomeVisible: boolean;
}

export interface LocalWorkspaceFacts {
  id: string;
  name: string;
  path: string;
  route: string;
  entrypoint: "manual-folder" | "workspace-modal";
}

export interface ReadyWorkspaceFacts {
  workspaceId: string;
  route: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function parseWorkspaceFacts(value: unknown): LocalWorkspaceFacts {
  if (!isRecord(value)) throw new Error("Workspace creation did not return facts.");
  const entrypoint = value.entrypoint;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.path !== "string" ||
    typeof value.route !== "string" ||
    (entrypoint !== "manual-folder" && entrypoint !== "workspace-modal")
  ) {
    throw new Error(`Workspace creation returned malformed facts: ${JSON.stringify(value)}`);
  }
  return { id: value.id, name: value.name, path: value.path, route: value.route, entrypoint };
}

function parseReadyWorkspaceFacts(value: unknown): ReadyWorkspaceFacts | null {
  if (!isRecord(value) || value.ready !== true || typeof value.workspaceId !== "string" || typeof value.route !== "string") {
    return null;
  }
  return { workspaceId: value.workspaceId, route: value.route };
}

async function readReadyWorkspaceFacts(app: Surface): Promise<ReadyWorkspaceFacts | null> {
  const value = await evalIn(app, `(() => {
    const route = window.location.hash;
    const match = /^#?\\/workspace\\/([^/?#]+)\\/session\\/?$/.exec(route);
    const composerVisible = document.body.innerText.includes("What do you need done?")
      && Boolean(document.querySelector(${JSON.stringify(COMPOSER_INPUT_SELECTOR)}));
    return {
      ready: Boolean(match && composerVisible),
      workspaceId: match?.[1] ?? "",
      route,
    };
  })()`);
  return parseReadyWorkspaceFacts(value);
}

async function submitFolder(app: Surface, path: string): Promise<void> {
  await fill(app, 'input[placeholder="/workspace/my-project"]', path);
  await clickButton(app, "Use this folder", { timeoutMs: 20_000 });
}

export async function ensureReadyWorkspace(
  app: Surface,
  opts: { path?: string } = {},
): Promise<ReadyWorkspaceFacts> {
  const path = opts.path?.trim() || process.cwd();
  await waitFor(app, "Boolean(window.__openworkControl)", {
    timeoutMs: 120_000,
    label: "desktop control API for ready workspace",
  });

  let folderSubmitted = false;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const ready = await readReadyWorkspaceFacts(app);
    if (ready) return ready;

    const state = await evalIn(app, `(() => {
      const route = window.location.hash;
      const text = document.body.innerText;
      const labels = [...document.querySelectorAll("button")]
        .filter((button) => !button.disabled)
        .map((button) => (button.textContent ?? "").trim());
      const workspaceMatch = /\\/workspace\\/([^/?#]+)/.exec(route);
      const continueLabel = ["Continue with organization", "Continue to workspace", "Continue"]
        .find((label) => labels.includes(label)) ?? "";
      return {
        route,
        workspaceId: workspaceMatch?.[1] ?? "",
        atSessionRoot: /^#?\\/workspace\\/[^/?#]+\\/session\\/?$/.test(route),
        hasFolderInput: Boolean(document.querySelector('input[placeholder="/workspace/my-project"]')),
        useWithoutCloud: labels.includes("Use Without Cloud"),
        skipModel: labels.includes("Skip and use the free model"),
        skipAttribution: text.includes("How did you hear about OpenWork?") && labels.includes("Skip"),
        continueWithoutModels: labels.includes("Continue without OpenWork Models"),
        continueLabel,
        onboarding: text.includes("Choose your organization")
          || text.includes("Continue to workspace")
          || text.includes("Loading available resources")
          || route.includes("/onboarding"),
        canCreate: window.__openworkControl?.listActions?.()
          .some((action) => action.id === "workspace.create" && action.disabled === false) === true,
      };
    })()`);
    if (!isRecord(state)) throw new Error("Workspace readiness state was not an object.");

    if (state.hasFolderInput === true) {
      if (!folderSubmitted) {
        await submitFolder(app, path);
        folderSubmitted = true;
      }
      await sleep(750);
      continue;
    }
    if (state.useWithoutCloud === true) {
      await clickButton(app, "Use Without Cloud");
      await sleep(500);
      continue;
    }
    if (state.skipModel === true) {
      await clickButton(app, "Skip and use the free model");
      await sleep(500);
      continue;
    }
    if (state.skipAttribution === true) {
      await clickButton(app, "Skip");
      await sleep(1_000);
      continue;
    }
    if (state.continueWithoutModels === true) {
      await clickButton(app, "Continue without OpenWork Models");
      await sleep(500);
      continue;
    }
    if (typeof state.continueLabel === "string" && state.continueLabel) {
      await clickButton(app, state.continueLabel);
      await sleep(1_000);
      continue;
    }
    if (typeof state.workspaceId === "string" && state.workspaceId && state.onboarding !== true && state.atSessionRoot !== true) {
      await go(app, `/workspace/${state.workspaceId}/session`);
      await sleep(750);
      continue;
    }
    if (state.canCreate === true && typeof state.workspaceId === "string" && !state.workspaceId) {
      const result = await evalIn(
        app,
        `window.__openworkControl.execute("workspace.create", ${JSON.stringify({ path })})`,
        { awaitPromise: true },
      );
      if (!isRecord(result) || result.ok !== true) {
        throw new Error(`Desktop workspace.create failed: ${JSON.stringify(result)}`);
      }
      await sleep(750);
      continue;
    }
    await sleep(750);
  }

  const diagnostic = await evalIn(app, `({ route: window.location.hash, text: document.body.innerText.slice(0, 500) })`);
  throw new Error(`Workspace did not reach the session composer: ${JSON.stringify(diagnostic)}`);
}

export async function resetOnboarding(app: Surface): Promise<OnboardingResetFacts> {
  await waitFor(app, "Boolean(window.__OPENWORK_ELECTRON__?.invokeDesktop)", {
    timeoutMs: 60_000,
    label: "desktop bridge for onboarding reset",
  });
  const deleted = await evalIn(app, `(async () => {
    const invoke = window.__OPENWORK_ELECTRON__.invokeDesktop;
    const ids = new Set();
    const desktop = await invoke("workspaceBootstrap").catch(() => null);
    for (const workspace of desktop?.workspaces ?? []) {
      if (typeof workspace?.id === "string") ids.add(workspace.id);
    }

    const info = await invoke("openworkServerInfo").catch(() => null);
    const baseUrl = String(info?.baseUrl || info?.connectUrl || "").replace(/\\/+$/, "");
    const headers = {};
    const token = info?.ownerToken || info?.clientToken || "";
    if (token) headers.authorization = "Bearer " + token;
    if (info?.hostToken) headers["x-openwork-host-token"] = info.hostToken;
    if (baseUrl) {
      const response = await invoke("__fetch", baseUrl + "/workspaces", {
        method: "GET",
        headers,
        timeoutMs: 8_000,
      }).catch(() => null);
      let payload = response?.body ?? response;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch { payload = {}; }
      }
      for (const workspace of payload?.workspaces ?? payload?.items ?? []) {
        if (typeof workspace?.id === "string") ids.add(workspace.id);
      }
      for (const id of ids) {
        await invoke("__fetch", baseUrl + "/workspaces/" + encodeURIComponent(id), {
          method: "DELETE",
          headers,
          timeoutMs: 8_000,
        }).catch(() => null);
      }
    }
    for (const id of ids) await invoke("workspaceForget", id).catch(() => null);

    let preferences = {};
    try { preferences = JSON.parse(localStorage.getItem("openwork.preferences") || "{}"); } catch {}
    localStorage.setItem("openwork.preferences", JSON.stringify({
      ...preferences,
      hasCompletedOnboarding: false,
    }));
    for (const key of [
      "openwork.den.authToken",
      "openwork.den.activeOrgId",
      "openwork.den.activeOrgSlug",
      "openwork.den.activeOrgName",
      "openwork.react.activeWorkspace",
      "openwork.react.sessionByWorkspace",
    ]) localStorage.removeItem(key);
    location.hash = "#/session";
    setTimeout(() => location.reload(), 0);
    return [...ids];
  })()`, { awaitPromise: true });
  const deletedWorkspaceIds = stringArray(deleted);
  await waitFor(app, "Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API after onboarding reset",
  });
  await waitFor(app, "location.hash.includes('/welcome')", { timeoutMs: 60_000, label: "welcome route" });
  await waitForText(app, "Welcome to OpenWork", { timeoutMs: 30_000 });
  const route = await evalIn(app, "location.hash");
  return {
    deletedWorkspaceIds,
    route: typeof route === "string" ? route : "",
    welcomeVisible: true,
  };
}

export async function createLocalWorkspaceViaUi(
  app: Surface,
  input: { path: string; name?: string },
): Promise<LocalWorkspaceFacts> {
  await waitFor(app, "location.hash.includes('/welcome')", { timeoutMs: 30_000, label: "welcome route" });
  let manualFolderVisible = await evalIn(app, 'Boolean(document.querySelector(\'input[placeholder="/workspace/my-project"]\'))') === true;
  if (!manualFolderVisible) {
    const useWithoutCloudVisible = await evalIn(app, `Boolean([...document.querySelectorAll("button")]
      .find((button) => (button.textContent ?? "").trim() === "Use Without Cloud" && !button.disabled))`);
    if (useWithoutCloudVisible === true) {
      await clickButton(app, "Use Without Cloud");
      await waitFor(app, 'Boolean(document.querySelector(\'input[placeholder="/workspace/my-project"]\'))', {
        timeoutMs: 15_000,
        label: "local workspace folder input",
      });
      manualFolderVisible = true;
    }
  }
  let entrypoint: LocalWorkspaceFacts["entrypoint"];

  if (manualFolderVisible) {
    // Current dev Electron exposes this field after Use Without Cloud. The
    // modal branch below retains the older local-workspace journey.
    entrypoint = "manual-folder";
    await submitFolder(app, input.path);
  } else {
    entrypoint = "workspace-modal";
    await waitFor(app, `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => (candidate.textContent ?? "").trim() === "Get started" && !candidate.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`, { timeoutMs: 15_000, label: "Get started" });
    await waitForText(app, "Local workspace", { timeoutMs: 15_000 });
    await waitFor(app, `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => (candidate.textContent ?? "").trim() === "Local workspace" && !candidate.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`, { timeoutMs: 15_000, label: "Local workspace" });
    await waitForText(app, "No folder selected yet.", { timeoutMs: 15_000 });
    const injected = await evalIn(app, `(() => {
      const placeholder = [...document.querySelectorAll("span, div, p")]
        .find((node) => (node.textContent ?? "").includes("No folder selected yet."));
      if (!placeholder) return { ok: false, reason: "folder placeholder not found" };
      const key = Object.keys(placeholder).find((candidate) => candidate.startsWith("__reactFiber$"));
      let fiber = key ? placeholder[key] : null;
      while (fiber) {
        const componentName = fiber.elementType?.name || fiber.type?.name || "";
        if (componentName === "CreateWorkspaceModal") break;
        fiber = fiber.return;
      }
      if (!fiber) return { ok: false, reason: "CreateWorkspaceModal fiber not found" };
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.queue?.dispatch) {
          hook.queue.dispatch({ type: "set", key: "selectedFolder", value: ${JSON.stringify(input.path)} });
          hook.queue.dispatch({ type: "set", key: "pickingFolder", value: false });
          return { ok: true };
        }
        hook = hook.next;
      }
      return { ok: false, reason: "folder reducer dispatch not found" };
    })()`);
    if (!isRecord(injected) || injected.ok !== true) {
      throw new Error(`Could not inject the folder chosen by the native picker: ${JSON.stringify(injected)}`);
    }
    if (input.name) {
      await evalIn(app, `(() => {
        const nameInput = document.querySelector('input[placeholder*="name" i], input[placeholder*="workspace" i]');
        if (!nameInput) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(nameInput, ${JSON.stringify(input.name)});
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        nameInput.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`);
    }
    await waitFor(app, `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => (candidate.textContent ?? "").trim() === "Create Workspace" && !candidate.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`, { timeoutMs: 15_000, label: "Create Workspace" });
  }

  await waitForText(app, "Power your first task", { timeoutMs: 120_000 });
  const raw = await evalIn(app, `(async () => {
    const invoke = window.__OPENWORK_ELECTRON__.invokeDesktop;
    const info = await invoke("openworkServerInfo");
    const baseUrl = String(info?.baseUrl || info?.connectUrl || "").replace(/\\/+$/, "");
    const headers = {};
    const token = info?.ownerToken || info?.clientToken || "";
    if (token) headers.authorization = "Bearer " + token;
    if (info?.hostToken) headers["x-openwork-host-token"] = info.hostToken;
    const response = await invoke("__fetch", baseUrl + "/workspaces", { method: "GET", headers, timeoutMs: 8_000 });
    const payload = typeof response?.body === "string" ? JSON.parse(response.body) : response?.body ?? response;
    const workspace = (payload?.workspaces ?? payload?.items ?? []).find((candidate) => candidate.path === ${JSON.stringify(input.path)});
    return {
      id: workspace?.id ?? "",
      name: workspace?.name ?? "",
      path: workspace?.path ?? "",
      route: location.hash,
      entrypoint: ${JSON.stringify(entrypoint)},
    };
  })()`, { awaitPromise: true });
  return parseWorkspaceFacts(raw);
}
