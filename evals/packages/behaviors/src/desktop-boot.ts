import type { Surface } from "@openwork/cdp";
import type { DenRef, DenSession } from "./den.ts";
import { createDesktopHandoffGrant } from "./den.ts";
import { control, currentHash, evalIn, go, waitFor } from "./desktop.ts";
import { ensureReadyWorkspace } from "./onboarding.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workspaceSetup(value: unknown): { ok: boolean; workspaceId: string | null } {
  if (!isRecord(value)) return { ok: false, workspaceId: null };
  return {
    ok: value.ok === true,
    workspaceId: typeof value.workspaceId === "string" ? value.workspaceId : null,
  };
}


export async function signInDesktopAs(app: Surface, den: DenRef, member: DenSession): Promise<void> {
  await waitFor(app, "Boolean(window.__openworkControl)", { timeoutMs: 120_000, label: "desktop control API" });
  await waitFor(app, "Boolean(window.__OPENWORK_ELECTRON__?.invokeDesktop)", { timeoutMs: 30_000, label: "desktop bridge" });
  const bootstrap = { baseUrl: den.webUrl, apiBaseUrl: den.webUrl, requireSignin: false, handoff: null };
  const written = await evalIn(app, `(async () => {
    const bridge = window.__OPENWORK_ELECTRON__?.invokeDesktop;
    if (!bridge) return { ok: false };
    await bridge('setDesktopBootstrapConfig', ${JSON.stringify(bootstrap)});
    return { ok: true };
  })()`, { awaitPromise: true });
  if (!isRecord(written) || written.ok !== true) throw new Error("Failed to write desktop bootstrap config.");
  await evalIn(app, `(() => {
    localStorage.setItem('openwork.den.baseUrl', ${JSON.stringify(den.webUrl)});
    localStorage.setItem('openwork.den.apiBaseUrl', ${JSON.stringify(den.webUrl)});
    let preferences = {};
    try { preferences = JSON.parse(localStorage.getItem('openwork.preferences') || '{}'); } catch {}
    localStorage.setItem('openwork.preferences', JSON.stringify({ ...preferences, selectedAgent: 'openwork' }));
    return true;
  })()`);
  await evalIn(app, "location.reload()");
  await waitFor(app, "Boolean(window.__openworkControl)", { timeoutMs: 60_000, label: "control API after bootstrap reload" });
  const grant = await createDesktopHandoffGrant(member);
  await waitFor(app, "Boolean(window.__openworkControl?.listActions?.().some((action) => action.id === 'auth.exchange-grant'))", {
    timeoutMs: 60_000,
    label: "auth.exchange-grant action registered",
  });
  await control(app, "auth.exchange-grant", { grant, baseUrl: den.webUrl });
  await waitFor(app, "Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim())", {
    timeoutMs: 45_000,
    label: "persisted den auth token",
  });
  await waitFor(app, "Boolean((localStorage.getItem('openwork.den.activeOrgId') ?? '').trim())", {
    timeoutMs: 60_000,
    label: "active org resolved",
  });
}

