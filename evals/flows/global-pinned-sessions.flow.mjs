import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("global-pinned-sessions");
const RUN_ID = Date.now().toString(36);
const SESSION_TITLE = `Global pinned conversation ${RUN_ID}`;
const GROUP_LABEL = `Global pinned group ${RUN_ID}`;
const SWITCH_WORKSPACE_PATH = `/tmp/openwork-global-pinned-switch-${RUN_ID}`;

let pinnedSessionId = null;
let originalWorkspaceId = null;
let originalWorkspaceLabel = null;
let groupId = null;
let secondPinnedSessionId = null;
let secondWorkspaceId = null;
let secondWorkspaceLabel = null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function currentRouteSessionId(ctx) {
  return ctx.eval(`(() => {
    const route = window.__openworkControl.snapshot().route || "";
    const match = new RegExp("session/([^/?#]+)").exec(route);
    return match ? decodeURIComponent(match[1]) : null;
  })()`);
}

async function waitForNewRouteSessionId(ctx, previousId, label) {
  return ctx.waitFor(
    `(() => {
      const route = window.__openworkControl.snapshot().route || "";
      const match = new RegExp("session/([^/?#]+)").exec(route);
      if (!match) return null;
      const sessionId = decodeURIComponent(match[1]);
      return sessionId === ${JSON.stringify(previousId)} ? null : sessionId;
    })()`,
    { timeoutMs: 45_000, label },
  );
}

async function waitForSessionListEntry(ctx, sessionId, title) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const sessions = await ctx.control("session.list_sessions");
    const match = sessions.find((session) => session.sessionId === sessionId && session.title === title);
    if (match) return match;
    await wait(500);
  }
  throw new Error(`Session ${sessionId} with title ${title} did not appear in session.list_sessions.`);
}

function globalPinnedStateExpression(sessionId) {
  return `(() => {
    const section = document.querySelector('[data-testid="global-pinned-sessions"]');
    const workspace = document.querySelector('[data-testid="workspace-sidebar-group"]');
    const entries = Array.from(document.querySelectorAll('[data-testid="global-pinned-session"]'));
    const entry = entries.find((candidate) => candidate.getAttribute('data-session-id') === ${JSON.stringify(sessionId)});
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    return {
      sectionVisible: visible(section),
      entryVisible: visible(entry),
      entryText: entry ? entry.innerText : "",
      entryWorkspaceId: entry ? entry.getAttribute('data-workspace-id') : null,
      sectionBeforeWorkspace: Boolean(section && workspace && (section.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING)),
      entryIds: entries.map((candidate) => candidate.getAttribute('data-session-id')),
    };
  })()`;
}

function workspaceSelector(workspaceId) {
  const escaped = String(workspaceId).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `[data-testid="workspace-sidebar-group"][data-workspace-id="${escaped}"]`;
}

async function setWorkspaceExpanded(ctx, workspaceId, expanded) {
  const expected = expanded ? "true" : "false";
  const result = await ctx.eval(`(() => {
    const workspace = document.querySelector(${JSON.stringify(workspaceSelector(workspaceId))});
    const button = workspace ? workspace.querySelector('[data-testid="workspace-expand-toggle"]') : null;
    if (!button) return { ok: false, reason: 'workspace toggle missing' };
    if (button.getAttribute('aria-expanded') !== ${JSON.stringify(expected)}) button.click();
    return { ok: true };
  })()`);
  ctx.assert(result?.ok === true, `Could not toggle workspace ${workspaceId}: ${JSON.stringify(result)}`);
  await ctx.waitFor(
    `(() => {
      const workspace = document.querySelector(${JSON.stringify(workspaceSelector(workspaceId))});
      const button = workspace ? workspace.querySelector('[data-testid="workspace-expand-toggle"]') : null;
      return Boolean(button && button.getAttribute('aria-expanded') === ${JSON.stringify(expected)});
    })()`,
    { timeoutMs: 10_000, label: `workspace ${workspaceId} expanded=${expanded}` },
  );
}

