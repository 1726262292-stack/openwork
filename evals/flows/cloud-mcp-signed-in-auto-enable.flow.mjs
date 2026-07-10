import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Narration is loaded from the approved script (evals/voiceovers/cloud-mcp-signed-in-auto-enable.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs("cloud-mcp-signed-in-auto-enable");

const CLOUD_TITLE = "OpenWork Cloud Control";
const CLOUD_SERVER_NAME = "openwork-cloud";
const USER_STATE_KEY = "openwork.den.mcp.cloudControlUserState";
const SYNC_MARKER_KEY = "openwork.den.mcp.sync";
const HIDDEN_KEY = "openwork.extension.hidden.openwork-cloud";
const RUN_TAG = Date.now();
const WORKSPACE_PATH = `/tmp/openwork-cloud-mcp-signed-in-auto-enable-${RUN_TAG}`;
const CONFIGURED_STATUSES = ["Ready", "Paused", "Needs sign-in", "Offline", "Issue", "Checking"];

const state = {
  workspaceId: "",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function denApiUrl(ctx) {
  return ctx.env.OPENWORK_EVAL_DEN_API_URL.trim().replace(/\/+$/, "");
}

function bearerToken(ctx) {
  return ctx.env.OPENWORK_EVAL_DEN_TOKEN.trim();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function denFetch(ctx, path, options = {}) {
  const response = await fetch(`${denApiUrl(ctx)}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body, text };
}

async function waitForRenderer(ctx, label = "desktop renderer") {
  await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 120_000, label: `${label}: control API` });
  await ctx.waitFor("Boolean(window.__OPENWORK_ELECTRON__?.invokeDesktop)", { timeoutMs: 45_000, label: `${label}: desktop bridge` });
}

async function closeStaleChrome(ctx) {
  await ctx.eval(`(() => {
    window.dispatchEvent(new CustomEvent('openwork-close-right-pane'));
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const close = [...dialog.querySelectorAll('button')].find((button) => {
        const label = button.getAttribute('aria-label') ?? button.textContent ?? '';
        return /close|cancel/i.test(label);
      });
      close?.click();
    }
    return true;
  })()`);
}

async function setBootstrapAndSignIn(ctx) {
  await waitForRenderer(ctx, "initial app");
  const apiBase = denApiUrl(ctx);
  const bootstrap = { baseUrl: apiBase, apiBaseUrl: apiBase, requireSignin: false, handoff: null };
  const written = await ctx.eval(`(async () => {
    const bridge = window.__OPENWORK_ELECTRON__?.invokeDesktop;
    if (!bridge) return false;
    await bridge('setDesktopBootstrapConfig', ${JSON.stringify(bootstrap)});
    localStorage.setItem('openwork.den.baseUrl', ${JSON.stringify(apiBase)});
    localStorage.setItem('openwork.den.apiBaseUrl', ${JSON.stringify(apiBase)});
    localStorage.removeItem('openwork.den.authToken');
    localStorage.removeItem('openwork.den.activeOrgId');
    localStorage.removeItem('openwork.den.activeOrgSlug');
    localStorage.removeItem(${JSON.stringify(USER_STATE_KEY)});
    localStorage.removeItem(${JSON.stringify(SYNC_MARKER_KEY)});
    localStorage.removeItem(${JSON.stringify(HIDDEN_KEY)});
    return true;
  })()`, { awaitPromise: true });
  ctx.assert(written === true, "Failed to write desktop Den bootstrap config.");
  await ctx.eval("location.reload()");
  await waitForRenderer(ctx, "app after Den bootstrap reload");

  const handoff = await denFetch(ctx, "/v1/auth/desktop-handoff", {
    method: "POST",
    headers: { authorization: `Bearer ${bearerToken(ctx)}` },
    body: JSON.stringify({ desktopScheme: "openwork" }),
  });
  ctx.assert(handoff.response.ok, `Desktop handoff failed: ${handoff.response.status} ${handoff.text.slice(0, 200)}`);
  ctx.assert(typeof handoff.body?.grant === "string" && handoff.body.grant.length > 0, "Handoff response did not include a grant.");
  await ctx.control("auth.exchange-grant", { grant: handoff.body.grant, baseUrl: apiBase });
  await ctx.waitFor("Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim())", { timeoutMs: 45_000, label: "persisted Den auth token" });
  await ctx.waitFor("Boolean((localStorage.getItem('openwork.den.activeOrgId') ?? '').trim())", { timeoutMs: 60_000, label: "active Den organization" });
}

async function completeOnboardingWithoutSettings(ctx) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const view = await ctx.eval(`(() => ({
      hash: location.hash,
      text: document.body.innerText,
      hasFolderInput: Boolean(document.querySelector('input[placeholder="/workspace/my-project"]')),
      hasServerAuth: Boolean(localStorage.getItem('openwork.server.port') && localStorage.getItem('openwork.server.token')),
      hasCreateAction: Boolean(window.__openworkControl?.listActions?.().find((action) => action.id === 'workspace.create' && !action.disabled)),
    }))()`);
    if (view.hasServerAuth && (view.hash.includes("/workspace/") || view.hasCreateAction || !view.text.includes("Choose your organization"))) return;
    if (view.hasFolderInput) {
      await ctx.fill('input[placeholder="/workspace/my-project"]', WORKSPACE_PATH);
      await ctx.clickText("Use this folder", { timeoutMs: 20_000 });
      await sleep(500);
      continue;
    }
    const clicked = await ctx.eval(`(() => {
      const labels = ['Continue with organization', 'Continue to workspace', 'Continue without OpenWork Models', 'Continue'];
      const button = [...document.querySelectorAll('button')].find((candidate) => labels.includes((candidate.textContent ?? '').trim()) && !candidate.disabled);
      button?.click();
      return Boolean(button);
    })()`);
    if (!clicked && !view.hash.includes("/session")) await ctx.navigateHash("/session").catch(() => undefined);
    await sleep(750);
  }
  ctx.assert(false, "Onboarding did not reach a session/workspace state with local OpenWork server auth.");
}

async function persistDesktopSelectedWorkspace(ctx, workspaceId) {
  const selection = await ctx.eval(`(async () => {
    const invokeDesktop = window.__OPENWORK_ELECTRON__?.invokeDesktop;
    if (!invokeDesktop) return { ok: false, reason: 'missing desktop bridge' };
    const expected = ${JSON.stringify(workspaceId)};
    const summarize = (list) => {
      const selectedId = String(list?.selectedId ?? '').trim();
      const activeId = String(list?.activeId ?? '').trim();
      const watchedId = String(list?.watchedId ?? '').trim();
      return {
        selectedId,
        activeId,
        watchedId,
        resolvedId: selectedId || activeId,
        hasWorkspace: (list?.workspaces ?? []).some((workspace) => workspace?.id === expected),
      };
    };
    const afterSet = summarize(await invokeDesktop('workspaceSetSelected', expected));
    const afterBootstrap = summarize(await invokeDesktop('workspaceBootstrap'));
    return {
      ok: afterSet.resolvedId === expected && afterBootstrap.resolvedId === expected,
      afterSet,
      afterBootstrap,
    };
  })()`, { awaitPromise: true });
  ctx.assert(selection?.ok, `Desktop workspace selection did not persist for ${workspaceId}: ${JSON.stringify(selection)}`);
  return selection;
}

async function assertDesktopSelectedWorkspace(ctx, label) {
  ctx.assert(Boolean(state.workspaceId), "No eval workspace id recorded.");
  const selection = await ctx.eval(`(async () => {
    const invokeDesktop = window.__OPENWORK_ELECTRON__?.invokeDesktop;
    if (!invokeDesktop) return { ok: false, reason: 'missing desktop bridge' };
    const expected = ${JSON.stringify(state.workspaceId)};
    const list = await invokeDesktop('workspaceBootstrap');
    const selectedId = String(list?.selectedId ?? '').trim();
    const activeId = String(list?.activeId ?? '').trim();
    const watchedId = String(list?.watchedId ?? '').trim();
    const resolvedId = selectedId || activeId;
    return {
      ok: resolvedId === expected,
      selectedId,
      activeId,
      watchedId,
      resolvedId,
      hasWorkspace: (list?.workspaces ?? []).some((workspace) => workspace?.id === expected),
    };
  })()`, { awaitPromise: true });
  ctx.assert(selection?.ok, `${label}: expected desktop-selected workspace ${state.workspaceId}, got ${JSON.stringify(selection)}`);
  return selection;
}

async function waitForLocalOpenworkServer(ctx, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await ctx.eval(`(async () => {
      const port = localStorage.getItem('openwork.server.port');
      const token = localStorage.getItem('openwork.server.token');
      const hostToken = localStorage.getItem('openwork.server.hostToken');
      if (!port || !token) return { ok: false, reason: 'missing server auth', port, hasToken: Boolean(token) };
      const headers = { authorization: 'Bearer ' + token };
      if (hostToken) headers['x-openwork-host-token'] = hostToken;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3_000);
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/health', {
          headers,
          cache: 'no-store',
          signal: controller.signal,
        });
        const text = await response.text().catch(() => '');
        return { ok: response.ok, status: response.status, port, hasToken: true, text: text.slice(0, 200) };
      } catch (error) {
        return { ok: false, port, hasToken: true, error: error instanceof Error ? error.message : String(error) };
      } finally {
        clearTimeout(timeout);
      }
    })()`, { awaitPromise: true }).catch((error) => ({ ok: false, error: errorMessage(error) }));
    if (last?.ok) return last;
    await sleep(750);
  }
  ctx.assert(false, `Local OpenWork server did not become healthy before workspace creation. Last witness: ${JSON.stringify(last)}`);
  return last;
}

async function createOrActivateLocalEvalWorkspace(ctx, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await ctx.eval(`(async () => {
      const port = localStorage.getItem('openwork.server.port');
      const token = localStorage.getItem('openwork.server.token');
      const hostToken = localStorage.getItem('openwork.server.hostToken');
      if (!port || !token) return { ok: false, transient: true, reason: 'missing server auth', port, hasToken: Boolean(token) };
      const base = 'http://127.0.0.1:' + port;
      const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + token };
      if (hostToken) headers['x-openwork-host-token'] = hostToken;
      let response = null;
      let text = '';
      try {
        response = await fetch(base + '/workspaces/local', {
          method: 'POST',
          headers,
          body: JSON.stringify({ folderPath: ${JSON.stringify(WORKSPACE_PATH)}, name: 'cloud-mcp-signed-in-auto-enable', preset: 'starter' }),
        });
        text = await response.text();
      } catch (error) {
        return { ok: false, transient: true, stage: 'create', port, error: error instanceof Error ? error.message : String(error) };
      }
      let payload = null;
      try { payload = JSON.parse(text); } catch {}
      if (!response.ok) return { ok: false, transient: response.status >= 500, stage: 'create', status: response.status, text };
      const workspaces = payload?.workspaces ?? payload?.items ?? [];
      const workspaceId = payload?.activeId ?? payload?.workspace?.id ?? workspaces.find((workspace) => workspace.path === ${JSON.stringify(WORKSPACE_PATH)})?.id;
      if (!workspaceId) return { ok: false, transient: false, stage: 'create', status: response.status, text: 'workspace id missing', payload };
      let activated = null;
      let activatedText = '';
      try {
        activated = await fetch(base + '/workspaces/' + encodeURIComponent(workspaceId) + '/activate?persist=true', { method: 'POST', headers });
        activatedText = await activated.text();
      } catch (error) {
        return { ok: false, transient: true, stage: 'activate', workspaceId, port, error: error instanceof Error ? error.message : String(error) };
      }
      if (!activated.ok) return { ok: false, transient: activated.status >= 500, stage: 'activate', workspaceId, status: activated.status, text: activatedText };
      localStorage.setItem('openwork.react.activeWorkspace', workspaceId);
      return { ok: true, workspaceId };
    })()`, { awaitPromise: true }).catch((error) => ({ ok: false, transient: true, error: errorMessage(error) }));
    if (last?.ok && last.workspaceId) return last;
    if (last && last.transient === false) {
      ctx.assert(false, `Failed to create/select local eval workspace: ${JSON.stringify(last)}`);
    }
    await sleep(750);
  }
  ctx.assert(false, `Timed out creating/selecting local eval workspace. Last witness: ${JSON.stringify(last)}`);
  return last;
}

async function ensureLocalEvalWorkspace(ctx) {
  await ctx.navigateHash("/session");
  await completeOnboardingWithoutSettings(ctx);
  await waitForLocalOpenworkServer(ctx);
  const created = await createOrActivateLocalEvalWorkspace(ctx);
  ctx.assert(created?.ok && created.workspaceId, `Failed to create/select local eval workspace: ${JSON.stringify(created)}`);
  state.workspaceId = created.workspaceId;
  await persistDesktopSelectedWorkspace(ctx, state.workspaceId);
  await ctx.navigateHash(`/workspace/${state.workspaceId}/session`);
  await ctx.waitFor("location.hash.includes('/workspace/') && location.hash.includes('/session')", { timeoutMs: 45_000, label: "eval workspace session route" });
  await ctx.clickText("Continue without OpenWork Models", { timeoutMs: 5_000 }).catch(() => undefined);
  await ctx.waitForText("Search sessions", { timeoutMs: 45_000 });
}

function rawCloudMcpExpr(workspaceId, apiBase) {
  return `(async () => {
    const port = localStorage.getItem('openwork.server.port');
    const token = localStorage.getItem('openwork.server.token');
    const hostToken = localStorage.getItem('openwork.server.hostToken');
    const activeOrgId = (localStorage.getItem('openwork.den.activeOrgId') ?? '').trim();
    const denToken = (localStorage.getItem('openwork.den.authToken') ?? '').trim();
    const base = port ? 'http://127.0.0.1:' + port : '';
    const headers = token ? { authorization: 'Bearer ' + token } : {};
    if (hostToken) headers['x-openwork-host-token'] = hostToken;
    let payload = null;
    let status = 0;
    let text = '';
    if (base && token) {
      const response = await fetch(base + '/workspace/' + encodeURIComponent(${JSON.stringify(workspaceId)}) + '/mcp', { headers });
      status = response.status;
      text = await response.text();
      try { payload = JSON.parse(text); } catch {}
    }
    const items = payload?.items ?? [];
    const entry = items.find((item) => item.name === ${JSON.stringify(CLOUD_SERVER_NAME)}) ?? null;
    const markerRaw = localStorage.getItem(${JSON.stringify(SYNC_MARKER_KEY)});
    let marker = null;
    try {
      const parsed = JSON.parse(markerRaw ?? 'null');
      const candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.markers) ? parsed.markers : parsed ? [parsed] : [];
      marker = candidates.find((candidate) => {
        if (!candidate || candidate.orgId !== activeOrgId || candidate.workspaceId !== ${JSON.stringify(workspaceId)}) return false;
        let markerPort = '';
        try { markerPort = new URL(candidate.serverBaseUrl).port; } catch {}
        let markerDenBaseUrl = String(candidate.denBaseUrl ?? '');
        while (markerDenBaseUrl.endsWith('/')) markerDenBaseUrl = markerDenBaseUrl.slice(0, -1);
        return markerPort === String(port ?? '') && markerDenBaseUrl === ${JSON.stringify(apiBase)};
      }) ?? null;
    } catch {}
    const config = entry?.config ?? null;
    const authHeader = config?.headers?.Authorization ?? config?.headers?.authorization ?? '';
    const url = typeof config?.url === 'string' ? config.url : '';
    const enabled = config ? config.enabled !== false : null;
    const markerFresh = marker ? Date.parse(marker.expiresAt) > Date.now() : false;
    return {
      ok: Boolean(status >= 200 && status < 300),
      status,
      text,
      workspaceId: ${JSON.stringify(workspaceId)},
      signedIn: Boolean(denToken && activeOrgId),
      activeOrgId,
      entry,
      entryNames: items.map((item) => item.name),
      engineSync: payload?.engineSync ?? null,
      marker,
      markerFresh,
      userIntent: localStorage.getItem(${JSON.stringify(USER_STATE_KEY)}),
      entryReady: Boolean(config && enabled === true && url.endsWith('/mcp/agent') && authHeader.startsWith('Bearer ') && config.oauth === false),
      entryPaused: Boolean(config && enabled === false),
    };
  })()`;
}

async function readRawCloudMcp(ctx) {
  ctx.assert(Boolean(state.workspaceId), "No eval workspace id recorded.");
  return ctx.eval(rawCloudMcpExpr(state.workspaceId, denApiUrl(ctx)), { awaitPromise: true });
}

async function waitForRawCloudMcp(ctx, label, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await readRawCloudMcp(ctx).catch((error) => ({ error: errorMessage(error) }));
    if (predicate(last)) return last;
    await sleep(750);
  }
  ctx.assert(false, `${label} did not become true. Last raw witness: ${JSON.stringify(last)}`);
  return last;
}

async function removeCloudMcpRuntimeEntry(ctx) {
  const cleanup = await ctx.eval(`(async () => {
    localStorage.setItem(${JSON.stringify(USER_STATE_KEY)}, 'removed');
    localStorage.removeItem(${JSON.stringify(SYNC_MARKER_KEY)});
    localStorage.removeItem(${JSON.stringify(HIDDEN_KEY)});
    const port = localStorage.getItem('openwork.server.port');
    const token = localStorage.getItem('openwork.server.token');
    const hostToken = localStorage.getItem('openwork.server.hostToken');
    if (!port || !token) return { ok: false, reason: 'missing server auth' };
    const headers = { authorization: 'Bearer ' + token };
    if (hostToken) headers['x-openwork-host-token'] = hostToken;
    const response = await fetch('http://127.0.0.1:' + port + '/workspace/' + encodeURIComponent(${JSON.stringify(state.workspaceId)}) + '/mcp/' + encodeURIComponent(${JSON.stringify(CLOUD_SERVER_NAME)}), {
      method: 'DELETE',
      headers,
    });
    return { ok: response.ok, status: response.status, text: await response.text().catch(() => '') };
  })()`, { awaitPromise: true });
  ctx.assert(cleanup?.ok, `Cloud MCP cleanup failed: ${JSON.stringify(cleanup)}`);
  await waitForRawCloudMcp(ctx, "openwork-cloud removed while intent blocks resurrection", (raw) => raw?.ok && !raw.entry, 15_000);
  await ctx.eval(`(() => {
    localStorage.removeItem(${JSON.stringify(USER_STATE_KEY)});
    localStorage.removeItem(${JSON.stringify(SYNC_MARKER_KEY)});
    localStorage.removeItem(${JSON.stringify(HIDDEN_KEY)});
    return true;
  })()`);
}

async function establishCleanBaseline(ctx) {
  await closeStaleChrome(ctx);
  await ctx.navigateHash(`/workspace/${state.workspaceId}/session`);
  await ctx.waitFor("location.hash.includes('/session') && !location.hash.includes('/settings')", { timeoutMs: 30_000, label: "session route before final cleanup" });
  await ctx.waitForText("Search sessions", { timeoutMs: 45_000 });
  // Keep the final cleanup last: after the intent + marker are cleared, the
  // next reconciliation should be the frame-1 app-load startup hook.
  await removeCloudMcpRuntimeEntry(ctx);
}

async function reloadAppAndWait(ctx, label = "app reload") {
  await assertDesktopSelectedWorkspace(ctx, `desktop selection before ${label}`);
  await ctx.eval("location.reload()").catch((error) => {
    ctx.log(`location.reload control call ended during reload: ${errorMessage(error)}`);
  });
  await waitForRenderer(ctx, `app after ${label}`);
  await ctx.waitFor("Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim() && (localStorage.getItem('openwork.den.activeOrgId') ?? '').trim())", {
    timeoutMs: 60_000,
    label: `signed-in Den session after ${label}`,
  });
  await assertDesktopSelectedWorkspace(ctx, `desktop selection after ${label}`);
  await ctx.waitFor(`(() => {
    const hash = location.hash;
    return hash.includes(${JSON.stringify(`/workspace/${state.workspaceId}/session`)}) && !hash.includes('/settings');
  })()`, { timeoutMs: 45_000, label: `pinned workspace route after ${label}` });
  await ctx.waitForText("Search sessions", { timeoutMs: 45_000 });
}

const hydratedExtensionsViewReadyExpr = () => `(() => {
  const visible = (element) => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length > 0));
  const buttons = [...document.querySelectorAll('button')];
  const showHidden = buttons.some((button) => visible(button) && !button.disabled && (button.textContent ?? '').trim().startsWith('Show hidden'));
  const publicEntry = buttons.some((button) => {
    const text = button.textContent ?? '';
    return visible(button) && !button.disabled && (text.includes('Notion') || text.includes('Linear'));
  });
  return showHidden && publicEntry;
})()`;

const extensionsSectionAnimationsSettledExpr = () => `(() => {
  const visible = (element) => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length > 0));
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')];
  const heading = headings.find((candidate) => visible(candidate) && (candidate.textContent ?? '').trim() === 'Extensions');
  if (!heading) return false;
  const section = heading.closest('section') ?? [...document.querySelectorAll('section')].find((candidate) => {
    const text = candidate.textContent ?? '';
    return visible(candidate) && text.includes('Add Custom App') && text.includes('Show hidden');
  });
  if (!section) return false;
  return !section.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running');
})()`;

async function openExtensionsView(ctx) {
  await ctx.navigateHash(`/workspace/${state.workspaceId}/session`);
  await ctx.waitFor(`(() => {
    const hash = location.hash;
    return hash.includes(${JSON.stringify(`/workspace/${state.workspaceId}/session`)}) && !hash.includes('/settings');
  })()`, { timeoutMs: 30_000, label: "session route before Settings Extensions view" });
  await ctx.waitFor("Boolean(document.querySelector('button[aria-label=\"Settings\"]'))", { timeoutMs: 30_000, label: "Settings button" });
  const clickedSettings = await ctx.eval(`(() => {
    const button = document.querySelector('button[aria-label="Settings"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  ctx.assert(clickedSettings, "Could not click the user-facing Settings button.");
  await ctx.waitFor(`location.hash.includes(${JSON.stringify(`/workspace/${state.workspaceId}/settings`)})`, { timeoutMs: 30_000, label: "workspace Settings route" });
  await ctx.waitForText("Settings", { timeoutMs: 30_000 });
  await ctx.waitFor(`(() => {
    const sidebars = [...document.querySelectorAll('[data-slot="sidebar"], [data-sidebar="sidebar"]')];
    const buttons = sidebars.flatMap((sidebar) => [...sidebar.querySelectorAll('button[data-sidebar="menu-button"], button[data-slot="sidebar-menu-button"], button')]);
    return buttons.some((candidate) => (candidate.textContent ?? '').trim() === 'Extensions' && !candidate.disabled);
  })()`, { timeoutMs: 30_000, label: "Settings sidebar Extensions button" });
  const clickedExtensions = await ctx.eval(`(() => {
    const sidebars = [...document.querySelectorAll('[data-slot="sidebar"], [data-sidebar="sidebar"]')];
    const buttons = sidebars.flatMap((sidebar) => [...sidebar.querySelectorAll('button[data-sidebar="menu-button"], button[data-slot="sidebar-menu-button"], button')]);
    const button = buttons.find((candidate) => (candidate.textContent ?? '').trim() === 'Extensions' && !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  ctx.assert(clickedExtensions, "Could not click the Settings sidebar Extensions button.");
  await ctx.waitFor(`location.hash.includes(${JSON.stringify(`/workspace/${state.workspaceId}/settings/extensions`)})`, { timeoutMs: 30_000, label: "workspace Settings Extensions route" });
  await ctx.waitForText("Add Custom App", { timeoutMs: 45_000 });
  await ctx.waitFor("document.body.innerText.includes('Show hidden')", { timeoutMs: 30_000, label: "Show hidden control in Extensions view" });
  await ctx.waitFor(hydratedExtensionsViewReadyExpr(), { timeoutMs: 45_000, label: "hydrated Extensions view controls and public cards" });
  await ctx.waitFor(extensionsSectionAnimationsSettledExpr(), { timeoutMs: 15_000, label: "Extensions section animations settled" });
}

async function revealHidden(ctx) {
  const showing = await ctx.eval("document.body.innerText.includes('Showing hidden')");
  if (!showing) await ctx.clickText("Show hidden", { timeoutMs: 30_000 });
  await ctx.waitFor("document.body.innerText.includes('Showing hidden')", { timeoutMs: 15_000, label: "hidden extensions revealed" });
}

async function visiblePublicDirectoryEntry(ctx) {
  await ctx.waitFor("document.body.innerText.includes('Notion') || document.body.innerText.includes('Linear')", {
    timeoutMs: 45_000,
    label: "public MCP directory entry",
  });
  return await ctx.eval("document.body.innerText.includes('Notion') ? 'Notion' : 'Linear'");
}

const cloudRowExpr = (statuses) => `(() => {
  const statuses = ${JSON.stringify(statuses)};
  const buttons = [...document.querySelectorAll('button')];
  return buttons.some((button) => {
    const text = button.textContent ?? '';
    return text.includes(${JSON.stringify(CLOUD_TITLE)}) && statuses.some((status) => text.includes(status));
  });
})()`;

const scrollCloudRowExpr = (statuses = CONFIGURED_STATUSES) => `(() => {
  const statuses = ${JSON.stringify(statuses)};
  const buttons = [...document.querySelectorAll('button')];
  const row = buttons.find((button) => {
    const text = button.textContent ?? '';
    return text.includes(${JSON.stringify(CLOUD_TITLE)}) && statuses.some((status) => text.includes(status));
  });
  row?.scrollIntoView({ block: 'center' });
  return Boolean(row);
})()`;

const expandAndClickDetailExpr = (statuses, label) => `(() => {
  const detail = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === ${JSON.stringify(label)} && !button.disabled);
  if (detail) {
    detail.scrollIntoView({ block: 'center' });
    detail.click();
    return true;
  }
  const statuses = ${JSON.stringify(statuses)};
  const row = [...document.querySelectorAll('button')].find((button) => {
    const text = button.textContent ?? '';
    return text.includes(${JSON.stringify(CLOUD_TITLE)}) && statuses.some((status) => text.includes(status));
  });
  if (row) {
    row.scrollIntoView({ block: 'center' });
    row.click();
  }
  return false;
})()`;

function assertGeneratedExpressionParses(expression) {
  new Function(`return ${expression};`);
}

export function validateCloudMcpGeneratedExpressionsForTest() {
  assertGeneratedExpressionParses(rawCloudMcpExpr("workspace_eval_validation", "https://app.openwork.test/api/den"));
  assertGeneratedExpressionParses(cloudRowExpr(["Ready"]));
  assertGeneratedExpressionParses(scrollCloudRowExpr(["Ready"]));
  assertGeneratedExpressionParses(expandAndClickDetailExpr(["Ready"], "Disable"));
  assertGeneratedExpressionParses(hydratedExtensionsViewReadyExpr());
  assertGeneratedExpressionParses(extensionsSectionAnimationsSettledExpr());
  return true;
}

async function waitForCloudRow(ctx, statuses, label, timeoutMs = 60_000) {
  await ctx.waitFor(cloudRowExpr(statuses), { timeoutMs, label });
  await ctx.eval(scrollCloudRowExpr(statuses));
}

async function waitForSignedInReadyCloudMcp(ctx) {
  return waitForRawCloudMcp(ctx, "signed-in enabled openwork-cloud MCP", (raw) =>
    raw?.signedIn === true &&
    raw?.entryReady === true &&
    raw?.engineSync?.status === "ok" &&
    raw?.markerFresh === true,
  90_000);
}

export default {
  id: "cloud-mcp-signed-in-auto-enable",
  title: "Signed-in users get OpenWork Cloud Control automatically without cluttering Extensions",
  kind: "user-facing",
  spec: "evals/voiceovers/cloud-mcp-signed-in-auto-enable.md",
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_TOKEN"],
  steps: [
    {
      name: "Setup: signed-in clean desktop baseline outside Settings",
      run: async (ctx) => {
        ctx.assert(vo.length === 4, `Expected 4 approved voiceover paragraphs, got ${vo.length}.`);
        await setBootstrapAndSignIn(ctx);
        await ensureLocalEvalWorkspace(ctx);
        await establishCleanBaseline(ctx);
      },
    },
    {
      name: "Frame 1 — signed-in launch auto-configures Cloud MCP without Settings",
      run: async (ctx) => {
        let preLoadWitness = null;
        let rawWitness = null;
        await ctx.prove("A signed-in app load configures OpenWork Cloud Control in the background without opening Settings", {
          voiceover: vo[0],
          action: async () => {
            preLoadWitness = await readRawCloudMcp(ctx);
            ctx.assert(preLoadWitness?.ok && !preLoadWitness.entry && preLoadWitness.userIntent === null && preLoadWitness.marker === null, `Expected clean pre-load baseline, got ${JSON.stringify(preLoadWitness)}`);
            await reloadAppAndWait(ctx, "startup reload");
          },
          assert: async () => {
            ctx.assert(preLoadWitness?.ok && !preLoadWitness.entry, `Cloud MCP was not removed immediately before app load: ${JSON.stringify(preLoadWitness)}`);
            const auth = await ctx.control("auth.status");
            ctx.assert(auth?.status === "signed_in", `Expected signed_in auth status, got ${JSON.stringify(auth)}.`);
            rawWitness = await waitForSignedInReadyCloudMcp(ctx);
            ctx.assert(!String(await ctx.eval("location.hash")).includes("/settings"), "Frame 1 must remain off Settings.");
            ctx.assert(rawWitness.entry.config.oauth === false, "Cloud MCP must be header-authenticated with oauth:false.");
            ctx.assert(rawWitness.entry.config.headers.Authorization.startsWith("Bearer "), "Cloud MCP Authorization header must be bearer.");
          },
          screenshot: {
            name: "cloud-mcp-session-auto-enabled",
            claim: "The user is on the session surface after app load while the server already has an enabled, header-authenticated OpenWork Cloud Control MCP.",
            requireText: ["Search sessions"],
            rejectText: ["Something went wrong", "Choose your organization"],
            hashIncludes: "/session",
          },
        });
      },
    },
    {
      name: "Frame 2 — Extensions view stays uncluttered by default",
      run: async (ctx) => {
        await ctx.prove("The normal Extensions settings view hides OpenWork Cloud Control even though the backend is configured", {
          voiceover: vo[1],
          action: async () => {
            await openExtensionsView(ctx);
          },
          assert: async () => {
            const publicEntry = await visiblePublicDirectoryEntry(ctx);
            ctx.assert(publicEntry === "Notion" || publicEntry === "Linear", `Expected Notion or Linear, got ${publicEntry}.`);
            await ctx.expectText("Show hidden", { timeoutMs: 30_000 });
            await ctx.expectNoText(CLOUD_TITLE);
            const rawWitness = await readRawCloudMcp(ctx);
            ctx.assert(rawWitness.entryReady === true, `Backend Cloud MCP should still be enabled: ${JSON.stringify(rawWitness)}`);
          },
          screenshot: {
            name: "cloud-mcp-hidden-default",
            claim: "The Extensions settings view shows public MCP directory entries and the Show hidden control, but not OpenWork Cloud Control.",
            requireText: ["Show hidden", "Add Custom App"],
            rejectText: [CLOUD_TITLE, "Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
    {
      name: "Frame 3 — Show hidden reveals configured and ready Cloud Control",
      run: async (ctx) => {
        await ctx.prove("Show hidden in the Extensions settings view reveals OpenWork Cloud Control as a configured Ready connection", {
          voiceover: vo[2],
          action: async () => {
            await revealHidden(ctx);
          },
          assert: async () => {
            await ctx.expectText("Showing hidden", { timeoutMs: 15_000 });
            await ctx.expectText(CLOUD_TITLE, { timeoutMs: 30_000 });
            await waitForCloudRow(ctx, ["Ready"], "configured OpenWork Cloud Control row is Ready", 90_000);
            const rawWitness = await readRawCloudMcp(ctx);
            ctx.assert(rawWitness.entryReady === true, `Backend Cloud MCP should be enabled/header-auth/oauth:false: ${JSON.stringify(rawWitness)}`);
          },
          screenshot: {
            name: "cloud-mcp-revealed-ready",
            claim: "After Show hidden in the Extensions settings view, OpenWork Cloud Control is visible as a configured Ready app.",
            requireText: [CLOUD_TITLE, "Ready", "Showing hidden"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
    {
      name: "Frame 4 — Pause survives reload and startup reconciliation",
      run: async (ctx) => {
        await ctx.prove("Pausing OpenWork Cloud Control persists across app reload and the startup reconciler does not re-enable it", {
          voiceover: vo[3],
          action: async () => {
            await waitForCloudRow(ctx, ["Ready"], "ready Cloud Control row before disabling", 60_000);
            await ctx.waitFor(expandAndClickDetailExpr(["Ready"], "Disable"), {
              timeoutMs: 30_000,
              label: "expand OpenWork Cloud Control and click Disable",
            });
            await waitForCloudRow(ctx, ["Paused"], "OpenWork Cloud Control shows Paused before reload", 45_000);
            await ctx.waitFor(`localStorage.getItem(${JSON.stringify(USER_STATE_KEY)}) === 'disabled'`, {
              timeoutMs: 20_000,
              label: "disabled Cloud MCP intent persisted",
            });
            await ctx.navigateHash(`/workspace/${state.workspaceId}/session`);
            await ctx.waitFor("location.hash.includes('/session') && !location.hash.includes('/settings')", { timeoutMs: 30_000, label: "session route before pause reload" });
            await reloadAppAndWait(ctx, "return reload");
            await openExtensionsView(ctx);
            await revealHidden(ctx);
          },
          assert: async () => {
            await waitForRawCloudMcp(ctx, "paused Cloud MCP remains disabled after startup", (raw) =>
              raw?.entryPaused === true && raw?.userIntent === "disabled" && raw?.signedIn === true,
            20_000);
            await waitForCloudRow(ctx, ["Paused"], "OpenWork Cloud Control row stays Paused after reload", 45_000);
            await ctx.waitFor("!(document.body.innerText ?? '').includes('new notifications')", {
              timeoutMs: 15_000,
              label: "notification toast gone before paused screenshot",
            });
            const rawWitness = await readRawCloudMcp(ctx);
            ctx.assert(rawWitness.entry?.config?.enabled === false, `Backend entry was resurrected: ${JSON.stringify(rawWitness)}`);
            ctx.assert(rawWitness.userIntent === "disabled", `Disabled intent was lost: ${JSON.stringify(rawWitness)}`);
          },
          screenshot: {
            name: "cloud-mcp-paused-after-reload",
            claim: "OpenWork Cloud Control remains Paused in the Extensions settings view after reloading the app and revealing hidden extensions again.",
            requireText: [CLOUD_TITLE, "Paused", "Showing hidden"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
  ],
};