export async function ensureFreshWorkspace(app: Surface, input: { path: string }): Promise<string> {
  await ensureReadyWorkspace(app, input);
  await waitFor(app, "Boolean(localStorage.getItem('openwork.server.port') && localStorage.getItem('openwork.server.token') && localStorage.getItem('openwork.server.hostToken'))", {
    timeoutMs: 30_000,
    label: "OpenWork server auth for workspace setup",
  });
  let created: unknown = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    created = await evalIn(app, `(async () => {
      try {
        const port = localStorage.getItem('openwork.server.port');
        const token = localStorage.getItem('openwork.server.token');
        const hostToken = localStorage.getItem('openwork.server.hostToken');
        const base = 'http://127.0.0.1:' + port;
        const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-OpenWork-Host-Token': hostToken };
        const response = await fetch(base + '/workspaces/local', {
          method: 'POST',
          headers,
          body: JSON.stringify({ folderPath: ${JSON.stringify(input.path)}, name: 'org-connection-lifecycle-desktop', preset: 'starter' }),
        });
        const text = await response.text();
        let payload = null;
        try { payload = JSON.parse(text); } catch {}
        if (!response.ok) return { ok: false, status: response.status, text };
        const workspaceId = payload?.activeId ?? payload?.workspaces?.find((workspace) => workspace.path === ${JSON.stringify(input.path)})?.id;
        if (!workspaceId) return { ok: false, status: response.status, text: 'workspace id missing' };
        const activate = await fetch(base + '/workspaces/' + workspaceId + '/activate?persist=true', { method: 'POST', headers });
        if (!activate.ok) return { ok: false, status: activate.status, text: await activate.text() };
        localStorage.setItem('openwork.react.activeWorkspace', workspaceId);
        return { ok: true, workspaceId };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    })()`, { awaitPromise: true });
    const parsed = workspaceSetup(created);
    if (parsed.ok && parsed.workspaceId) break;
    await sleep(1_000);
  }
  const parsed = workspaceSetup(created);
  if (!parsed.ok || !parsed.workspaceId) throw new Error(`Workspace setup failed: ${JSON.stringify(created)}`);
  const workspaceId = parsed.workspaceId;
  await go(app, `/workspace/${workspaceId}/session`);
  await sleep(2_000);
  if ((await currentHash(app)).includes("/onboarding")) {
    await ensureReadyWorkspace(app, input);
    await go(app, `/workspace/${workspaceId}/session`);
  }
  await waitFor(app, "window.location.hash.includes('/workspace/')", { timeoutMs: 60_000, label: "fresh eval workspace selected" });

  let last: unknown = null;
  const extensionsDeadline = Date.now() + 60_000;
  while (Date.now() < extensionsDeadline) {
    await go(app, `/workspace/${workspaceId}/settings/extensions/connections`);
    await sleep(1_000);
    last = await evalIn(app, `(() => {
      const text = document.body.innerText;
      return {
        hash: window.location.hash,
        onOnboarding: window.location.hash.includes('/onboarding') || text.includes('Continue with organization') || text.includes('Continue to workspace'),
        hasExtensions: text.includes('Extensions'),
      };
    })()`);
    if (isRecord(last) && last.onOnboarding === true) {
      await ensureReadyWorkspace(app, input);
      continue;
    }
    if (isRecord(last) && typeof last.hash === "string" && last.hash.includes("/settings/extensions") && last.hasExtensions === true) {
      return workspaceId;
    }
  }
  throw new Error(`Extensions connections route never became ready: ${JSON.stringify(last)}`);
}

export async function deleteEvalSession(app: Surface, workspaceId: string, sessionId: string): Promise<void> {
  await go(app, `/workspace/${workspaceId}/session/${sessionId}`);
  await waitFor(app, "window.__openworkControl?.listActions?.().some((action) => action.id === 'session.delete' && action.disabled === false)", {
    timeoutMs: 30_000,
    label: "session.delete enabled for eval cleanup",
  });
  await control(app, "session.delete", { sessionId, confirmed: true });
}

export async function deleteEvalWorkspace(app: Surface, workspaceId: string): Promise<void> {
  await waitFor(app, "Boolean(window.__OPENWORK_ELECTRON__?.invokeDesktop)", {
    timeoutMs: 30_000,
    label: "desktop bridge for eval workspace cleanup",
  });
  const result = await evalIn(app, `(async () => {
    const bridge = window.__OPENWORK_ELECTRON__?.invokeDesktop;
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    const hostToken = localStorage.getItem("openwork.server.hostToken");
    if (!bridge || !port || !token || !hostToken) return { ok: false, error: "workspace cleanup bridge or server auth missing" };
    const response = await fetch("http://127.0.0.1:" + port + "/workspaces/" + encodeURIComponent(${JSON.stringify(workspaceId)}), {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token, "X-OpenWork-Host-Token": hostToken },
    });
    if (!response.ok && response.status !== 404) {
      return { ok: false, error: "workspace delete returned " + response.status + ": " + await response.text() };
    }
    await bridge("workspaceForget", ${JSON.stringify(workspaceId)}).catch(() => null);
    if (localStorage.getItem("openwork.react.activeWorkspace") === ${JSON.stringify(workspaceId)}) {
      localStorage.removeItem("openwork.react.activeWorkspace");
    }
    let sessions = {};
    try { sessions = JSON.parse(localStorage.getItem("openwork.react.sessionByWorkspace") || "{}"); } catch {}
    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) sessions = {};
    delete sessions[${JSON.stringify(workspaceId)}];
    localStorage.setItem("openwork.react.sessionByWorkspace", JSON.stringify(sessions));
    location.hash = "#/session";
    setTimeout(() => location.reload(), 0);
    return { ok: true };
  })()`, { awaitPromise: true });
  if (!isRecord(result) || result.ok !== true) {
    throw new Error(`Eval workspace cleanup failed: ${JSON.stringify(result)}`);
  }
  await waitFor(app, "Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API after eval workspace cleanup",
  });
}

export async function clearDesktopDenSession(app: Surface): Promise<void> {
  await evalIn(app, `(() => {
    for (const key of [
      "openwork.den.authToken",
      "openwork.den.activeOrgId",
      "openwork.den.activeOrgSlug",
      "openwork.den.activeOrgName",
    ]) localStorage.removeItem(key);
    setTimeout(() => location.reload(), 0);
    return true;
  })()`);
  await waitFor(app, "Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API after clearing desktop Den session",
  });
}