async function setGroupExpanded(ctx, workspaceId, label, expanded) {
  const expected = expanded ? "true" : "false";
  const result = await ctx.eval(`(() => {
    const workspace = document.querySelector(${JSON.stringify(workspaceSelector(workspaceId))});
    const button = workspace
      ? Array.from(workspace.querySelectorAll('[data-testid="session-group-toggle"]')).find((candidate) => (candidate.textContent || '').includes(${JSON.stringify(label)}))
      : null;
    if (!button) return { ok: false, reason: 'group toggle missing' };
    if (button.getAttribute('aria-expanded') !== ${JSON.stringify(expected)}) button.click();
    return { ok: true };
  })()`);
  ctx.assert(result?.ok === true, `Could not toggle group ${label}: ${JSON.stringify(result)}`);
  await ctx.waitFor(
    `(() => {
      const workspace = document.querySelector(${JSON.stringify(workspaceSelector(workspaceId))});
      const button = workspace
        ? Array.from(workspace.querySelectorAll('[data-testid="session-group-toggle"]')).find((candidate) => (candidate.textContent || '').includes(${JSON.stringify(label)}))
        : null;
      return Boolean(button && button.getAttribute('aria-expanded') === ${JSON.stringify(expected)});
    })()`,
    { timeoutMs: 10_000, label: `group ${label} expanded=${expanded}` },
  );
}

async function clickGlobalPinnedEntry(ctx, sessionId) {
  await ctx.waitFor(
    `(() => {
      const state = ${globalPinnedStateExpression(sessionId)};
      return state.entryVisible ? state : null;
    })()`,
    { timeoutMs: 15_000, label: `global pinned entry ${sessionId}` },
  );
  const clicked = await ctx.eval(`(() => {
    const entry = Array.from(document.querySelectorAll('[data-testid="global-pinned-session"]'))
      .find((candidate) => candidate.getAttribute('data-session-id') === ${JSON.stringify(sessionId)});
    const button = entry ? entry.querySelector('[data-sidebar="menu-button"]') : null;
    if (!button) return false;
    button.scrollIntoView({ block: 'center' });
    button.click();
    return true;
  })()`);
  ctx.assert(clicked === true, `Could not click global pinned entry ${sessionId}.`);
}

async function waitForGlobalPinnedWorkspaceLabel(ctx, sessionId) {
  return ctx.waitFor(
    `(() => {
      const entry = Array.from(document.querySelectorAll('[data-testid="global-pinned-session"]'))
        .find((candidate) => candidate.getAttribute('data-session-id') === ${JSON.stringify(sessionId)});
      const lines = (entry?.innerText || '').split('\\n').map((line) => line.trim()).filter(Boolean);
      return lines.length > 1 ? lines[lines.length - 1] : null;
    })()`,
    { timeoutMs: 15_000, label: `pinned workspace label for ${sessionId}` },
  );
}

function normalWorkspaceSessionExpression(workspaceId, title) {
  return `(() => {
    const workspace = document.querySelector(${JSON.stringify(workspaceSelector(workspaceId))});
    const normalRows = workspace
      ? Array.from(workspace.querySelectorAll('[data-sidebar="menu-sub-item"]'))
      : [];
    const row = normalRows.find((candidate) => (candidate.innerText || '').includes(${JSON.stringify(title)}));
    return {
      workspaceVisible: Boolean(workspace),
      rowVisible: Boolean(row),
      rowText: row ? row.innerText : "",
    };
  })()`;
}

function globalPinnedTitleEntriesExpression(title) {
  return `(() => Array.from(document.querySelectorAll('[data-testid="global-pinned-session"]'))
    .map((entry) => ({
      sessionId: entry.getAttribute('data-session-id'),
      workspaceId: entry.getAttribute('data-workspace-id'),
      text: entry.innerText || '',
    }))
    .filter((entry) => entry.text.includes(${JSON.stringify(title)})))()`;
}

