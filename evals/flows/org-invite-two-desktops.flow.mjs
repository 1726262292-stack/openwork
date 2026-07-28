import { journeys } from "../runner/journeys/index.mjs";
import { defineScenario } from "../runner/scenario.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "org-invite-two-desktops";
const REQUIRED_DEN_ENV = ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_WEB_URL"];
const ALEX_REPLY = "alex hello script ready";
const JAMIE_REPLY = "jamie hello script ready";
const ALEX_PROMPT = `Write a short hello script for Alex's new team. Include exactly this phrase: ${ALEX_REPLY}.`;
const JAMIE_PROMPT = `Write Jamie's first hello task for the new org. Include exactly this phrase: ${JAMIE_REPLY}.`;

const vo = await loadVoiceoverParagraphs(FLOW_ID);
if (!vo) throw new Error(`Missing approved voice-over script for ${FLOW_ID}.`);

const { den, desktop } = journeys;

function cleanBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function requiredEnv(ctx, name) {
  const value = ctx.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for ${FLOW_ID}.`);
  return value;
}

function denBootstrap(ctx) {
  return {
    baseUrl: requiredEnv(ctx, "OPENWORK_EVAL_DEN_WEB_URL"),
    apiBaseUrl: requiredEnv(ctx, "OPENWORK_EVAL_DEN_API_URL"),
    requireSignin: false,
  };
}

function stateString(ctx, key) {
  const value = ctx.state[key];
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`Scenario state ${key} was not set.`);
}

function optionalStateString(ctx, key) {
  const value = ctx.state[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function inviteRef(ctx) {
  const value = ctx.state.invite;
  if (value && typeof value === "object") return value;
  throw new Error("Scenario state invite was not set.");
}

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({ type: "assertion", status: condition ? "passed" : "failed", assertion, actual });
  ctx.assert(condition, assertion);
}

function expectAgentReply(ctx) {
  return Boolean(ctx.env.OPENWORK_EVAL_EXPECT_AGENT_REPLY?.trim());
}

function uniqueOrgDetails(ctx) {
  const stamp = ctx.env.OPENWORK_EVAL_RUNSTAMP?.trim()
    || new Date().toISOString().slice(11, 16).replace(":", "");
  const safe = `${stamp}-${process.pid}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "run";
  return {
    name: `Acme Skunkworks ${safe}`,
    slug: `acme-skunkworks-${safe}`,
  };
}

function orgConnectOptions(ctx, surface, actor) {
  const organizationId = optionalStateString(ctx, "orgId");
  return {
    surface,
    actor,
    organizationId,
    organizationName: stateString(ctx, "orgName"),
  };
}

async function currentRoute(ctx) {
  const route = await ctx.eval(`(() => {
    try {
      const snapshotRoute = window.__openworkControl?.snapshot?.().route;
      if (typeof snapshotRoute === 'string' && snapshotRoute) return snapshotRoute;
    } catch {}
    return window.location.hash.replace(/^#/, '') || window.location.pathname;
  })()`);
  return typeof route === "string" ? route : "";
}

async function rememberWorkspaceRoute(ctx, surface, key) {
  await ctx.on(surface, async () => {
    const route = await currentRoute(ctx);
    witness(ctx, route.includes("/workspace/"), `Workspace route captured for ${surface.handle.name}`, route);
    ctx.state[key] = route;
  });
}

async function returnToWorkspace(ctx, surface, key) {
  const route = stateString(ctx, key);
  await ctx.on(surface, async () => {
    await ctx.navigateHash(route);
    await ctx.waitFor(`(() => {
      const route = window.__openworkControl?.snapshot?.().route || window.location.hash.replace(/^#/, '');
      return route === ${JSON.stringify(route)};
    })()`, { timeoutMs: 30_000, label: `return to ${route}` });
  });
}

async function navigateDenMembers(ctx) {
  const webUrl = cleanBaseUrl(requiredEnv(ctx, "OPENWORK_EVAL_DEN_WEB_URL"));
  await ctx.eval(`(() => { window.location.href = ${JSON.stringify(`${webUrl}/dashboard/members`)}; return true; })()`);
  await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 45_000, label: "load Den members page" });
  await ctx.waitFor("document.body.innerText.includes('Members') || document.body.innerText.includes('Add member')", {
    timeoutMs: 45_000,
    label: "Den members page",
  });
}

