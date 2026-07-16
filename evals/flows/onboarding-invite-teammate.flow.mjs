import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("onboarding-invite-teammate");
const RUN_TAG = Date.now().toString(36);

async function denRequest(ctx, path, init = {}) {
  const apiBase = ctx.env.OPENWORK_EVAL_DEN_API_URL.trim().replace(/\/+$/, "");
  const webBase = ctx.env.OPENWORK_EVAL_DEN_WEB_URL.trim().replace(/\/+$/, "");
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${ctx.env.OPENWORK_EVAL_DEN_TOKEN.trim()}`,
      "content-type": "application/json",
      origin: webBase || apiBase,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  ctx.assert(response.ok, `${init.method ?? "GET"} ${path} failed: ${response.status} ${text.slice(0, 200)}`);
  return body;
}

async function signInWithDesktopHandoff(ctx) {
  const payload = await denRequest(ctx, "/v1/auth/desktop-handoff", {
    method: "POST",
    body: JSON.stringify({ desktopScheme: "openwork" }),
  });
  ctx.assert(
    typeof payload?.openworkUrl === "string" && payload.openworkUrl.length > 0,
    "No openworkUrl in handoff response.",
  );
  const handoffUrl = new URL(payload.openworkUrl);
  handoffUrl.searchParams.set("denBaseUrl", ctx.env.OPENWORK_EVAL_DEN_WEB_URL.trim().replace(/\/+$/, ""));

  await ctx.navigateHash("/settings/cloud-account");
  await ctx.waitFor(
    `(() => {
      const text = document.body.innerText;
      return text.includes("Paste sign-in code") || text.includes("Sign out");
    })()`,
    { timeoutMs: 30_000, label: "cloud account state" },
  );

  if (await ctx.hasText("Sign out")) {
    ctx.log("Already signed in — skipping paste flow.");
    return;
  }

  await ctx.clickText("Paste sign-in code", { timeoutMs: 30_000 });
  await ctx.fill("#den-signin-link", handoffUrl.toString());
  await ctx.clickText("Finish sign-in", { timeoutMs: 30_000 });
  await ctx.waitFor(
    "Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim())",
    { timeoutMs: 60_000, label: "persisted den auth token" },
  );
}

async function completeLocalFirstRun(ctx) {
  // welcome-route marks local first-run complete when a real user signs in from
  // /welcome; this flow signs in through settings, so it records the same
  // preference before driving /onboarding (fixture, not product behavior).
  const completed = await ctx.eval(`(() => {
    const raw = localStorage.getItem("openwork.preferences");
    const prefs = raw ? JSON.parse(raw) : {};
    prefs.hasCompletedOnboarding = true;
    localStorage.setItem("openwork.preferences", JSON.stringify(prefs));
    return prefs.hasCompletedOnboarding;
  })()`);
  ctx.assert(completed === true, "Local first-run preference was not recorded.");
}

async function clickAcmeOrganization(ctx) {
  await ctx.clickText("Acme Robotics", {
    selector: "label, button, [role=button], [role=radio]",
    timeoutMs: 30_000,
  });
}

async function chooseAcmeIfPickerVisible(ctx) {
  if (!(await ctx.hasText("Choose your organization"))) return false;
  await clickAcmeOrganization(ctx);
  await ctx.clickText("Continue with organization", { selector: "button", timeoutMs: 30_000 });
  return true;
}

async function ensureAcmeResources(ctx) {
  await ctx.navigateHash("/onboarding");
  const landedOnWelcome = await ctx.eval(`new Promise((resolve) => {
    setTimeout(() => resolve(location.hash.includes("/welcome")), 500);
  })`, { awaitPromise: true });
  if (landedOnWelcome) {
    await completeLocalFirstRun(ctx);
    await ctx.navigateHash("/onboarding");
  }
  await ctx.waitFor(
    `(() => {
      const text = document.body.innerText;
      if (text.includes("Choose your organization") && text.includes("Acme Robotics")) return "picker";
      if (!text.includes("Choose your organization") && text.includes("Acme Robotics") && (text.includes("Continue to workspace") || text.includes("Continue"))) return "resources";
      return null;
    })()`,
    { timeoutMs: 60_000, label: "Acme picker or resources screen" },
  );
  await chooseAcmeIfPickerVisible(ctx);
  await ctx.waitFor(
    `(() => {
      const text = document.body.innerText;
      return !text.includes("Choose your organization") && text.includes("Acme Robotics") && (text.includes("You have access to the following resources") || text.includes("Continue to workspace") || text.includes("Continue"));
    })()`,
    { timeoutMs: 60_000, label: "Acme resources screen" },
  );
}

async function clickFooterContinue(ctx) {
  if (await ctx.hasText("Continue to workspace")) {
    await ctx.clickText("Continue to workspace", { selector: "button", timeoutMs: 30_000 });
    return;
  }
  await ctx.clickText("Continue", { selector: "button", timeoutMs: 30_000 });
}

async function waitForInviteScreen(ctx) {
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"invite-teammate-email\"]'))", {
    timeoutMs: 30_000,
    label: "invite teammate email field",
  });
}

async function continueFromInviteSuccess(ctx) {
  await ctx.clickText("Continue to workspace", { selector: "button", timeoutMs: 30_000 });
  const next = await ctx.waitFor(
    `(() => {
      const text = document.body.innerText;
      if (window.location.hash.includes("/session")) return "session";
      if (text.includes("Workspace identity is ready")) return "branding";
      return null;
    })()`,
    { timeoutMs: 60_000, label: "workspace route or branding restart" },
  );
  if (next === "branding") {
    await ctx.clickText("Continue without restarting", { selector: "button", timeoutMs: 30_000 });
    await ctx.waitFor("window.location.hash.includes('/session')", {
      timeoutMs: 60_000,
      label: "workspace session route after branding restart skip",
    });
  }
}

function orgInvitations(org) {
  return Array.isArray(org?.invitations) ? org.invitations : [];
}

function pendingInvitationsForEmail(org, email) {
  return orgInvitations(org).filter((entry) => entry?.email === email && entry?.status === "pending");
}

function pendingInvitationCount(org) {
  return orgInvitations(org).filter((entry) => entry?.status === "pending").length;
}

export default {
  id: "onboarding-invite-teammate",
  title: "Cloud onboarding invites a teammate before entering the workspace",
  kind: "user-facing",
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_TOKEN", "OPENWORK_EVAL_DEN_WEB_URL"],
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("Alex signs in, chooses Acme Robotics, and reviews the workspace resources", {
          voiceover: vo[0],
          action: async () => {
            await ctx.waitFor("Boolean(window.__openworkControl)", {
              timeoutMs: 60_000,
              label: "control API",
            });
            await signInWithDesktopHandoff(ctx);
            await completeLocalFirstRun(ctx);
            await ensureAcmeResources(ctx);
          },
          assert: async () => {
            await ctx.expectText("Acme Robotics", { timeoutMs: 5_000 });
            const hasResourcesText = await ctx.hasText("You have access to the following resources");
            ctx.assert(hasResourcesText || await ctx.hasText("Continue"), "Onboarding did not show the Acme resources step.");
          },
          screenshot: {
            name: "acme-onboarding-resources",
            requireText: ["Acme Robotics", "resources"],
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("Continuing from resources offers a skippable teammate invite", {
          voiceover: vo[1],
          action: async () => {
            await clickFooterContinue(ctx);
            await waitForInviteScreen(ctx);
          },
          assert: async () => {
            await ctx.expectText("Invite a teammate", { timeoutMs: 5_000 });
            await ctx.expectText("Skip for now", { timeoutMs: 5_000 });
          },
          screenshot: {
            name: "invite-teammate-form",
            requireText: ["Invite a teammate"],
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("Sending the invitation confirms it in the UI and in the organization payload", {
          voiceover: vo[2],
          action: async () => {
            ctx.inviteEmail = `taylor.invite+${RUN_TAG}@acme.test`;
            ctx.skipEmail = `taylor.skip+${RUN_TAG}@acme.test`;
            await ctx.fill('[data-testid="invite-teammate-email"]', ctx.inviteEmail);
            await ctx.clickText("Send invitation", { selector: "button", timeoutMs: 30_000 });
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"invite-teammate-success\"]'))", {
              timeoutMs: 60_000,
              label: "invite teammate success",
            });
          },
          assert: async () => {
            await ctx.expectText("Invitation sent", { timeoutMs: 5_000 });
            const org = await denRequest(ctx, "/v1/org", { method: "GET" });
            const invitations = pendingInvitationsForEmail(org, ctx.inviteEmail);
            ctx.assert(invitations.length > 0, `No pending invitation found for ${ctx.inviteEmail}.`);
            ctx.pendingInvitationCountAfterSend = pendingInvitationCount(org);
            ctx.output("pending-invitation", JSON.stringify(invitations[0], null, 2));
          },
          screenshot: {
            name: "invite-teammate-sent",
            requireText: ["Invitation sent"],
          },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("Alex continues from the confirmation into the workspace", {
          voiceover: vo[3],
          action: async () => {
            await continueFromInviteSuccess(ctx);
          },
          assert: async () => {
            await ctx.waitFor("window.location.hash.includes('/session')", {
              timeoutMs: 60_000,
              label: "workspace session route",
            });
          },
          screenshot: {
            name: "workspace-after-invite",
            hashIncludes: "/session",
          },
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        await ctx.prove("Coming back later, Alex skips the invite without creating another pending invitation", {
          voiceover: vo[4],
          action: async () => {
            await ensureAcmeResources(ctx);
            await clickFooterContinue(ctx);
            await waitForInviteScreen(ctx);
            await ctx.clickText("Skip for now", { selector: "button", timeoutMs: 30_000 });
            await ctx.waitFor("window.location.hash.includes('/session')", {
              timeoutMs: 60_000,
              label: "workspace session route after skipping invite",
            });
          },
          assert: async () => {
            const org = await denRequest(ctx, "/v1/org", { method: "GET" });
            const skipInvitations = pendingInvitationsForEmail(org, ctx.skipEmail);
            const pendingCount = pendingInvitationCount(org);
            ctx.assert(skipInvitations.length === 0, `Skip created an invitation for ${ctx.skipEmail}.`);
            ctx.assert(
              pendingCount === ctx.pendingInvitationCountAfterSend,
              `Pending invitations changed after skip: before=${ctx.pendingInvitationCountAfterSend} after=${pendingCount}.`,
            );
            ctx.output("skip-created-no-invitation", JSON.stringify({ skippedEmail: ctx.skipEmail, pendingCount }, null, 2));
          },
          screenshot: {
            name: "workspace-after-skip",
            hashIncludes: "/session",
          },
        });
      },
    },
  ],
};