export default {
  id: "global-pinned-sessions",
  title: "Pinned sessions appear in one global sidebar section and still belong to their workspace",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__openworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    const state = await ctx.waitFor(
      `(() => {
        const control = window.__openworkControl;
        const route = control.snapshot().route;
        if (route.startsWith('/welcome') || route.startsWith('/signin')) return { state: 'blocked' };
        const actions = control.listActions();
        const required = ['session.create_task', 'session.rename', 'session.pin', 'session.group.create', 'session.group.move', 'session.list_sessions', 'workspace.create'];
        const missing = required.filter((id) => !actions.some((action) => action.id === id && !action.disabled));
        return missing.length === 0 ? { state: 'ready' } : null;
      })()`,
      { timeoutMs: 45_000, label: "required session and workspace control actions" },
    );
    return state.state === "blocked"
      ? "Profile is not onboarded (welcome/signin); global pinned sessions requires a workspace."
      : null;
  },
  steps: [
    {
      name: "Pin a grouped conversation into the global Pinned section",
      run: async (ctx) => {
        await ctx.prove("A pinned conversation appears above workspaces and groups", {
          claim: "Pinning a workspace conversation duplicates it into a dedicated global Pinned section above the workspace containers.",
          voiceover: vo[0],
          action: async () => {
            const previousSessionId = await currentRouteSessionId(ctx);
            await ctx.control("session.create_task");
            pinnedSessionId = await waitForNewRouteSessionId(ctx, previousSessionId, "new pinned session route");
            ctx.assert(Boolean(pinnedSessionId), "No session id was captured for the pinned conversation.");

            const renamed = await ctx.control("session.rename", { sessionId: pinnedSessionId, title: SESSION_TITLE });
            ctx.assert(renamed?.ok === true, `Rename failed: ${JSON.stringify(renamed)}`);
            await waitForSessionListEntry(ctx, pinnedSessionId, SESSION_TITLE);

            const createdGroup = await ctx.control("session.group.create", { label: GROUP_LABEL });
            ctx.assert(
              createdGroup?.ok === true && typeof createdGroup.groupId === "string" && typeof createdGroup.workspaceId === "string",
              `Group creation failed: ${JSON.stringify(createdGroup)}`,
            );
            originalWorkspaceId = createdGroup.workspaceId;
            groupId = createdGroup.groupId;
            const moved = await ctx.control("session.group.move", {
              sessionId: pinnedSessionId,
              workspaceId: originalWorkspaceId,
              groupId,
            });
            ctx.assert(moved?.ok === true, `Group move failed: ${JSON.stringify(moved)}`);

            const pinned = await ctx.control("session.pin", { sessionId: pinnedSessionId, workspaceId: originalWorkspaceId });
            ctx.assert(pinned?.pinned === true, `Expected session to be pinned: ${JSON.stringify(pinned)}`);
            originalWorkspaceLabel = await waitForGlobalPinnedWorkspaceLabel(ctx, pinnedSessionId);
          },
          assert: async () => {
            await ctx.waitFor(
              `(() => {
                const state = ${globalPinnedStateExpression(pinnedSessionId)};
                return state.sectionVisible && state.entryVisible && state.sectionBeforeWorkspace && state.entryText.includes(${JSON.stringify(SESSION_TITLE)});
              })()`,
              { timeoutMs: 15_000, label: "global pinned section with new session above workspaces" },
            );
            const state = await ctx.eval(globalPinnedStateExpression(pinnedSessionId));
            ctx.assert(state.entryWorkspaceId === originalWorkspaceId, `Pinned entry has wrong workspace id: ${JSON.stringify(state)}`);
            ctx.assert(state.sectionBeforeWorkspace, "Pinned section is not before the workspace containers in the sidebar.");
          },
          screenshot: {
            name: "pinned-section-above-workspaces",
            requireText: ["PINNED", SESSION_TITLE],
          },
        });
      },
    },
    {
      name: "Pinned entry includes title and workspace label",
      run: async (ctx) => {
        await ctx.prove("Same-title pinned entries stay distinguishable by workspace", {
          claim: "A second pinned conversation with the same title appears as another global Pinned row, and each row shows its owning workspace label.",
          voiceover: vo[1],
          action: async () => {
            ctx.assert(Boolean(pinnedSessionId), "Pinned session id was not seeded.");
            ctx.assert(Boolean(originalWorkspaceLabel), "Original workspace label was not captured.");
            const previousSessionId = await currentRouteSessionId(ctx);
            const created = await ctx.control("workspace.create", {
              path: SWITCH_WORKSPACE_PATH,
              projectLabel: "Global pinned sessions eval",
            });
            ctx.assert(created?.path === SWITCH_WORKSPACE_PATH, `Workspace switch seed failed: ${JSON.stringify(created)}`);
            secondWorkspaceId = await ctx.waitFor(
              `(() => {
                const route = window.__openworkControl.snapshot().route || "";
                const match = new RegExp("workspace/([^/?#]+)").exec(route);
                return match ? decodeURIComponent(match[1]) : null;
              })()`,
              { timeoutMs: 15_000, label: "second workspace id in route" },
            );
            const createdSessionId = await currentRouteSessionId(ctx);
            if (createdSessionId && createdSessionId !== previousSessionId) {
              secondPinnedSessionId = createdSessionId;
            } else {
              await ctx.control("session.create_task");
              secondPinnedSessionId = await waitForNewRouteSessionId(ctx, previousSessionId, "second same-title session route");
            }

            const renamed = await ctx.control("session.rename", { sessionId: secondPinnedSessionId, title: SESSION_TITLE });
            ctx.assert(renamed?.ok === true, `Second rename failed: ${JSON.stringify(renamed)}`);
            await waitForSessionListEntry(ctx, secondPinnedSessionId, SESSION_TITLE);
            const pinned = await ctx.control("session.pin", { sessionId: secondPinnedSessionId, workspaceId: secondWorkspaceId });
            ctx.assert(pinned?.pinned === true, `Expected second session to be pinned: ${JSON.stringify(pinned)}`);
            secondWorkspaceLabel = await waitForGlobalPinnedWorkspaceLabel(ctx, secondPinnedSessionId);
          },
          assert: async () => {
            const entries = await ctx.waitFor(
              `(() => {
                const entries = ${globalPinnedTitleEntriesExpression(SESSION_TITLE)};
                return entries.length >= 2 ? entries : null;
              })()`,
              { timeoutMs: 15_000, label: "two same-title global pinned entries" },
            );
            const originalEntry = entries.find((entry) => entry.sessionId === pinnedSessionId);
            const secondEntry = entries.find((entry) => entry.sessionId === secondPinnedSessionId);
            ctx.assert(originalEntry?.text.includes(originalWorkspaceLabel), `Original pinned entry is missing workspace label: ${JSON.stringify(originalEntry)}`);
            ctx.assert(secondEntry?.text.includes(secondWorkspaceLabel), `Second pinned entry is missing workspace label: ${JSON.stringify(secondEntry)}`);
            ctx.assert(originalEntry.text.includes(SESSION_TITLE) && secondEntry.text.includes(SESSION_TITLE), "Same-title pinned entries are not both visible.");
          },
          screenshot: {
            name: "same-title-pinned-entries-show-workspaces",
            requireText: ["PINNED", SESSION_TITLE],
          },
        });
      },
    },
    {
      name: "Collapse workspace and group, switch away, then open from global Pinned",
      run: async (ctx) => {
        await ctx.prove("The global pinned entry survives collapse and opens the original workspace", {
          claim: "Collapsing the original workspace and group, then switching to another workspace, leaves the global pinned entry visible; clicking it opens the original workspace/session.",
          voiceover: vo[2],
          action: async () => {
            ctx.assert(Boolean(pinnedSessionId && originalWorkspaceId && secondPinnedSessionId), "Pinned sessions were not seeded before collapse/switch.");
            await setWorkspaceExpanded(ctx, originalWorkspaceId, true);
            await setGroupExpanded(ctx, originalWorkspaceId, GROUP_LABEL, false);
            await setWorkspaceExpanded(ctx, originalWorkspaceId, false);

            const stateWhileAway = await ctx.eval(globalPinnedStateExpression(pinnedSessionId));
            ctx.assert(stateWhileAway.entryVisible, `Pinned entry disappeared while switched away: ${JSON.stringify(stateWhileAway)}`);
            await clickGlobalPinnedEntry(ctx, secondPinnedSessionId);
            await ctx.waitFor(
              `(() => {
                const route = window.__openworkControl.snapshot().route || "";
                return route.includes(${JSON.stringify(secondPinnedSessionId)}) && route.includes(${JSON.stringify(secondWorkspaceId)});
              })()`,
              { timeoutMs: 30_000, label: "global pin opened second workspace/session route" },
            );
            await clickGlobalPinnedEntry(ctx, pinnedSessionId);
          },
          assert: async () => {
            await ctx.waitFor(
              `(() => {
                const route = window.__openworkControl.snapshot().route || "";
                return route.includes(${JSON.stringify(pinnedSessionId)}) && route.includes(${JSON.stringify(originalWorkspaceId)});
              })()`,
              { timeoutMs: 30_000, label: "global pin opened original workspace/session route" },
            );
            const state = await ctx.eval(globalPinnedStateExpression(pinnedSessionId));
            ctx.assert(state.entryVisible, `Pinned entry is not visible after reopening original workspace: ${JSON.stringify(state)}`);
          },
          screenshot: {
            name: "pinned-entry-opens-original-workspace",
            requireText: ["PINNED", SESSION_TITLE],
          },
        });
      },
    },
    {
      name: "Unpin removes only the global duplicate",
      run: async (ctx) => {
        await ctx.prove("Unpinning removes the global duplicate and keeps the normal workspace row", {
          claim: "Unpinning the conversation removes its global Pinned row while the same conversation remains in its original workspace/group.",
          voiceover: vo[3],
          action: async () => {
            ctx.assert(Boolean(pinnedSessionId && originalWorkspaceId), "Pinned session was not seeded before unpin.");
            const unpinned = await ctx.control("session.pin", { sessionId: pinnedSessionId, workspaceId: originalWorkspaceId });
            ctx.assert(unpinned?.pinned === false, `Expected session to be unpinned: ${JSON.stringify(unpinned)}`);
            await setWorkspaceExpanded(ctx, originalWorkspaceId, true);
            await setGroupExpanded(ctx, originalWorkspaceId, GROUP_LABEL, true);
          },
          assert: async () => {
            await ctx.waitFor(
              `(() => {
                const state = ${globalPinnedStateExpression(pinnedSessionId)};
                return !state.entryIds.includes(${JSON.stringify(pinnedSessionId)});
              })()`,
              { timeoutMs: 15_000, label: "unpinned session absent from global pinned section" },
            );
            const normalState = await ctx.waitFor(
              `(() => {
                const state = ${normalWorkspaceSessionExpression(originalWorkspaceId, SESSION_TITLE)};
                return state.rowVisible ? state : null;
              })()`,
              { timeoutMs: 15_000, label: "normal workspace session row remains" },
            );
            ctx.assert(normalState.rowText.includes(SESSION_TITLE), `Normal workspace row is wrong: ${JSON.stringify(normalState)}`);
          },
          screenshot: {
            name: "unpinned-normal-workspace-row-remains",
            requireText: [SESSION_TITLE],
          },
        });
      },
    },
  ],
};
