/**
 * User-facing proof: an invited teammate's first dashboard load starts with a
 * guided member setup card, then reveals only the resources the workspace made
 * available to that member.
 *
 * Local runbook:
 *   1. pnpm evals --stack-down
 *   2. OPENWORK_EVAL_DEN_WEB_URL=http://127.0.0.1:3005 OPENWORK_EVAL_WEB_CDP_ADMIN=http://127.0.0.1:9855 OPENWORK_EVAL_WEB_CDP_INVITEE=http://127.0.0.1:9856 pnpm fraimz --flow member-first-load-onboarding --stack den
 *      (the stack exports OPENWORK_EVAL_DEN_API_URL and OPENWORK_EVAL_DEN_TOKEN)
 *   3. In another shell, run den-web against the stack API:
 *      DEN_WEB_PORT=3005 DEN_API_BASE=http://127.0.0.1:8790 DEN_AUTH_ORIGIN=http://127.0.0.1:3005 DEN_AUTH_FALLBACK_BASE=http://127.0.0.1:8790 pnpm --filter @openwork-ee/den-web dev:local
 *   4. In another shell, run Chrome for the admin browser:
 *      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9855 --user-data-dir="$(mktemp -d)" --window-size=1440,1100 about:blank
 *   5. In another shell, run Chrome for the invitee browser:
 *      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9856 --user-data-dir="$(mktemp -d)" --window-size=1440,1100 about:blank
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { connect, debuggerUrlFor, listTargets } from "../runner/cdp.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "member-first-load-onboarding";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const DEN_API_URL = cleanBaseUrl(process.env.OPENWORK_EVAL_DEN_API_URL);
const DEN_WEB_URL = cleanBaseUrl(process.env.OPENWORK_EVAL_DEN_WEB_URL);
const ADMIN_CDP_URL = cleanBaseUrl(process.env.OPENWORK_EVAL_WEB_CDP_ADMIN);
const INVITEE_CDP_URL = cleanBaseUrl(process.env.OPENWORK_EVAL_WEB_CDP_INVITEE);
const MARK_VERIFIED_CMD = process.env.OPENWORK_EVAL_MARK_VERIFIED_CMD?.trim() || "";
const ADMIN_EMAIL = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";
const TARGET_ORG_SLUG = process.env.OPENWORK_EVAL_DEN_ORG_SLUG?.trim() || "acme-robotics-demo";
const INVITEE_PASSWORD = "OpenWorkDemo123!";
const RUN_TAG = `${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
const INVITEE_EMAIL = `newmember+${RUN_TAG}@acme.test`;
const AUTH_TOKEN_STORAGE_KEY = "openwork:web:auth-token";
const ORG_SCOPE_HEADER = "x-openwork-org-id";

const EMPTY_PANEL_REJECT_TEXT = [
  "are available to you yet",
  "Ask an admin to enable org-provided models",
  "Give teammates a preconfigured OpenWork",
  "needs an active subscription",
];

const state = {
  adminBrowserSignedIn: false,
  adminToken: null,
  inviteToken: null,
  inviteeToken: null,
  orgId: null,
  orgName: null,
  orgSlug: null,
  orgCapabilities: null,
  installLinkUrl: null,
  resourceSummary: null,
};

export default {
  id: "member-first-load-onboarding",
  title: "An invited teammate's first load is a guided start, not a wall of empty panels",
  kind: "user-facing",
  requiresApp: false,
  spec: "evals/cloud-org-membership-flows.md",
  requiredEnv: [
    "OPENWORK_EVAL_DEN_API_URL",
    "OPENWORK_EVAL_DEN_TOKEN",
    "OPENWORK_EVAL_DEN_WEB_URL",
    "OPENWORK_EVAL_WEB_CDP_ADMIN",
    "OPENWORK_EVAL_WEB_CDP_INVITEE",
    "OPENWORK_EVAL_MARK_VERIFIED_CMD",
  ],
  steps: [
    {
      name: "Frame 1 — Admin invites a teammate",
      run: async (ctx) => {
        await withClient(ctx, ADMIN_CDP_URL, async () => {
          await ctx.prove("An admin invite creates a pending member-list row for the new teammate", {
            voiceover: vo[0],
            action: async () => {
              await signInAdminBrowser(ctx);
              await openMembersPage(ctx);
              await clickExactText(ctx, "Add member", "button");
              await ctx.fill('input[placeholder="teammate@example.com"]', INVITEE_EMAIL);
              await clickExactText(ctx, "Send invite", "button");
              await ctx.waitForText(INVITEE_EMAIL, { timeoutMs: 30_000 });
              await ctx.waitForText("Pending", { timeoutMs: 30_000 });
            },
            assert: async () => {
              await ctx.expectText(INVITEE_EMAIL);
              await ctx.expectText("Pending");

              const org = await loadAdminOrg(ctx);
              witness(ctx, typeof state.orgId === "string" && state.orgId.length > 0, "Admin organization id is available for the invited workspace", compactStateOrg());

              const invitation = await assertPendingInvitation(ctx, org, INVITEE_EMAIL);
              state.inviteToken = invitation.inviteToken;
              const inviteTokenLength = typeof state.inviteToken === "string" ? state.inviteToken.length : 0;
              witness(ctx, typeof state.inviteToken === "string" && state.inviteToken.trim().length > 0, "Pending invitation includes a non-empty invite token", {
                inviteToken: { present: inviteTokenLength > 0, length: inviteTokenLength },
              });
              await assertPendingInviteUi(ctx, INVITEE_EMAIL);
            },
            screenshot: {
              name: "admin-invites-teammate",
              requireText: [INVITEE_EMAIL, "Pending"],
              rejectText: ["Something went wrong"],
            },
          });
        });
      },
    },
    {
      name: "Frame 2 — Teammate joins in one click",
      run: async (ctx) => {
        await withClient(ctx, INVITEE_CDP_URL, async () => {
          await ctx.prove("The invited teammate opens the invite link and reaches the joined success screen", {
            voiceover: vo[1],
            action: async () => {
              await clearDenWebSession(ctx);
              const inviteToken = requireStateString(state.inviteToken, "invite token");
              await goToDenWeb(ctx, `/join-org?invite=${encodeURIComponent(inviteToken)}`);
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"join-org-root\"][data-state=\"signed-out\"]'))", { timeoutMs: 45_000, label: "signed-out join-org invite screen" });
              await completeInviteSignup(ctx, INVITEE_EMAIL, INVITEE_PASSWORD);
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"join-org-success\"]'))", { timeoutMs: 45_000, label: "join-org success" });
            },
            assert: async () => {
              const successVisible = await ctx.eval("Boolean(document.querySelector('[data-testid=\"join-org-success\"]'))");
              witness(ctx, successVisible === true, "Join organization success screen is present", { successVisible });

              const token = await ensureInviteeToken(ctx);
              witness(ctx, typeof token === "string" && token.length > 0, "Invitee browser has an active session token", { token: token ? "<present>" : null });

              const orgContext = await loadInviteeOrg(ctx);
              state.orgCapabilities = orgContext?.capabilities ?? null;
              witness(ctx, orgContext?.currentMember?.role === "member", "Invitee /v1/org payload reports the member role", {
                currentMember: orgContext?.currentMember ?? null,
                organization: compactOrg(orgContext),
              });

              await redactInviteCredential(ctx, state.inviteToken);
            },
            screenshot: {
              name: "teammate-joined",
              requireText: ["You're in, welcome to"],
              rejectText: ["Something went wrong"],
            },
          });
        });
      },
    },
    {
      name: "Frame 3 — Guided dashboard first load",
      run: async (ctx) => {
        await withClient(ctx, INVITEE_CDP_URL, async () => {
          await ctx.prove("The teammate's first dashboard load shows the focused member onboarding card", {
            voiceover: vo[2],
            action: async () => {
              await clickTestId(ctx, "join-org-continue-browser");
              await ctx.waitFor("location.pathname.startsWith('/dashboard')", { timeoutMs: 45_000, label: "dashboard route after invite success" });
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"member-onboarding\"]'))", { timeoutMs: 45_000, label: "member onboarding card" });
            },
            assert: async () => {
              const observed = await onboardingState(ctx);
              witness(ctx, observed.onboardingExists === true, "Member onboarding card exists on first dashboard load", observed);
              witness(ctx, observed.progress === "Step 1 of 2", "Member onboarding progress starts at Step 1 of 2", observed);
              witness(ctx, observed.stepOneState === "active", "First onboarding step is active", observed);
              witness(ctx, observed.stepTwoState === "pending", "Second onboarding step is pending", observed);
              witness(ctx, observed.resourceOverviewPresent === false, "Member resource overview is hidden during the first guided load", observed);
              const profilePrompt = await ctx.eval(`({
                dialogPresent: Boolean(document.querySelector('[role="dialog"]')),
                bodyIncludesUserProfile: document.body.innerText.includes('User Profile'),
              })`);
              witness(ctx, profilePrompt.dialogPresent === false, "Profile dialog is absent during the guided first load", profilePrompt);
              witness(ctx, profilePrompt.bodyIncludesUserProfile === false, "Guided first load does not include the User Profile prompt", profilePrompt);
              for (const rejectedText of EMPTY_PANEL_REJECT_TEXT) {
                witness(ctx, observed.bodyText.includes(rejectedText) === false, `Guided first load does not include '${rejectedText}'`, { rejectedText });
              }
            },
            screenshot: {
              name: "guided-first-load",
              requireText: ["Welcome to", "Install OpenWork for", "Step 1 of 2", "Sign in with"],
              rejectText: [...EMPTY_PANEL_REJECT_TEXT, "User Profile"],
            },
          });
        });
      },
    },
    {
      name: "Frame 4 — Workspace-configured installer",
      run: async (ctx) => {
        await withClient(ctx, INVITEE_CDP_URL, async () => {
          const orgName = requireStateString(state.orgName, "organization name");
          await ctx.prove("The first onboarding step opens a workspace-scoped installer page", {
            voiceover: vo[3],
            action: async () => {
              await clickTestId(ctx, "member-onboarding-download");
            },
            assert: async () => {
              await ctx.waitFor("location.pathname === '/install'", { timeoutMs: 45_000, label: "member landed on workspace install page" });
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"install-page\"]'))", { timeoutMs: 30_000, label: "workspace install page" });
              // install-page also renders while the install config is still loading, so wait for
              // the guide itself — the concrete artifact these assertions are about.
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"install-guide\"]'))", { timeoutMs: 30_000, label: "workspace install guide" });
              await ctx.waitFor(
                `[...document.querySelectorAll('h1')].some((heading) => (heading.textContent ?? '').includes(${JSON.stringify(orgName)}))`,
                { timeoutMs: 30_000, label: "install page heading branded to the organization" },
              );

              const guideExists = await ctx.eval("Boolean(document.querySelector('[data-testid=\"install-guide\"]'))");
              witness(ctx, guideExists === true, "Workspace install page includes the guided installer", { guideExists });

              const headingText = await ctx.eval("[...document.querySelectorAll('h1')].map((heading) => (heading.textContent ?? '').trim()).find((text) => text.includes('Download OpenWork')) ?? ''");
              witness(ctx, typeof headingText === "string" && headingText.includes("Download OpenWork") && headingText.includes(orgName), "Workspace install page heading is branded to this organization", {
                headingText,
                orgName,
              });

              const installRoute = await ctx.eval(`(() => {
                const url = new URL(location.href);
                const token = url.searchParams.get('token') ?? '';
                return {
                  pathname: location.pathname,
                  token: { present: token.length > 0, length: token.length },
                  searchKeys: [...url.searchParams.keys()],
                };
              })()`);
              witness(ctx, installRoute?.pathname === "/install" && installRoute?.token?.present === true && installRoute.token.length > 0, "Workspace install page route carries a non-empty scoped token", installRoute);

              const capabilities = state.orgCapabilities;
              ctx.output("invitee-org-capabilities", JSON.stringify(capabilities, null, 2));
              witness(ctx, capabilities?.installLinks === true, "Invitee /v1/org capabilities enable install links for member onboarding", { capabilities });

              const orgId = requireStateString(state.orgId, "organization id");
              const result = await inviteeAuthedFetch(`/v1/orgs/${encodeURIComponent(orgId)}/install-links`, {
                method: "POST",
                body: JSON.stringify({ rotate: false }),
              });
              const installPageUrl = typeof result.body?.installPageUrl === "string" ? result.body.installPageUrl : "";
              const installPath = installPageUrl ? new URL(installPageUrl).pathname : "";
              state.installLinkUrl = installPageUrl ? redactInstallLink(installPageUrl) : null;
              witness(ctx, result.response.ok === true && installPath === "/install", "A plain member can mint a workspace-scoped install page URL", {
                status: result.response.status,
                ok: result.response.ok,
                installPageUrl: state.installLinkUrl,
                pathname: installPath,
              });

              const alertText = await ctx.eval("document.querySelector('[role=\"alert\"]')?.textContent?.trim() ?? ''");
              witness(ctx, alertText === "", "Download action did not surface an alert error", { alertText });

              await redactInstallCredential(ctx);
            },
            screenshot: {
              name: "workspace-configured-installer",
              requireText: ["Download OpenWork", orgName, "Complete one step at a time"],
              rejectText: ["Something went wrong", "expired", "Could not create"],
            },
          });
        });
      },
    },
    {
      name: "Frame 5 — Install checked off",
      run: async (ctx) => {
        await withClient(ctx, INVITEE_CDP_URL, async () => {
          let beforeInstallCheck = null;
          await ctx.prove("Confirming the desktop app is installed moves the teammate to the sign-in step", {
            voiceover: vo[4],
            action: async () => {
              await goToDenWeb(ctx, "/dashboard");
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"member-onboarding\"]'))", { timeoutMs: 30_000, label: "member onboarding after returning from installer" });
              beforeInstallCheck = await onboardingState(ctx);
              await clickExactText(ctx, "I already installed it", "button");
              await ctx.waitFor("(document.querySelector('[data-testid=\"member-onboarding-progress\"]')?.textContent ?? '').trim() === 'Step 2 of 2'", { timeoutMs: 30_000, label: "member onboarding step two" });
            },
            assert: async () => {
              witness(ctx, beforeInstallCheck?.stepOneState === "active", "First onboarding step is still active after returning from the install page", beforeInstallCheck);
              const observed = await onboardingState(ctx);
              witness(ctx, observed.progress === "Step 2 of 2", "Member onboarding progress advances to Step 2 of 2", observed);
              witness(ctx, observed.stepOneState === "complete", "First onboarding step is complete", observed);
              witness(ctx, observed.stepTwoState === "active", "Second onboarding step is active", observed);
              witness(ctx, observed.finishPresent === true, "Show my workspace finish action is present", observed);
              witness(ctx, observed.skipPresent === false, "Skip setup action is removed once install is confirmed", observed);

              const storage = await memberOnboardingInstalledStorage(ctx);
              witness(ctx, storage.value === "1", `Local storage marks the installer step complete at ${storage.key}`, storage);
            },
            screenshot: {
              name: "install-checked-off",
              requireText: ["Step 2 of 2", "Show my workspace"],
              rejectText: ["I already installed it", "Step 1 of 2", "User Profile"],
            },
          });
        });
      },
    },
    {
      name: "Frame 6 — Details match shared resources",
      run: async (ctx) => {
        await withClient(ctx, INVITEE_CDP_URL, async () => {
          await ctx.prove("Finishing setup collapses onboarding and renders only member-visible resource panels", {
            voiceover: vo[5],
            action: async () => {
              await clickTestId(ctx, "member-onboarding-finish");
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"member-onboarding-complete\"]'))", { timeoutMs: 30_000, label: "collapsed member onboarding row" });
            },
            assert: async () => {
              const summary = await fetchMemberVisibleResourceSummary(ctx);
              state.resourceSummary = summary;
              ctx.output("member-resource-ground-truth", JSON.stringify(summary, null, 2));

              await waitForResourceDomToMatch(ctx, summary.expectations);
              const observed = await resourceDomState(ctx);
              witness(ctx, observed.completePresent === true && observed.completeText.includes("You're set up for"), "Collapsed member onboarding row confirms setup is complete", observed);
              witness(ctx, observed.stepsPresent === false, "Detailed onboarding steps are hidden after finishing setup", observed);
              witness(ctx, observed.workspaceHeadingPresent === true, "Your workspace heading is present", observed);
              witness(ctx, observed.bodyText.includes("are available to you yet") === false, "No old empty-resource placeholder copy is rendered", observed);

              witness(ctx, observed.headings["LLM providers"] === summary.expectations.expectCustomProviders, "LLM providers heading visibility matches usable custom providers", {
                expected: summary.expectations.expectCustomProviders,
                observed: observed.headings["LLM providers"],
                providerSources: summary.providerSources,
              });
              witness(ctx, observed.headings["OpenWork Models"] === summary.expectations.expectOpenWorkModels, "OpenWork Models heading visibility matches usable OpenWork providers", {
                expected: summary.expectations.expectOpenWorkModels,
                observed: observed.headings["OpenWork Models"],
                openWorkProviderCount: summary.counts.openWorkProviders,
                providerSources: summary.providerSources,
              });
              witness(ctx, observed.headings.Marketplaces === summary.expectations.expectMarketplaces, "Marketplaces heading visibility matches assigned marketplaces", {
                expected: summary.expectations.expectMarketplaces,
                observed: observed.headings.Marketplaces,
                marketplaceCount: summary.counts.marketplaces,
              });
              witness(ctx, observed.headings.Plugins === summary.expectations.expectPlugins, "Plugins heading visibility matches assigned plugins", {
                expected: summary.expectations.expectPlugins,
                observed: observed.headings.Plugins,
                pluginCount: summary.counts.plugins,
              });
              witness(ctx, observed.resourceOverviewPresent === summary.expectations.hasAnyResources, "Resource overview presence matches whether any resource is shared", {
                expected: summary.expectations.hasAnyResources,
                observed: observed.resourceOverviewPresent,
              });
              witness(ctx, observed.resourcesEmptyPresent === !summary.expectations.hasAnyResources, "Empty resource note appears only when nothing is shared", {
                expected: !summary.expectations.hasAnyResources,
                observed: observed.resourcesEmptyPresent,
              });
              const profileDialogPresent = await ctx.eval("Boolean(document.querySelector('[role=\"dialog\"]'))");
              witness(ctx, profileDialogPresent === false, "Profile dialog is absent from the finished member details view", { profileDialogPresent });
            },
            screenshot: {
              name: "details-only-what-was-shared",
              requireText: ["You're set up for", "Your workspace"],
              rejectText: ["are available to you yet", "Step 1 of 2", "Ask an admin to enable org-provided models", "User Profile"],
            },
          });
        });
      },
    },
  ],
};

function cleanBaseUrl(value) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual: actual === undefined ? undefined : typeof actual === "string" ? actual : JSON.stringify(actual).slice(0, 900),
  });
  ctx.assert(condition, assertion + (actual === undefined ? "" : ` (actual: ${JSON.stringify(actual).slice(0, 500)})`));
}

function requireStateString(value, label) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  throw new Error(`${label} was not prepared by an earlier frame.`);
}

async function withClient(ctx, cdpBaseUrl, fn) {
  const previous = ctx.client;
  const target = await firstPageTarget(cdpBaseUrl);
  const client = await connect(debuggerUrlFor(cdpBaseUrl, target));
  ctx.client = client;
  try {
    return await fn();
  } finally {
    ctx.client = previous;
    try {
      client.close();
    } catch {}
  }
}

async function firstPageTarget(cdpBaseUrl) {
  const existing = await listTargets(cdpBaseUrl);
  const page = existing.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (page) {
    return page;
  }

  const base = cdpBaseUrl.replace(/\/+$/, "");
  let response = await fetch(`${base}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) {
    response = await fetch(`${base}/json/new?about:blank`);
  }
  if (!response.ok) {
    throw new Error(`Could not create a page target at ${cdpBaseUrl}: ${response.status}`);
  }

  const created = await response.json();
  if (created?.type === "page" && created.webSocketDebuggerUrl) {
    return created;
  }
  const targets = await listTargets(cdpBaseUrl);
  const nextPage = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!nextPage) {
    throw new Error(`No page target available at ${cdpBaseUrl}.`);
  }
  return nextPage;
}

function adminAuthOrigins() {
  const origins = [];
  if (DEN_WEB_URL) {
    origins.push(new URL(DEN_WEB_URL).origin);
  }
  if (DEN_API_URL) {
    const apiUrl = new URL(DEN_API_URL);
    if (apiUrl.hostname === "127.0.0.1") {
      const localhostUrl = new URL(apiUrl.toString());
      localhostUrl.hostname = "localhost";
      origins.push(localhostUrl.origin);
    }
    origins.push(apiUrl.origin);
  }
  return [...new Set(origins)];
}

function sessionCookiePair(setCookie) {
  const match = String(setCookie ?? "").match(/better-auth\.session_token=([^;,\s]+)/);
  return match ? `better-auth.session_token=${match[1]}` : "";
}

async function createAdminBrowserSession(ctx) {
  const session = await createBrowserSession(ctx, ADMIN_EMAIL, ADMIN_PASSWORD, "Admin");
  if (session) {
    state.adminToken = session.token;
  }
  return session;
}

async function createBrowserSession(ctx, email, password, label) {
  let last = null;
  for (const origin of adminAuthOrigins()) {
    const response = await fetch(`${DEN_API_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password }),
    });
    const text = await response.text();
    const body = parseResponseBody(text);
    const cookie = sessionCookiePair(response.headers.get("set-cookie"));
    last = { origin, status: response.status, body: redactAuthBody(body), cookie: cookie ? "<present>" : null };
    if (response.ok && typeof body?.token === "string" && cookie) {
      witness(ctx, true, `${label} API sign-in minted a den-web browser session`, { origin, status: response.status, token: "<present>", cookie: "<present>" });
      return { token: body.token, cookie };
    }
  }
  witness(ctx, false, `${label} API sign-in minted a den-web browser session`, last);
  return null;
}

async function signInAdminBrowser(ctx) {
  if (state.adminBrowserSignedIn) {
    return;
  }

  const session = await createAdminBrowserSession(ctx);
  if (!session) {
    throw new Error("Admin browser session could not be created.");
  }
  await pinAdminActiveOrganization(ctx, session.token);
  await applyBrowserSession(ctx, session);
  state.adminBrowserSignedIn = true;
}

async function pinAdminActiveOrganization(ctx, token) {
  const listed = await denFetch("/v1/me/orgs", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  const orgs = Array.isArray(listed.body?.orgs) ? listed.body.orgs : [];
  witness(ctx, listed.response.ok && Array.isArray(listed.body?.orgs), "Admin session can list organizations before opening Members", {
    status: listed.response.status,
    count: orgs.length,
  });

  const target = orgs.find((org) => org?.slug === TARGET_ORG_SLUG) ?? null;
  witness(ctx, Boolean(target), `Admin belongs to the target organization ${TARGET_ORG_SLUG}`, {
    targetSlug: TARGET_ORG_SLUG,
    available: orgs.map(compactOrgPair),
  });

  const active = await denFetch("/v1/me/active-organization", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ organizationSlug: TARGET_ORG_SLUG }),
  });
  witness(ctx, active.response.ok && active.body?.activeOrgSlug === TARGET_ORG_SLUG, "Admin session pins the target organization before opening Members", {
    status: active.response.status,
    ok: active.response.ok,
    activeOrgId: active.body?.activeOrgId ?? null,
    activeOrgSlug: active.body?.activeOrgSlug ?? null,
  });

  state.orgId = typeof target?.id === "string" ? target.id : null;
  state.orgName = typeof target?.name === "string" ? target.name : null;
  state.orgSlug = typeof target?.slug === "string" ? target.slug : null;
  witness(ctx, typeof state.orgId === "string" && typeof state.orgName === "string", "Target organization identity was resolved from /v1/me/orgs", compactStateOrg());
}

async function applyBrowserSession(ctx, session) {
  await goToDenWeb(ctx, "/");
  await ctx.eval(`(() => {
    document.cookie = 'better-auth.session_token=; Max-Age=0; Path=/';
    document.cookie = ${JSON.stringify(`${session.cookie}; Path=/; SameSite=Lax`)};
    localStorage.setItem(${JSON.stringify(AUTH_TOKEN_STORAGE_KEY)}, ${JSON.stringify(session.token)});
    sessionStorage.clear();
    return true;
  })()`);
}

async function openMembersPage(ctx) {
  await goToDenWeb(ctx, "/dashboard/members");
  await ctx.waitFor("location.pathname.includes('/dashboard/members') || (document.body?.innerText ?? '').includes('Choose an organization')", { timeoutMs: 30_000, label: "members route or organization chooser" });
  await chooseActiveOrganizationFromChooser(ctx);
  const onMembersRoute = await ctx.eval("location.pathname.includes('/dashboard/members')");
  if (!onMembersRoute) {
    await goToDenWeb(ctx, "/dashboard/members");
  }
  await ctx.waitFor("location.pathname.includes('/dashboard/members')", { timeoutMs: 30_000, label: "members route" });
  await waitForMembersPageReady(ctx);
}

async function chooseActiveOrganizationFromChooser(ctx) {
  const chooserVisible = await ctx.eval("(document.body?.innerText ?? '').includes('Choose an organization')");
  if (!chooserVisible) {
    return;
  }

  const orgName = requireStateString(state.orgName, "organization name");
  const clicked = await clickExactText(ctx, orgName, "button, a, [role=\"button\"]");
  witness(ctx, clicked === true, "Organization chooser fallback selected the resolved organization", { orgName });
  await ctx.waitFor("!(document.body?.innerText ?? '').includes('Choose an organization')", { timeoutMs: 30_000, label: "organization chooser dismissed" });
}

async function waitForMembersPageReady(ctx) {
  await ctx.waitFor(`(() => {
    const text = document.body?.innerText ?? '';
    if (text.includes('Invite teammates, adjust roles, and keep access clean.')) return true;
    return [...document.querySelectorAll('button')].some((button) => (button.textContent ?? '').trim() === 'Add member' && !button.disabled);
  })()`, { timeoutMs: 45_000, label: "members page Add member button" });
}

async function goToDenWeb(ctx, path) {
  const url = path.startsWith("http") ? path : `${DEN_WEB_URL}${path}`;
  await ctx.eval(`location.assign(${JSON.stringify(url)})`);
  const labelPath = path.includes("invite=") ? redactInviteLink(path) : path;
  await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 30_000, label: `den-web loaded ${labelPath}` });
}

async function clearDenWebSession(ctx) {
  await goToDenWeb(ctx, "/");
  await ctx.eval(
    `fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null).then(() => {
      localStorage.clear();
      sessionStorage.clear();
      for (const cookie of document.cookie.split(';')) {
        const name = cookie.split('=')[0]?.trim();
        if (name) document.cookie = name + '=; Max-Age=0; Path=/';
      }
      return true;
    })`,
    { awaitPromise: true },
  );
}

async function clickExactText(ctx, text, selector) {
  const clicked = await ctx.waitFor(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const text = ${JSON.stringify(text)};
    const element = candidates.find((candidate) => {
      if (candidate.disabled) return false;
      const exactText = (candidate.textContent ?? '').trim();
      const innerText = (candidate.innerText ?? candidate.textContent ?? '').trim();
      return exactText === text || innerText === text;
    });
    element?.scrollIntoView({ block: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs: 20_000, label: `click exact text ${text}` });
  return clicked;
}

async function clickTestId(ctx, testId, { timeoutMs = 20_000 } = {}) {
  return ctx.waitFor(`(() => {
    const el = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
    if (!el) return false;
    if (el instanceof HTMLButtonElement && el.disabled) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  })()`, { timeoutMs, label: `click [data-testid="${testId}"]` });
}

function memberRowsExpression(email) {
  return `(() => {
    const email = ${JSON.stringify(email)};
    return [...document.querySelectorAll('div')]
      .filter((el) => {
        const style = getComputedStyle(el);
        return style.display === 'grid' && style.gridTemplateColumns.includes('180px') && (el.innerText ?? '').includes(email);
      })
      .map((el) => {
        const cells = [...el.children].map((child) => child.innerText.trim());
        return {
          text: el.innerText.trim(),
          role: cells[1] ?? '',
          joined: cells[2] ?? '',
        };
      });
  })()`;
}

async function memberRows(ctx, email) {
  return ctx.eval(memberRowsExpression(email));
}

async function waitForUiRows(ctx, email, predicateSource, label) {
  await ctx.waitFor(`(() => {
    const rows = ${memberRowsExpression(email)};
    const predicate = ${predicateSource};
    return predicate(rows);
  })()`, { timeoutMs: 30_000, label });
  return memberRows(ctx, email);
}

async function scrollMemberRowsIntoView(ctx, email) {
  await ctx.eval(`(() => {
    const rows = [...document.querySelectorAll('div')]
      .filter((el) => {
        const style = getComputedStyle(el);
        return style.display === 'grid' && style.gridTemplateColumns.includes('180px') && (el.innerText ?? '').includes(${JSON.stringify(email)});
      });
    rows[0]?.scrollIntoView({ block: 'center' });
    return rows.length;
  })()`);
  await ctx.eval("new Promise((resolve) => setTimeout(resolve, 250))", { awaitPromise: true });
}

async function assertPendingInviteUi(ctx, email) {
  const rows = await waitForUiRows(
    ctx,
    email,
    "(rows) => rows.length >= 1 && rows.some((row) => row.joined.includes('Pending'))",
    `pending invited member row for ${email}`,
  );
  witness(ctx, rows.length >= 1, `${email} is visible in the members list`, rows);
  witness(ctx, rows.some((row) => row.joined.includes("Pending")), `${email} den-web row shows Pending`, rows);
  await scrollMemberRowsIntoView(ctx, email);
}

async function denFetch(path, options = {}) {
  const response = await fetch(`${DEN_API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      origin: DEN_WEB_URL || DEN_API_URL,
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  return { response, body: parseResponseBody(text), text };
}

async function adminAuthedFetch(path, options = {}) {
  const token = state.adminToken || process.env.OPENWORK_EVAL_DEN_TOKEN?.trim() || "";
  return denFetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(state.orgId ? { [ORG_SCOPE_HEADER]: state.orgId } : {}),
      ...(options.headers ?? {}),
    },
  });
}

async function inviteeAuthedFetch(path, options = {}) {
  const token = requireStateString(state.inviteeToken, "invitee token");
  return denFetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(state.orgId ? { [ORG_SCOPE_HEADER]: state.orgId } : {}),
      ...(options.headers ?? {}),
    },
  });
}

async function loadAdminOrg(ctx) {
  const result = await adminAuthedFetch("/v1/org");
  witness(ctx, result.response.ok, "Admin token can load the active organization", { status: result.response.status, body: compactOrgResponse(result.body) });
  return result.body;
}

async function assertPendingInvitation(ctx, orgPayload, email) {
  const invitations = invitationsFromPayload(orgPayload);
  const pending = invitations.find((invitation) => normalizeEmail(invitation?.email) === normalizeEmail(email) && String(invitation?.status ?? "").trim().toLowerCase() === "pending") ?? null;
  witness(ctx, Boolean(pending), `Admin /v1/org payload contains a pending invitation for ${email}`, {
    invitations: invitations.map(compactInvitation),
  });
  return pending ?? {};
}

async function loadInviteeOrg(ctx) {
  const result = await inviteeAuthedFetch("/v1/org");
  witness(ctx, result.response.ok, "Invitee token can load /v1/org", { status: result.response.status, body: compactOrgResponse(result.body) });
  return result.body;
}

async function completeInviteSignup(ctx, email, password) {
  await ctx.waitFor("Boolean(document.querySelector('input[type=\"password\"]'))", { timeoutMs: 30_000, label: "invite password field" });
  await ctx.fill('input[type="password"]', password);
  await clickExactText(ctx, joinButtonLabel(), "button");
  await ctx.waitFor(
    `document.body.innerText.includes("You're one click away from the team workspace.") || document.body.innerText.includes("Check your inbox.") || Boolean(document.querySelector('[data-testid="join-org-success"]'))`,
    { timeoutMs: 45_000, label: "signed in invite accept step" },
  );

  const alreadySuccess = await ctx.eval("Boolean(document.querySelector('[data-testid=\"join-org-success\"]'))");
  if (alreadySuccess) {
    return;
  }

  markEmailVerified(ctx, email);
  const needsSigninRefresh = await ctx.eval("document.body.innerText.includes('Check your inbox.') || Boolean(document.querySelector('input[inputmode=\"numeric\"]'))");
  if (needsSigninRefresh) {
    const session = await createBrowserSession(ctx, email, password, "Invitee");
    if (!session) {
      throw new Error(`Could not create invitee browser session for ${email}.`);
    }
    state.inviteeToken = session.token;
    await applyBrowserSession(ctx, session);
    const inviteToken = requireStateString(state.inviteToken, "invite token");
    await goToDenWeb(ctx, `/join-org?invite=${encodeURIComponent(inviteToken)}`);
    await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"join-org-root\"][data-state=\"signed-in\"]'))", { timeoutMs: 45_000, label: "signed-in join-org invite screen" });
  }

  await ctx.expectText(email, { timeoutMs: 20_000 });
  await clickExactText(ctx, joinButtonLabel(), "button");
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"join-org-success\"]'))", { timeoutMs: 45_000, label: "join org success" });
}

function joinButtonLabel() {
  return `Join ${requireStateString(state.orgName, "organization name")}`;
}

function markEmailVerified(ctx, email) {
  ctx.assert(
    MARK_VERIFIED_CMD.length > 0,
    "Invitation acceptance requires a verified email; set OPENWORK_EVAL_MARK_VERIFIED_CMD (shell template with {email}).",
  );
  execSync(MARK_VERIFIED_CMD.replaceAll("{email}", email), { stdio: "ignore" });
}

async function ensureInviteeToken(ctx) {
  if (state.inviteeToken) {
    return state.inviteeToken;
  }
  const browserToken = await ctx.eval(`localStorage.getItem(${JSON.stringify(AUTH_TOKEN_STORAGE_KEY)}) ?? ''`);
  if (typeof browserToken === "string" && browserToken.trim()) {
    state.inviteeToken = browserToken.trim();
    return state.inviteeToken;
  }
  const session = await createBrowserSession(ctx, INVITEE_EMAIL, INVITEE_PASSWORD, "Invitee");
  if (!session) {
    throw new Error("Invitee session token was not available after joining.");
  }
  state.inviteeToken = session.token;
  return state.inviteeToken;
}

function redactInviteLink(inviteLink) {
  try {
    const parsed = new URL(inviteLink, DEN_WEB_URL);
    if (parsed.searchParams.has("invite")) parsed.searchParams.set("invite", "[redacted]");
    return parsed.toString();
  } catch {
    return "invalid invite URL";
  }
}

async function redactInviteCredential(ctx, inviteToken) {
  const result = await ctx.eval(`(() => {
    const token = ${JSON.stringify(inviteToken ?? "")};
    const redactedInvite = ${JSON.stringify(`${DEN_WEB_URL}/join-org?invite=%5Bredacted%5D`)};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let redactedTextNodes = 0;
    let node = walker.nextNode();
    while (node) {
      const before = node.nodeValue ?? '';
      let after = before;
      if (token) after = after.split(token).join('[redacted]');
      after = after.replace(/([?&]invite=)[^&\\s<>"')]+/g, '$1[redacted]');
      if (after !== before) {
        node.nodeValue = after;
        redactedTextNodes += 1;
      }
      node = walker.nextNode();
    }
    let redactedLinks = 0;
    for (const link of document.querySelectorAll('a[href*="/join-org?invite="]')) {
      link.href = redactedInvite;
      link.setAttribute('href', redactedInvite);
      redactedLinks += 1;
    }
    if (location.href.includes('/join-org') && (location.search.includes('invite=') || (token && location.href.includes(token)))) {
      history.replaceState(history.state, document.title, '/join-org?invite=%5Bredacted%5D');
    }
    const bodyContainsToken = token ? document.body.innerText.includes(token) : false;
    const hrefContainsToken = token ? [...document.querySelectorAll('a')].some((link) => link.href.includes(token) || (link.getAttribute('href') ?? '').includes(token)) : false;
    const urlContainsToken = token ? location.href.includes(token) : false;
    const urlHasInviteCredential = /[?&]invite=(?!%5Bredacted%5D|\\[redacted\\])/.test(location.href);
    const safeHref = (token ? location.href.split(token).join('[redacted]') : location.href).replace(/([?&]invite=)[^&\\s<>"')]+/g, '$1[redacted]');
    return { redactedTextNodes, redactedLinks, bodyContainsToken, hrefContainsToken, urlContainsToken, urlHasInviteCredential, href: safeHref };
  })()`);
  witness(ctx, !result.bodyContainsToken && !result.hrefContainsToken && !result.urlContainsToken && !result.urlHasInviteCredential, "Invite token is redacted from the page and recorded URL before capture", result);
}

async function redactInstallCredential(ctx) {
  const result = await ctx.eval(`(() => {
    const url = new URL(location.href);
    const token = url.searchParams.get('token') ?? '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let redactedTextNodes = 0;
    let node = walker.nextNode();
    while (node) {
      const before = node.nodeValue ?? '';
      let after = before;
      if (token) after = after.split(token).join('[redacted]');
      after = after.replace(/([?&]token=)[^&\\s<>"')]+/g, '$1[redacted]');
      if (after !== before) {
        node.nodeValue = after;
        redactedTextNodes += 1;
      }
      node = walker.nextNode();
    }
    let redactedLinks = 0;
    for (const link of document.querySelectorAll('a[href*="token="]')) {
      const href = link.href;
      try {
        const parsed = new URL(href);
        if (parsed.searchParams.has('token')) {
          parsed.searchParams.set('token', '[redacted]');
          link.href = parsed.toString();
          link.setAttribute('href', parsed.toString());
          redactedLinks += 1;
        }
      } catch {}
    }
    if (url.searchParams.has('token')) {
      url.searchParams.set('token', '[redacted]');
      history.replaceState(history.state, document.title, url.pathname + url.search + url.hash);
    }
    const bodyContainsToken = token ? document.body.innerText.includes(token) : false;
    const hrefContainsToken = token ? [...document.querySelectorAll('a')].some((link) => link.href.includes(token) || (link.getAttribute('href') ?? '').includes(token)) : false;
    const urlContainsToken = token ? location.href.includes(token) : false;
    const urlHasTokenCredential = /[?&]token=(?!%5Bredacted%5D|\\[redacted\\])/.test(location.href);
    return {
      redactedTextNodes,
      redactedLinks,
      bodyContainsToken,
      hrefContainsToken,
      urlContainsToken,
      urlHasTokenCredential,
      href: location.origin + location.pathname + location.search.replace(/([?&]token=)[^&\\s<>"')]+/g, '$1[redacted]'),
    };
  })()`);
  witness(ctx, !result.bodyContainsToken && !result.hrefContainsToken && !result.urlContainsToken && !result.urlHasTokenCredential, "Install token is redacted from the page and recorded URL before capture", result);
}

function redactInstallLink(installLink) {
  return redactSensitiveUrlQuery(installLink);
}

function redactSensitiveUrlQuery(url) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (sensitiveQueryKey(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    return parsed.toString();
  } catch {
    return "invalid URL";
  }
}

function sensitiveQueryKey(key) {
  const normalized = key.toLowerCase();
  return normalized === "invite" || normalized.includes("token") || normalized.includes("secret");
}

async function onboardingState(ctx) {
  return ctx.eval(`(() => {
    const bodyText = document.body.innerText;
    const steps = document.querySelector('[data-testid="member-onboarding-steps"]');
    return {
      onboardingExists: Boolean(document.querySelector('[data-testid="member-onboarding"]')),
      progress: (document.querySelector('[data-testid="member-onboarding-progress"]')?.textContent ?? '').trim(),
      stepOneState: steps?.querySelector('li:nth-child(1)')?.getAttribute('data-state') ?? null,
      stepTwoState: steps?.querySelector('li:nth-child(2)')?.getAttribute('data-state') ?? null,
      resourceOverviewPresent: Boolean(document.querySelector('[data-testid="member-resource-overview"]')),
      finishPresent: Boolean(document.querySelector('[data-testid="member-onboarding-finish"]')),
      skipPresent: Boolean(document.querySelector('[data-testid="member-onboarding-skip"]')),
      bodyText,
    };
  })()`);
}

async function memberOnboardingInstalledStorage(ctx) {
  const orgId = requireStateString(state.orgId, "organization id");
  return ctx.eval(`(() => {
    const orgId = ${JSON.stringify(orgId)};
    const key = 'openwork:member-onboarding:installed:' + orgId;
    return {
      orgId,
      key,
      value: localStorage.getItem(key),
      memberOnboardingKeys: Object.keys(localStorage).filter((candidate) => candidate.includes('openwork:member-onboarding')).sort(),
    };
  })()`);
}

async function fetchMemberVisibleResourceSummary(ctx) {
  const [marketplaces, plugins, providers] = await Promise.all([
    inviteeAuthedFetch("/v1/marketplaces?status=active&limit=100"),
    inviteeAuthedFetch("/v1/plugins?status=active&limit=100"),
    inviteeAuthedFetch("/v1/llm-providers?scope=usable"),
  ]);

  witness(ctx, marketplaces.response.ok, "Invitee can load member-visible marketplaces", { status: marketplaces.response.status });
  witness(ctx, plugins.response.ok, "Invitee can load member-visible plugins", { status: plugins.response.status });
  witness(ctx, providers.response.ok, "Invitee can load usable LLM providers", { status: providers.response.status });

  const marketplaceItems = Array.isArray(marketplaces.body?.items) ? marketplaces.body.items : [];
  const pluginItems = Array.isArray(plugins.body?.items) ? plugins.body.items : [];
  const llmProviders = Array.isArray(providers.body?.llmProviders) ? providers.body.llmProviders : [];
  const customProviders = llmProviders.filter((provider) => provider?.source !== "openwork");
  const openWorkProviders = llmProviders.filter((provider) => provider?.source === "openwork");
  const providerSources = llmProviders.map((provider) => String(provider?.source ?? "unknown")).sort();
  const expectations = {
    expectMarketplaces: marketplaceItems.length > 0,
    expectPlugins: pluginItems.length > 0,
    expectCustomProviders: customProviders.length > 0,
    expectOpenWorkModels: openWorkProviders.length > 0,
  };
  expectations.hasAnyResources = expectations.expectMarketplaces || expectations.expectPlugins || expectations.expectCustomProviders || expectations.expectOpenWorkModels;

  return {
    runTag: RUN_TAG,
    inviteeEmail: INVITEE_EMAIL,
    organizationId: state.orgId,
    expectations,
    counts: {
      marketplaces: marketplaceItems.length,
      plugins: pluginItems.length,
      llmProviders: llmProviders.length,
      customProviders: customProviders.length,
      openWorkProviders: openWorkProviders.length,
    },
    providerSources,
  };
}

async function waitForResourceDomToMatch(ctx, expectations) {
  await ctx.waitFor(`(() => {
    const expected = ${JSON.stringify(expectations)};
    const bodyText = document.body.innerText;
    const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].map((heading) => (heading.textContent ?? '').trim());
    const hasHeading = (label) => headings.includes(label);
    const overviewPresent = Boolean(document.querySelector('[data-testid="member-resource-overview"]'));
    const emptyPresent = Boolean(document.querySelector('[data-testid="member-resources-empty"]'));
    const loading = bodyText.includes('Loading your resources...');
    return !loading
      && Boolean(document.querySelector('[data-testid="member-onboarding-complete"]'))
      && headings.includes('Your workspace')
      && overviewPresent === expected.hasAnyResources
      && emptyPresent === !expected.hasAnyResources
      && hasHeading('LLM providers') === expected.expectCustomProviders
      && hasHeading('OpenWork Models') === expected.expectOpenWorkModels
      && hasHeading('Marketplaces') === expected.expectMarketplaces
      && hasHeading('Plugins') === expected.expectPlugins;
  })()`, { timeoutMs: 45_000, label: "member resource panels match API truth" });
}

async function resourceDomState(ctx) {
  return ctx.eval(`(() => {
    const headingTexts = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].map((heading) => (heading.textContent ?? '').trim());
    const hasHeading = (label) => headingTexts.includes(label);
    const complete = document.querySelector('[data-testid="member-onboarding-complete"]');
    return {
      bodyText: document.body.innerText,
      completePresent: Boolean(complete),
      completeText: (complete?.textContent ?? '').trim(),
      stepsPresent: Boolean(document.querySelector('[data-testid="member-onboarding-steps"]')),
      workspaceHeadingPresent: hasHeading('Your workspace'),
      resourceOverviewPresent: Boolean(document.querySelector('[data-testid="member-resource-overview"]')),
      resourcesEmptyPresent: Boolean(document.querySelector('[data-testid="member-resources-empty"]')),
      headings: {
        'LLM providers': hasHeading('LLM providers'),
        'OpenWork Models': hasHeading('OpenWork Models'),
        Marketplaces: hasHeading('Marketplaces'),
        Plugins: hasHeading('Plugins'),
      },
      headingTexts,
    };
  })()`);
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseResponseBody(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function invitationsFromPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.invitations)) {
    return payload.invitations;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  return [];
}

function compactInvitation(invitation) {
  return {
    email: invitation?.email,
    role: invitation?.role,
    status: invitation?.status,
  };
}

function compactOrg(payload) {
  return {
    id: payload?.organization?.id,
    name: payload?.organization?.name,
    slug: payload?.organization?.slug,
  };
}

function compactOrgPair(org) {
  return {
    name: org?.name,
    slug: org?.slug,
  };
}

function compactStateOrg() {
  return {
    id: state.orgId,
    name: state.orgName,
    slug: state.orgSlug,
  };
}

function compactOrgResponse(payload) {
  return {
    organization: compactOrg(payload),
    currentMember: payload?.currentMember,
    members: Array.isArray(payload?.members) ? payload.members.length : null,
    invitations: Array.isArray(payload?.invitations) ? payload.invitations.map(compactInvitation) : null,
  };
}

function redactAuthBody(body) {
  if (!body || typeof body !== "object") {
    return body;
  }
  return {
    token: typeof body.token === "string" ? "<present>" : undefined,
    user: body.user ? { id: body.user.id, email: body.user.email, emailVerified: body.user.emailVerified } : undefined,
    session: body.session ? { id: body.session.id, activeOrganizationId: body.session.activeOrganizationId } : undefined,
    body: body.token ? undefined : body,
  };
}
