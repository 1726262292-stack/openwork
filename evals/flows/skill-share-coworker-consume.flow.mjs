import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { signInApi } from "./lib/den-web.mjs";

const FLOW_ID = "skill-share-coworker-consume";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const PLUGIN_NAME = "Weekly Report Skill";
const SKILL_TITLE = "weekly-report";
const SKILL_MARKER = "Marker: skill-share-coworker-consume eval";
const DEFAULT_MARKETPLACE_NAME = "OpenWork Marketplace";
const CLICK_ANY = "button, [role=button], a, div, article, li, label";
const CARD_SELECTOR = "button, [role=button], article";

const SKILL_MD = `---
name: ${SKILL_TITLE}
description: Turns notes into a concise weekly team report.
---

# Weekly Report

Use this skill to turn rough notes, completed work, blockers, and next steps into a concise weekly status update.

${SKILL_MARKER}
`;

export default {
  id: FLOW_ID,
  kind: "user-facing",
  title: "Owner shares a skill org-wide via plugin + marketplace primitives; a coworker gets it instantly via OpenWork Connect and it survives reload",
  spec: "evals/cloud-mcp-agent-flows.md",
  requiredEnv: [
    "OPENWORK_EVAL_DEN_API_URL",
    "OPENWORK_EVAL_DEN_WEB_URL",
    "OPENWORK_EVAL_OWNER_EMAIL",
    "OPENWORK_EVAL_OWNER_PASSWORD",
    "OPENWORK_EVAL_COWORKER_EMAIL",
    "OPENWORK_EVAL_COWORKER_PASSWORD",
    "OPENWORK_EVAL_WORKSPACE_PATH",
  ],
  steps: [
    {
      name: "App booted",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", {
          timeoutMs: 60_000,
          label: "window.__openworkControl",
        });
      },
    },
    {
      name: "Owner shares the skill via plugin + marketplace primitives",
      run: async (ctx) => {
        await ctx.prove("The owner shares a skill to the whole org using plugin and marketplace primitives", {
          voiceover: vo[0],
          action: async () => {
            const ownerToken = await freshToken(
              ctx,
              ctx.env.OPENWORK_EVAL_OWNER_EMAIL,
              ctx.env.OPENWORK_EVAL_OWNER_PASSWORD,
              "owner",
            );
            await ensureAcmeActiveOrg(ctx, ownerToken);

            const marketplace = await getDefaultMarketplace(ctx, ownerToken);
            ctx.marketplaceId = marketplace.id;

            await cleanupPluginsByName(ctx, ownerToken, PLUGIN_NAME);

            const created = await denRequest(ctx, ownerToken, "/v1/plugins", {
              method: "POST",
              body: JSON.stringify({
                name: PLUGIN_NAME,
                description: "A reusable skill for concise weekly reports.",
                components: [
                  {
                    type: "skill",
                    input: {
                      rawSourceText: SKILL_MD,
                      metadata: {
                        name: SKILL_TITLE,
                        description: "Turns notes into a concise weekly team report.",
                      },
                    },
                  },
                ],
                orgWide: true,
                marketplaceId: marketplace.id,
              }),
            });

            ctx.pluginId = created?.item?.id;
            ctx.assert(typeof ctx.pluginId === "string" && ctx.pluginId.length > 0, "Plugin create returned no id.");
            ctx.log(`Created plugin ${ctx.pluginId} in marketplace ${ctx.marketplaceId}.`);
          },
          assert: async () => {
            await assertPluginResolvedHasMarker(ctx, ctx.env.OPENWORK_EVAL_OWNER_EMAIL, ctx.env.OPENWORK_EVAL_OWNER_PASSWORD);
            await assertMarketplaceResolvedHasSkillPlugin(ctx, ctx.env.OPENWORK_EVAL_OWNER_EMAIL, ctx.env.OPENWORK_EVAL_OWNER_PASSWORD);
            ctx.recordEvidence({
              type: "assertion",
              status: "passed",
              assertion: `${PLUGIN_NAME} resolves with the skill marker and appears in ${DEFAULT_MARKETPLACE_NAME} with a skill component count.`,
            });
          },
        });
      },
    },
    {
      name: "Sign out the current cloud account",
      run: async (ctx) => {
        await signOutDesktopCloudIfNeeded(ctx);
      },
    },
    {
      name: "Coworker signs in via desktop handoff",
      run: async (ctx) => {
        await ctx.prove("The coworker signs in to the same organization from the desktop app", {
          voiceover: vo[1],
          action: async () => {
            const coworkerToken = await freshToken(
              ctx,
              ctx.env.OPENWORK_EVAL_COWORKER_EMAIL,
              ctx.env.OPENWORK_EVAL_COWORKER_PASSWORD,
              "coworker",
            );
            await ensureAcmeActiveOrg(ctx, coworkerToken);
            ctx.coworkerToken = coworkerToken;

            await signInDesktopWithHandoff(ctx, coworkerToken);
            await completeDesktopCloudOnboardingIfNeeded(ctx, ctx.env.OPENWORK_EVAL_WORKSPACE_PATH.trim());
            await navigateToWorkspaceSession(ctx);
          },
          assert: async () => {
            await ctx.expectHashIncludes("/workspace/");
            const status = await currentAuthStatus(ctx);
            ctx.assert(status.status === "signed_in", `Expected signed_in after coworker handoff, got ${status.status}.`);
          },
          screenshot: {
            name: "coworker-signed-in",
            claim: "The coworker is signed in and lands in the OpenWork desktop workspace shell.",
            rejectText: ["Something went wrong"],
            hashIncludes: "/workspace/",
          },
        });
      },
    },
    {
      name: "Marketplace shows the shared skill",
      run: async (ctx) => {
        await ctx.prove("The coworker can see the shared skill in the Marketplace", {
          voiceover: vo[2],
          action: async () => {
            await openSettingsPanel(ctx, "cloud-marketplaces");
            await waitForMarketplaceContent(ctx);
            await refreshMarketplace(ctx);
            await waitForPluginCard(ctx, PLUGIN_NAME);
          },
          assert: async () => {
            await ctx.expectText(PLUGIN_NAME, { timeoutMs: 45_000 });
          },
          screenshot: {
            name: "marketplace-shared-skill",
            claim: "The organization Marketplace lists the owner-shared Weekly Report Skill for the coworker.",
            requireText: [PLUGIN_NAME],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/cloud-marketplaces",
          },
        });
      },
    },
    {
      name: "The shared skill is active for the coworker via OpenWork Connect (cloud delivery)",
      run: async (ctx) => {
        await ctx.prove("The shared skill is active for the coworker via OpenWork Connect (cloud delivery)", {
          voiceover: vo[3],
          action: async () => {
            await openPluginDetailModal(ctx, PLUGIN_NAME);
          },
          assert: async () => {
            const modalText = await pluginDialogText(ctx, PLUGIN_NAME);
            ctx.assert(modalText.includes("Active · runs in cloud"), `Detail modal did not show cloud active status: ${modalText}`);
            ctx.assert(modalText.includes("1 skill"), `Detail modal did not show the skill count: ${modalText}`);
          },
          screenshot: {
            name: "coworker-cloud-delivered-skill",
            claim: "The shared skill detail shows Active cloud delivery through OpenWork Connect.",
            requireText: ["Active · runs in cloud", PLUGIN_NAME],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/cloud-marketplaces",
          },
        });
        await closePluginDialog(ctx, PLUGIN_NAME);
      },
    },
    {
      name: "Coworker can read the shared skill content through their own access",
      run: async (ctx) => {
        await ctx.prove("Coworker can read the shared skill content through their own access", {
          voiceover: vo[4],
          assert: async () => {
            const coworkerToken = await freshToken(
              ctx,
              ctx.env.OPENWORK_EVAL_COWORKER_EMAIL,
              ctx.env.OPENWORK_EVAL_COWORKER_PASSWORD,
              "coworker",
            );
            ctx.coworkerToken = coworkerToken;
            await ensureAcmeActiveOrg(ctx, coworkerToken);
            const proof = await assertResolvedApiState(ctx, coworkerToken);
            ctx.recordEvidence({
              type: "assertion",
              status: "passed",
              assertion: `Coworker bearer resolved ${PLUGIN_NAME} with ${proof.skillCount} skill component(s) and the skill marker.`,
              pluginId: ctx.pluginId,
              marketplaceId: ctx.marketplaceId,
            });
          },
        });
      },
    },
    {
      name: "Cloud delivery survives reload",
      run: async (ctx) => {
        await ctx.prove("The shared skill remains active via Connect after a full app reload", {
          voiceover: vo[5],
          action: async () => {
            await ctx.eval("location.reload()");
            await ctx.waitFor("Boolean(window.__openworkControl)", {
              timeoutMs: 60_000,
              label: "control API after reload",
            });
            await openSettingsPanel(ctx, "cloud-marketplaces");
            await waitForMarketplaceContent(ctx);
            // A fresh boot starts with an empty org marketplace cache; force
            // the cloud sync the same way the view's Refresh button does.
            await ctx.control("extensions.refresh-marketplace");
            await waitForPluginCardWithText(ctx, PLUGIN_NAME, "Runs in cloud");
          },
          assert: async () => {
            const cardText = await pluginCardAncestorText(ctx, PLUGIN_NAME, "Runs in cloud");
            ctx.assert(cardText.includes("Runs in cloud"), `${PLUGIN_NAME} card did not include Runs in cloud: ${cardText}`);
          },
          screenshot: {
            name: "cloud-delivery-after-reload",
            claim: "After reloading the desktop app, the Marketplace card still shows cloud delivery through Connect.",
            requireText: [PLUGIN_NAME, "Runs in cloud"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/cloud-marketplaces",
          },
        });
      },
    },
  ],
};