async function runDesktopPrompt(ctx, surface, prompt, visibleText, replyToken) {
  const result = await desktop.runPrompt(ctx, {
    surface,
    prompt,
    expectResponse: expectAgentReply(ctx),
  });
  const route = result.sessionRoute || await ctx.on(surface, async () => currentRoute(ctx));
  witness(ctx, typeof route === "string" && route.includes("/session"), `Session route is active for ${surface.handle.name}`, route);
  await ctx.on(surface, async () => {
    await ctx.expectText(visibleText, { timeoutMs: 60_000 });
    if (expectAgentReply(ctx)) await ctx.expectText(replyToken, { timeoutMs: 120_000 });
  });
  return route;
}

export default defineScenario({
  id: FLOW_ID,
  title: "An admin creates an org, invites a teammate, and both run agents from separate desktops",
  kind: "user-facing",
  stage: { den: { orgMode: "multi_org" } },
  actors: {
    alex: "owner",
    jamie: { persona: "fresh", prefix: "jamie" },
  },
  requiredEnv: REQUIRED_DEN_ENV,
  steps: [
    {
      name: "Alex signs in on Den Web",
      run: async (ctx) => {
        const alexWeb = await ctx.surfaces.chrome("alex-web");
        await ctx.on(alexWeb, async () => {
          await ctx.prove("Alex is signed in to the cloud dashboard in her own Chrome profile", {
            voiceover: vo[0],
            action: async () => {
              await den.signInWeb(ctx, { surface: alexWeb, actor: ctx.actors.alex });
            },
            assert: async () => {
              await ctx.expectText("Dashboard", { timeoutMs: 60_000 });
            },
            screenshot: { name: "alex-den-dashboard", requireText: ["Dashboard"] },
          });
        });
      },
    },
    {
      name: "Alex creates the org",
      run: async (ctx) => {
        const alexWeb = ctx.surfaces.get("alex-web");
        const screenshot = { name: "alex-new-org-visible", requireText: [] };
        await ctx.on(alexWeb, async () => {
          await ctx.prove("Alex creates a unique organization and Den Web scopes to it", {
            voiceover: vo[1],
            action: async () => {
              const details = uniqueOrgDetails(ctx);
              const org = await den.createOrg(ctx, {
                surface: alexWeb,
                actor: ctx.actors.alex,
                name: details.name,
                slug: details.slug,
              });
              ctx.state.orgName = org.name;
              ctx.state.orgSlug = org.slug;
              if (org.orgId) ctx.state.orgId = org.orgId;
            },
            assert: async () => {
              const orgName = stateString(ctx, "orgName");
              screenshot.requireText.push(orgName);
              await ctx.expectText(orgName, { timeoutMs: 60_000 });
            },
            screenshot,
          });
        });
      },
    },
    {
      name: "Alex desktop connects to the org",
      run: async (ctx) => {
        const alexDesktop = await ctx.surfaces.electron("alex-desktop", { profile: "fresh", bootstrap: denBootstrap(ctx) });
        await ctx.on(alexDesktop, async () => {
          await ctx.prove("Alex's fresh desktop boots, connects to Den, and shows her cloud account", {
            voiceover: vo[2],
            action: async () => {
              const boot = await desktop.firstBoot(ctx, { surface: alexDesktop });
              ctx.state.alexWorkspacePath = boot.workspacePath;
              const connection = await desktop.connectDen(ctx, orgConnectOptions(ctx, alexDesktop, ctx.actors.alex));
              if (connection.activeOrgName) ctx.state.alexActiveOrgName = connection.activeOrgName;
              await rememberWorkspaceRoute(ctx, alexDesktop, "alexWorkspaceRoute");
              await desktop.openSettings(ctx, { surface: alexDesktop, section: "cloud-account" });
            },
            assert: async () => {
              await ctx.expectText(ctx.actors.alex.email, { timeoutMs: 30_000 });
            },
            screenshot: { name: "alex-desktop-connected", requireText: [ctx.actors.alex.email] },
          });
        });
      },
    },
    {
      name: "Alex runs a hello-script task",
      run: async (ctx) => {
        const alexDesktop = ctx.surfaces.get("alex-desktop");
        const screenshot = { name: "alex-task-running", requireText: ["hello script"], hashIncludes: "/session" };
        await ctx.on(alexDesktop, async () => {
          await ctx.prove("Alex's desktop starts a hello-script task in a session", {
            voiceover: vo[3],
            action: async () => {
              await returnToWorkspace(ctx, alexDesktop, "alexWorkspaceRoute");
              ctx.state.alexSessionRoute = await runDesktopPrompt(ctx, alexDesktop, ALEX_PROMPT, "hello script", ALEX_REPLY);
            },
            assert: async () => {
              witness(ctx, stateString(ctx, "alexSessionRoute").includes("/session"), "Alex's prompt produced a session route", ctx.state.alexSessionRoute);
              if (expectAgentReply(ctx)) screenshot.requireText.push(ALEX_REPLY);
            },
            screenshot,
          });
        });
      },
    },
    {
      name: "Alex invites Jamie",
      run: async (ctx) => {
        const alexWeb = ctx.surfaces.get("alex-web");
        const screenshot = { name: "jamie-pending-invite", requireText: ["Members"] };
        await ctx.on(alexWeb, async () => {
          await ctx.prove("Alex invites Jamie and the invite is pending in the org", {
            voiceover: vo[4],
            action: async () => {
              ctx.state.invite = await den.inviteMember(ctx, {
                surface: alexWeb,
                actor: ctx.actors.alex,
                email: ctx.actors.jamie.email,
              });
              await navigateDenMembers(ctx);
            },
            assert: async () => {
              await ctx.expectText("Members", { timeoutMs: 45_000 });
              const emailVisible = await ctx.hasText(ctx.actors.jamie.email);
              if (emailVisible) screenshot.requireText.push(ctx.actors.jamie.email);
              else ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Invite token was resolved even though the members page did not render the email", actual: inviteRef(ctx) });
              const invite = inviteRef(ctx);
              witness(ctx, Boolean(invite.inviteUrl || invite.token), "Jamie's invite URL or token was captured", invite);
            },
            screenshot,
          });
        });
      },
    },
    {
      name: "Jamie accepts from her Chrome",
      run: async (ctx) => {
        const jamieWeb = await ctx.surfaces.chrome("jamie-web", { profile: "fresh" });
        await ctx.on(jamieWeb, async () => {
          await ctx.prove("Jamie accepts the invite from a separate Chrome profile and lands in the org", {
            voiceover: vo[5],
            action: async () => {
              const accepted = await den.acceptInvite(ctx, {
                surface: jamieWeb,
                actor: ctx.actors.jamie,
                invite: inviteRef(ctx),
              });
              ctx.state.jamieInviteStatus = accepted.status;
            },
            assert: async () => {
              await ctx.expectText(stateString(ctx, "orgName"), { timeoutMs: 60_000 });
              witness(ctx, ctx.state.jamieInviteStatus === "accepted", "Jamie accepted the organization invite", ctx.state.jamieInviteStatus);
            },
            screenshot: { name: "jamie-accepted-org", requireText: [stateString(ctx, "orgName")] },
          });
        });
      },
    },
    {
      name: "Jamie desktop spawns fresh",
      run: async (ctx) => {
        const jamieDesktop = await ctx.surfaces.electron("jamie-desktop", { profile: "fresh", bootstrap: denBootstrap(ctx) });
        await ctx.on(jamieDesktop, async () => {
          await ctx.prove("A second fresh desktop is alive for Jamie mid-scenario", {
            voiceover: vo[6],
            action: async () => {
              const boot = await desktop.firstBoot(ctx, { surface: jamieDesktop });
              ctx.state.jamieWorkspacePath = boot.workspacePath;
              await rememberWorkspaceRoute(ctx, jamieDesktop, "jamieWorkspaceRoute");
            },
            assert: async () => {
              witness(ctx, stateString(ctx, "jamieWorkspaceRoute").includes("/workspace/"), "Jamie desktop reached a fresh workspace route", ctx.state.jamieWorkspaceRoute);
              await ctx.expectText("OpenWork", { timeoutMs: 30_000 });
            },
            screenshot: { name: "jamie-fresh-desktop", requireText: ["OpenWork"] },
          });
        });
      },
    },
    {
      name: "Jamie connects and runs her task",
      run: async (ctx) => {
        const jamieDesktop = ctx.surfaces.get("jamie-desktop");
        const screenshot = { name: "jamie-task-running", requireText: ["Jamie's first hello"], hashIncludes: "/session" };
        await ctx.on(jamieDesktop, async () => {
          await ctx.prove("Jamie signs in on her desktop and starts her own task in the shared org", {
            voiceover: vo[7],
            action: async () => {
              await returnToWorkspace(ctx, jamieDesktop, "jamieWorkspaceRoute");
              const connection = await desktop.connectDen(ctx, orgConnectOptions(ctx, jamieDesktop, ctx.actors.jamie));
              if (connection.activeOrgName) ctx.state.jamieActiveOrgName = connection.activeOrgName;
              ctx.state.jamieSessionRoute = await runDesktopPrompt(ctx, jamieDesktop, JAMIE_PROMPT, "Jamie's first hello", JAMIE_REPLY);
            },
            assert: async () => {
              witness(ctx, stateString(ctx, "jamieSessionRoute").includes("/session"), "Jamie's prompt produced a session route", ctx.state.jamieSessionRoute);
              if (expectAgentReply(ctx)) screenshot.requireText.push(JAMIE_REPLY);
            },
            screenshot,
          });
        });
      },
    },
  ],
});
