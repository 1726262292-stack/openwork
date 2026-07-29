import type { Surface } from "@openwork/cdp";
import { evalIn, fill, waitFor, waitForText } from "./desktop.ts";

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
  const manualFolderVisible = await evalIn(app, 'Boolean(document.querySelector(\'input[placeholder="/workspace/my-project"]\'))');
  let entrypoint: LocalWorkspaceFacts["entrypoint"];

  if (manualFolderVisible === true) {
    // Current dev Electron exposes this documented CDP-only field because its
    // welcome CTA opens a native folder picker. The modal branch below retains
    // the older Get started -> Local workspace -> Create Workspace journey.
    entrypoint = "manual-folder";
    await fill(app, 'input[placeholder="/workspace/my-project"]', input.path);
    await waitFor(app, `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => (candidate.textContent ?? "").trim() === "Use this folder" && !candidate.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`, { timeoutMs: 15_000, label: "Use this folder" });
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
