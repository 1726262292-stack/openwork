/**
 * Regression proof for multi-org active-org drift on the den-web dashboard.
 *
 * Bug class: den-web dashboard surfaces (org settings, members, teams, roles,
 * integrations, plugins...) relied on the session's global active organization.
 * With multiple orgs, a mid-flow active-org change (another tab, the desktop
 * app) made dashboard writes fail with organization_not_found or land in the
 * wrong org.
 *
 * Fix under test: den-web now pins ALL dashboard /v1/* requests with
 * x-openwork-org-id for the org on screen (centralized in requestJson + the org
 * dashboard provider), so a rename issued from org A's settings screen lands on
 * org A even when the session has drifted to org B.
 */

import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { denApiFetch, denWebUrl, signInApi as signIn } from "./lib/den-web.mjs";

const vo = await loadVoiceoverParagraphs("org-scope-dashboard-pinning");

const ADMIN_EMAIL = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";
const DRIFT_ORG_NAME = "Drift Probe Org";
const ORG_SCOPE_HEADER = "x-openwork-org-id";
const ORG_NAME_INPUT_SELECTOR = 'form input[type="text"]:not([readonly])';

const state = {
  adminToken: null,
  orgA: null,
  orgB: null,
  orgAName: null,
  orgBName: null,
  probeName: null,
};

function orgScopedHeaders(orgId, extra = {}) {
  return { authorization: `Bearer ${state.adminToken}`, [ORG_SCOPE_HEADER]: orgId, ...extra };
}

async function readOrg(ctx, orgId) {
  const { response, body } = await denApiFetch("/v1/org", {
    headers: orgScopedHeaders(orgId),
  });
  ctx.assert(response.ok, `Loading org ${orgId} failed (${response.status}): ${JSON.stringify(body)}`);
  ctx.assert(typeof body?.organization?.name === "string", `Org ${orgId} response did not include organization.name.`);
  return body.organization;
}

async function renameOrg(ctx, orgId, name) {
  const { response, body } = await denApiFetch("/v1/org", {
    method: "PATCH",
    headers: orgScopedHeaders(orgId),
    body: JSON.stringify({ name }),
  });
  ctx.assert(response.ok, `Renaming org ${orgId} failed (${response.status}): ${JSON.stringify(body)}`);
}