async function freshToken(ctx, email, password, label) {
  const token = await signInApi(email.trim(), password.trim());
  ctx.assert(typeof token === "string" && token.trim().length > 0, `Could not mint a fresh ${label} token.`);
  return token.trim();
}

async function denRequest(ctx, token, path, init = {}) {
  const apiBase = ctx.env.OPENWORK_EVAL_DEN_API_URL.trim().replace(/\/+$/, "");
  const { allowStatuses = [], headers = {}, ...fetchInit } = init;
  const response = await fetch(`${apiBase}${path}`, {
    ...fetchInit,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers,
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  ctx.assert(
    response.ok || allowStatuses.includes(response.status),
    `${fetchInit.method ?? "GET"} ${path} failed: ${response.status} ${text.slice(0, 300)}`,
  );
  return body;
}

async function ensureAcmeActiveOrg(ctx, token) {
  const listed = await denRequest(ctx, token, "/v1/me/orgs");
  const orgs = Array.isArray(listed?.orgs) ? listed.orgs : [];
  const acme = orgs.find((org) => org?.name === "Acme Robotics")
    ?? orgs.find((org) => typeof org?.slug === "string" && org.slug.includes("acme"))
    ?? orgs[0];
  ctx.assert(acme && typeof acme.id === "string", "Could not find Acme Robotics for the signed-in eval user.");
  if (listed?.activeOrgId !== acme.id) {
    await denRequest(ctx, token, "/v1/me/active-organization", {
      method: "POST",
      body: JSON.stringify({ organizationId: acme.id }),
    });
  }
  return acme;
}

async function getDefaultMarketplace(ctx, token) {
  const payload = await denRequest(ctx, token, "/v1/marketplaces?limit=100");
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const marketplace = items.find((item) => item?.name === DEFAULT_MARKETPLACE_NAME);
  ctx.assert(marketplace && typeof marketplace.id === "string", `${DEFAULT_MARKETPLACE_NAME} was not returned by /v1/marketplaces.`);
  return marketplace;
}

async function cleanupPluginsByName(ctx, token, name) {
  const listed = await denRequest(ctx, token, `/v1/plugins?limit=100&q=${encodeURIComponent(name)}`);
  const plugins = Array.isArray(listed?.items) ? listed.items : [];
  for (const plugin of plugins) {
    if (plugin?.name !== name || typeof plugin.id !== "string") continue;
    await cleanupPlugin(ctx, token, plugin);
  }
}

async function cleanupPlugin(ctx, token, plugin) {
  const pluginId = encodeURIComponent(plugin.id);
  const marketplaces = Array.isArray(plugin.marketplaces) ? plugin.marketplaces : [];
  for (const marketplace of marketplaces) {
    if (typeof marketplace?.id !== "string") continue;
    await denRequest(ctx, token, `/v1/marketplaces/${encodeURIComponent(marketplace.id)}/plugins/${pluginId}`, {
      method: "DELETE",
      allowStatuses: [204, 404],
    });
  }

  const memberships = await denRequest(ctx, token, `/v1/plugins/${pluginId}/config-objects`, {
    allowStatuses: [404],
  });
  for (const membership of Array.isArray(memberships?.items) ? memberships.items : []) {
    if (typeof membership?.configObjectId !== "string") continue;
    const configObjectId = encodeURIComponent(membership.configObjectId);
    await denRequest(ctx, token, `/v1/plugins/${pluginId}/config-objects/${configObjectId}`, {
      method: "DELETE",
      allowStatuses: [204, 404],
    });
    await denRequest(ctx, token, `/v1/config-objects/${configObjectId}/delete`, {
      method: "POST",
      allowStatuses: [200, 404],
    });
  }

  await denRequest(ctx, token, `/v1/plugins/${pluginId}/archive`, {
    method: "POST",
    allowStatuses: [200, 404],
  });
}

async function assertPluginResolvedHasMarker(ctx, email, password) {
  const token = await freshToken(ctx, email, password, "owner");
  await ensureAcmeActiveOrg(ctx, token);
  const resolved = await denRequest(ctx, token, `/v1/plugins/${encodeURIComponent(ctx.pluginId)}/resolved`);
  const rawSourceText = resolvedRawSourceText(resolved);
  ctx.assert(rawSourceText.includes(SKILL_MARKER), `Resolved plugin did not include marker ${SKILL_MARKER}.`);
}

async function assertMarketplaceResolvedHasSkillPlugin(ctx, email, password) {
  const token = await freshToken(ctx, email, password, "owner");
  await ensureAcmeActiveOrg(ctx, token);
  await assertResolvedApiState(ctx, token);
}

async function assertResolvedApiState(ctx, token) {
  const pluginResolved = await denRequest(ctx, token, `/v1/plugins/${encodeURIComponent(ctx.pluginId)}/resolved`);
  const rawSourceText = resolvedRawSourceText(pluginResolved);
  ctx.assert(rawSourceText.includes(SKILL_MARKER), `Resolved plugin did not include marker ${SKILL_MARKER}.`);

  const marketplaceResolved = await denRequest(ctx, token, `/v1/marketplaces/${encodeURIComponent(ctx.marketplaceId)}/resolved`);
  const plugins = Array.isArray(marketplaceResolved?.item?.plugins) ? marketplaceResolved.item.plugins : [];
  const plugin = plugins.find((item) => item?.id === ctx.pluginId || item?.name === PLUGIN_NAME);
  ctx.assert(plugin, `${PLUGIN_NAME} was not present in marketplace resolved response.`);
  const skillCount = Number(plugin.componentCounts?.skill ?? 0);
  ctx.assert(skillCount >= 1, `${PLUGIN_NAME} did not report a skill component count.`);
  return { skillCount };
}

function resolvedRawSourceText(payload) {
  const memberships = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.memberships)
      ? payload.memberships
      : [];
  return memberships
    .map((membership) => membership?.configObject?.latestVersion?.rawSourceText)
    .filter((value) => typeof value === "string")
    .join("\n");
}

async function currentAuthStatus(ctx) {
  const status = await ctx.control("auth.status").catch(async () => {
    const signedIn = await ctx.eval("Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim())");
    return { status: signedIn ? "signed_in" : "signed_out", user: null };
  });
  return status ?? { status: "signed_out", user: null };
}

async function signOutDesktopCloudIfNeeded(ctx) {
  const status = await currentAuthStatus(ctx);
  if (status.status !== "signed_in") {
    ctx.log(`Cloud account already ${status.status}; skipping sign-out.`);
    return;
  }

  await openSettingsPanel(ctx, "cloud-account");
  await clickExactText(ctx, "Sign out", "button", 30_000);
  await ctx.waitForText("Paste sign-in code", { timeoutMs: 60_000 });
  await ctx.waitFor("!Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim())", {
    timeoutMs: 30_000,
    label: "desktop cloud token cleared",
  });
}

async function signInDesktopWithHandoff(ctx, token) {
  const handoff = await denRequest(ctx, token, "/v1/auth/desktop-handoff", {
    method: "POST",
    body: JSON.stringify({ desktopScheme: "openwork" }),
  });
  ctx.assert(typeof handoff?.openworkUrl === "string" && handoff.openworkUrl.length > 0, "Desktop handoff returned no openworkUrl.");

  await openSettingsPanel(ctx, "cloud-account");
  await ctx.clickText("Paste sign-in code", { timeoutMs: 30_000 });
  await ctx.fill("#den-signin-link", handoff.openworkUrl);
  await ctx.clickText("Finish sign-in", { timeoutMs: 30_000 });
  await ctx.waitFor("Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim())", {
    timeoutMs: 60_000,
    label: "persisted Den auth token",
  });
}

async function completeDesktopCloudOnboardingIfNeeded(ctx, workspacePath) {
  await ctx.waitForText("Choose your organization", { timeoutMs: 10_000 }).then(async () => {
    await clickSmallestContaining(ctx, "Acme Robotics", CLICK_ANY, 20_000);
    await clickExactText(ctx, "Continue with organization", "button", 20_000);
  }).catch(() => {});

  await clickExactText(ctx, "Continue to workspace", "button", 30_000).catch(() => {});

  const needsFolder = await ctx.eval("Boolean(document.querySelector('input[placeholder=\"/workspace/my-project\"]'))").catch(() => false);
  if (needsFolder) {
    await ctx.fill('input[placeholder="/workspace/my-project"]', workspacePath);
    await clickExactText(ctx, "Use this folder", "button", 20_000);
  }

  await clickExactText(ctx, "Continue without OpenWork Models", "button", 5_000).catch(() => {});
  await clickExactText(ctx, "Skip and use the free model", "button", 5_000).catch(() => {});
  await clickExactText(ctx, "Skip", "button", 5_000).catch(() => {});

  const inAppShell = await ctx.eval("window.location.hash.includes('/workspace/') || window.location.hash.includes('/session')").catch(() => false);
  if (!inAppShell) await navigateToWorkspaceSession(ctx);

  await ctx.waitFor("window.location.hash.includes('/workspace/') || window.location.hash.includes('/session')", {
    timeoutMs: 60_000,
    label: "workspace or session route after cloud onboarding",
  });
}

async function navigateToWorkspaceSession(ctx) {
  const workspaceId = await ctx.eval("localStorage.getItem('openwork.react.activeWorkspace') ?? ''").catch(() => "");
  await ctx.navigateHash(workspaceId ? `/workspace/${workspaceId}/session` : "/session");
  await ctx.waitFor("window.location.hash.includes('/workspace/') || window.location.hash.includes('/session')", {
    timeoutMs: 30_000,
    label: "workspace session route",
  });
}

async function openSettingsPanel(ctx, panel) {
  await ctx.control("settings.panel.open", { panel }).catch(async () => {
    await ctx.navigateHash(`/settings/${panel}`);
  });
  await ctx.waitFor(`window.location.hash.includes('/settings/${panel}')`, {
    timeoutMs: 30_000,
    label: `${panel} settings route`,
  });
}

async function waitForMarketplaceContent(ctx) {
  await ctx.waitFor(
    "document.body.innerText.includes('Marketplace') || document.body.innerText.includes('marketplace')",
    { timeoutMs: 30_000, label: "marketplace settings content" },
  );
}

async function refreshMarketplace(ctx) {
  await ctx.control("extensions.refresh-marketplace").catch((error) => {
    ctx.log(`Marketplace refresh control unavailable: ${error.message}`);
  });
}

async function waitForPluginCard(ctx, name) {
  await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(name)})`, {
    timeoutMs: 60_000,
    label: `${name} marketplace card`,
  });
}

async function waitForPluginCardWithText(ctx, name, text) {
  await ctx.waitFor(pluginCardHasAncestorTextExpr(name, text), {
    timeoutMs: 60_000,
    label: `${name} marketplace card includes ${text}`,
  });
}

function pluginCardHasAncestorTextExpr(name, text) {
  return `(() => {
    const compact = (element) => (element?.innerText ?? element?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll(${JSON.stringify(CARD_SELECTOR)})]
      .filter((element) => compact(element).includes(${JSON.stringify(name)}));
    return candidates.some((candidate) => {
      let element = candidate;
      for (let depth = 0; element && depth < 6; depth += 1) {
        const label = compact(element);
        if (label.includes(${JSON.stringify(name)}) && label.includes(${JSON.stringify(text)}) && label.length < 1200) return true;
        element = element.parentElement;
      }
      return false;
    });
  })()`;
}

async function pluginCardAncestorText(ctx, name, text) {
  return await ctx.eval(`(() => {
    const compact = (element) => (element?.innerText ?? element?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll(${JSON.stringify(CARD_SELECTOR)})]
      .filter((element) => compact(element).includes(${JSON.stringify(name)}));
    const labels = [];
    for (const candidate of candidates) {
      let element = candidate;
      for (let depth = 0; element && depth < 6; depth += 1) {
        const label = compact(element);
        if (label.includes(${JSON.stringify(name)}) && label.includes(${JSON.stringify(text)}) && label.length < 1200) labels.push(label);
        element = element.parentElement;
      }
    }
    return labels.sort((left, right) => left.length - right.length)[0] ?? '';
  })()`);
}

async function openPluginDetailModal(ctx, name) {
  const alreadyOpen = await ctx.eval(pluginDialogOpenExpr(name)).catch(() => false);
  if (!alreadyOpen) {
    await clickSmallestContaining(ctx, name, CARD_SELECTOR, 30_000);
  }
  await ctx.waitFor(pluginDialogOpenExpr(name), {
    timeoutMs: 30_000,
    label: `${name} detail modal`,
  });
}

function pluginDialogOpenExpr(name) {
  return `(() => {
    const compact = (element) => (element?.innerText ?? element?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    return [...document.querySelectorAll('[role="dialog"]')].some((dialog) => compact(dialog).includes(${JSON.stringify(name)}));
  })()`;
}

async function pluginDialogText(ctx, name) {
  return await ctx.eval(`(() => {
    const compact = (element) => (element?.innerText ?? element?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find((candidate) => compact(candidate).includes(${JSON.stringify(name)}));
    return compact(dialog);
  })()`);
}

async function closePluginDialog(ctx, name) {
  const isOpen = await ctx.eval(pluginDialogOpenExpr(name)).catch(() => false);
  if (!isOpen) return;

  await ctx.waitFor(`(() => {
    const compact = (element) => (element?.innerText ?? element?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find((candidate) => compact(candidate).includes(${JSON.stringify(name)}));
    const buttons = [...(dialog?.querySelectorAll('button') ?? [])]
      .filter((button) => compact(button) === 'Close' && !button.disabled);
    const button = buttons[buttons.length - 1];
    button?.scrollIntoView({ block: 'center' });
    button?.click();
    return Boolean(button);
  })()`, { timeoutMs: 20_000, label: `click Close in ${name} detail modal` });
  await ctx.waitFor(`!${pluginDialogOpenExpr(name)}`, {
    timeoutMs: 30_000,
    label: `${name} detail modal closed`,
  });
}

async function clickSmallestContaining(ctx, text, selector, timeoutMs) {
  await ctx.waitFor(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((element) => {
        const label = (element.innerText ?? element.textContent ?? '').replace(/\\s+/g, ' ').trim();
        return label.includes(${JSON.stringify(text)}) && !element.disabled;
      })
      .sort((left, right) => (left.innerText ?? left.textContent ?? '').length - (right.innerText ?? right.textContent ?? '').length);
    const element = candidates[0];
    element?.scrollIntoView({ block: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs, label: `click smallest element containing ${text}` });
}

async function clickExactText(ctx, text, selector, timeoutMs) {
  await ctx.waitFor(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((element) => (element.innerText ?? element.textContent ?? '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)} && !element.disabled);
    const element = candidates[candidates.length - 1];
    element?.scrollIntoView({ block: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs, label: `click exact text ${text}` });
}
