import { timed } from "@openwork/timeline";
import { evalIn, waitFor, waitUntilInteractive } from "./desktop.ts";
import type { Surface } from "@openwork/cdp";

/**
 * Seeds arrange state through the product's own seams so a spec spends its time
 * on its actual subject. A spec whose subject IS the UI path (first-run
 * onboarding, for example) must drive the UI instead.
 *
 * Honesty rule: every seeded state needs at least one journey spec that reaches
 * it through the UI, otherwise a seed can drift into a state the product can no
 * longer actually produce.
 */

export interface SeededWorkspace {
  workspaceId: string;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Create + activate a local workspace via the local OpenWork server, the path
 * the legacy lifecycle flow proved (POST /workspaces/local then activate).
 * Reached through the UI by the first-run journey spec.
 */
export async function seedWorkspace(app: Surface, input: { path: string; name?: string }): Promise<SeededWorkspace> {
  return timed("seed.workspace", async () => {
    await waitFor(
      app,
      "Boolean(localStorage.getItem('openwork.server.port') && localStorage.getItem('openwork.server.token') && localStorage.getItem('openwork.server.hostToken'))",
      { timeoutMs: 60_000, label: "local OpenWork server credentials" },
    );

    const created = await evalIn(app, `(async () => {
      const port = localStorage.getItem('openwork.server.port');
      const token = localStorage.getItem('openwork.server.token');
      const hostToken = localStorage.getItem('openwork.server.hostToken');
      const base = 'http://127.0.0.1:' + port;
      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        'X-OpenWork-Host-Token': hostToken,
      };
      const folderPath = ${JSON.stringify(input.path)};
      const response = await fetch(base + '/workspaces/local', {
        method: 'POST',
        headers,
        body: JSON.stringify({ folderPath, name: ${JSON.stringify(input.name ?? "eval-workspace")}, preset: 'starter' }),
      });
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch {}
      if (!response.ok) return { ok: false, status: response.status, text };
      const workspaceId = payload?.activeId
        ?? payload?.workspaces?.find((workspace) => workspace.path === folderPath)?.id;
      if (!workspaceId) return { ok: false, status: response.status, text: 'workspace id missing from response' };
      const activate = await fetch(base + '/workspaces/' + workspaceId + '/activate?persist=true', { method: 'POST', headers });
      if (!activate.ok) return { ok: false, status: activate.status, text: await activate.text() };
      localStorage.setItem('openwork.react.activeWorkspace', workspaceId);
      return { ok: true, workspaceId };
    })()`, { awaitPromise: true, timeoutMs: 120_000 });

    if (!isRecord(created) || created.ok !== true || typeof created.workspaceId !== "string") {
      const status = isRecord(created) ? String(created.status ?? "?") : "?";
      const detail = isRecord(created) ? String(created.text ?? "") : String(created);
      throw new Error(`Seeding a local workspace at ${input.path} failed (status ${status}): ${detail.slice(0, 300)}`);
    }

    const workspaceId = created.workspaceId;
    await evalIn(app, `window.location.hash = ${JSON.stringify(`#/workspace/${workspaceId}/session`)}`);
    await waitUntilInteractive(app);
    return { workspaceId, path: input.path };
  }, input.path);
}