async function browserJson(ctx, script) {
  const raw = await ctx.eval(script, { awaitPromise: true });
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function browserSetActiveOrg(ctx, organizationId) {
  return browserJson(
    ctx,
    `fetch('/api/auth/organization/set-active', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ organizationId }))} }).then((response) => response.status)`,
  );
}

async function browserActiveOrgId(ctx) {
  return browserJson(
    ctx,
    `fetch('/api/den/v1/me/orgs').then((response) => response.json()).then((data) => JSON.stringify(data.activeOrgId ?? null))`,
  );
}

async function settingsNameInputValue(ctx) {
  return ctx.eval(`(() => {
    const input = document.querySelector(${JSON.stringify(ORG_NAME_INPUT_SELECTOR)});
    return input?.value ?? null;
  })()`);
}

export default {
  id: "org-scope-dashboard-pinning",
  title: "Dashboard settings writes stay pinned to the org on screen when the session's active org drifts",
  kind: "user-facing",
  preserveTheme: true,
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_WEB_URL", "OPENWORK_EVAL_DEN_MULTI_ORG"],
  steps: [
    {
      name: "Setup: admin signs in, has (or gets) a second org, and org names are captured",
      run: async (ctx) => {
        state.adminToken = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
        ctx.assert(Boolean(state.adminToken), `Admin sign-in failed for ${ADMIN_EMAIL}.`);

        const orgsFirst = await denApiFetch("/v1/me/orgs", {
          headers: { authorization: `Bearer ${state.adminToken}` },
        });
        ctx.assert(orgsFirst.response.ok, `Listing orgs failed: ${orgsFirst.response.status}`);
        let orgs = orgsFirst.body.orgs ?? [];
        ctx.assert(orgs.length >= 1, "Admin has no organizations.");

        state.orgB = orgs.find((org) => org.name === DRIFT_ORG_NAME) ?? null;
        if (!state.orgB) {
          const created = await denApiFetch("/v1/org", {
            method: "POST",
            headers: { authorization: `Bearer ${state.adminToken}` },
            body: JSON.stringify({ name: DRIFT_ORG_NAME }),
          });
          ctx.assert(
            created.response.ok,
            `Creating the drift org failed (${created.response.status}): ${JSON.stringify(created.body)} — this flow needs DEN_ORG_MODE=multi_org.`,
          );
          const refreshed = await denApiFetch("/v1/me/orgs", {
            headers: { authorization: `Bearer ${state.adminToken}` },
          });
          ctx.assert(refreshed.response.ok, `Re-listing orgs failed: ${refreshed.response.status}`);
          orgs = refreshed.body.orgs ?? [];
          state.orgB = orgs.find((org) => org.name === DRIFT_ORG_NAME) ?? null;
        }
        ctx.assert(Boolean(state.orgB), "Drift org missing after create.");

        state.orgA = orgs.find((org) => org.id !== state.orgB.id && org.slug === "default")
          ?? orgs.find((org) => org.id !== state.orgB.id)
          ?? null;
        ctx.assert(Boolean(state.orgA), "No primary org distinct from the drift org.");

        let orgA = await readOrg(ctx, state.orgA.id);
        const orgB = await readOrg(ctx, state.orgB.id);
        state.orgAName = orgA.name;
        state.orgBName = orgB.name;

        if (state.orgAName.startsWith("Pinned Rename ")) {
          await renameOrg(ctx, state.orgA.id, "Acme Robotics");
          orgA = await readOrg(ctx, state.orgA.id);
          state.orgAName = orgA.name;
        }
        state.orgA = { ...state.orgA, name: state.orgAName };
        state.orgB = { ...state.orgB, name: state.orgBName };
      },
    },
    {
      name: "Multi-org admin lands on org A's Settings screen",
      run: async (ctx) => {
        await ctx.prove("The admin is on org A's Settings screen", {
          voiceover: vo[0],
          action: async () => {
            await ctx.eval(`(() => { window.location.href = ${JSON.stringify(denWebUrl())}; return true; })()`);
            await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 30_000 });
            await ctx.eval(
              `fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(() => true).catch(() => true)`,
              { awaitPromise: true },
            );
            await ctx.eval(`(() => { window.location.href = ${JSON.stringify(denWebUrl())}; return true; })()`);
            await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 30_000 });
            await ctx.waitFor(
              "Boolean(document.querySelector('input[type=\"email\"]')) && Boolean(document.querySelector('input[type=\"password\"]'))",
              { timeoutMs: 30_000, label: "email + password fields" },
            );
            await ctx.fill('input[type="email"]', ADMIN_EMAIL);
            await ctx.fill('input[type="password"]', ADMIN_PASSWORD);
            const submitted = await ctx.eval(`(() => {
              const button = document.querySelector('button[type="submit"]');
              if (!button) return false;
              button.click();
              return true;
            })()`);
            ctx.assert(submitted, "No submit button found on the sign-in card.");
            await ctx.waitFor(
              "!document.querySelector('input[type=\"password\"]')",
              { timeoutMs: 30_000, label: "sign-in card dismissed" },
            );

            await ctx.waitFor(
              `(() => {
                const text = document.body?.innerText ?? '';
                return text.includes('Choose an organization') || text.includes('Dashboard');
              })()`,
              { timeoutMs: 30_000, label: "org chooser or dashboard" },
            );
            const chooserVisible = await ctx.eval(`(document.body?.innerText ?? '').includes('Choose an organization')`);
            if (chooserVisible) {
              const picked = await ctx.eval(`(() => {
                const button = [...document.querySelectorAll('button')].find((entry) => (entry.textContent ?? '').includes(${JSON.stringify(state.orgA.name)}));
                button?.click();
                return Boolean(button);
              })()`);
              ctx.assert(picked, `Org chooser did not list ${state.orgA.name}.`);
            }
            await ctx.waitForText("Dashboard", { timeoutMs: 30_000 });

            const status = await browserSetActiveOrg(ctx, state.orgA.id);
            ctx.assert(status === 200, `Selecting the primary org failed with status ${status}.`);
            await ctx.eval(`(() => { window.location.href = ${JSON.stringify(denWebUrl())}; return true; })()`);
            await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 30_000 });
            await ctx.waitForText("Dashboard", { timeoutMs: 30_000 });

            await ctx.eval(`(() => { window.location.href = ${JSON.stringify(`${denWebUrl()}/dashboard/org-settings`)}; return true; })()`);
            await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 30_000 });
          },
          assert: async () => {
            await ctx.waitForText("Organization Identity", { timeoutMs: 30_000 });
            const nameValue = await settingsNameInputValue(ctx);
            ctx.assert(nameValue === state.orgAName, `Settings name input is ${nameValue}, expected ${state.orgAName}.`);
            const active = await browserActiveOrgId(ctx);
            ctx.assert(active === state.orgA.id, `Browser session active org is ${active}, expected ${state.orgA.id}.`);
          },
          screenshot: {
            name: "org-settings-on-org-a",
            claim: "The admin is on org A's Settings screen before the drift is armed.",
            requireText: ["Organization Identity", "Save settings"],
            rejectText: ["organization_not_found", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Rename survives an active-org drift and lands on the org on screen",
      run: async (ctx) => {
        await ctx.prove("Rename survives an active-org drift and lands on the org on screen", {
          voiceover: vo[1],
          action: async () => {
            const status = await browserSetActiveOrg(ctx, state.orgB.id);
            ctx.assert(status === 200, `set-active drift call failed with status ${status}.`);
            const active = await browserActiveOrgId(ctx);
            ctx.assert(active === state.orgB.id, `Session did not drift (active org ${active}).`);

            state.probeName = `Pinned Rename ${Date.now()}`;
            await ctx.fill(ORG_NAME_INPUT_SELECTOR, state.probeName);
            await ctx.clickText("Save settings", { timeoutMs: 15_000 });
          },
          assert: async () => {
            await ctx.waitForText("Workspace settings updated.", { timeoutMs: 30_000 });
            await ctx.expectNoText("organization_not_found");
            await ctx.expectNoText("Something went wrong");

            const orgA = await readOrg(ctx, state.orgA.id);
            ctx.assert(orgA.name === state.probeName, `Org A name is ${orgA.name}, expected ${state.probeName}.`);

            const orgB = await readOrg(ctx, state.orgB.id);
            ctx.assert(orgB.name === state.orgBName, `Org B name is ${orgB.name}, expected ${state.orgBName}.`);
          },
          screenshot: {
            name: "rename-survives-org-drift",
            claim: "The rename succeeds from the open Settings screen even after the browser session drifts to another org.",
            requireText: ["Workspace settings updated."],
            rejectText: ["organization_not_found", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Dashboard stays on the admin's org and shows the new name",
      run: async (ctx) => {
        await ctx.prove("The dashboard stays on the admin's org and shows the new name", {
          voiceover: vo[2],
          action: async () => {
            await ctx.waitFor(
              `(() => (document.body?.innerText ?? '').includes(${JSON.stringify(state.probeName)}))()`,
              { timeoutMs: 30_000, label: "probe name visible after settings refresh" },
            );
          },
          assert: async () => {
            const nameValue = await settingsNameInputValue(ctx);
            ctx.assert(nameValue === state.probeName, `Settings name input is ${nameValue}, expected ${state.probeName}.`);

            // The save refresh should reclaim org A so the session matches the org still on screen.
            const active = await browserActiveOrgId(ctx);
            ctx.assert(active === state.orgA.id, `Browser session active org is ${active}, expected ${state.orgA.id}.`);

            const orgB = await readOrg(ctx, state.orgB.id);
            ctx.assert(orgB.name === state.orgBName, `Org B name is ${orgB.name}, expected ${state.orgBName}.`);
          },
          screenshot: {
            name: "dashboard-stays-on-screen-org",
            claim: "After the settings refresh, the dashboard remains on the org the admin edited and shows the new name.",
            requireText: ["Organization Identity", state.probeName],
            rejectText: ["organization_not_found", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Cleanup: restore org A's original name",
      run: async (ctx) => {
        await renameOrg(ctx, state.orgA.id, state.orgAName);
      },
    },
  ],
};
