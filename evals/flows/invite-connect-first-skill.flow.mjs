import { execSync } from "node:child_process";
import { connect, debuggerUrlFor, listTargets } from "../runner/cdp.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Narration is loaded from the approved script (evals/voiceovers/invite-connect-first-skill.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs("invite-connect-first-skill");

const DEN_API_URL = cleanBaseUrl(process.env.OPENWORK_EVAL_DEN_API_URL);
const DEN_WEB_URL = cleanBaseUrl(process.env.OPENWORK_EVAL_DEN_WEB_URL);
const WEB_CDP_URL = cleanBaseUrl(process.env.OPENWORK_EVAL_WEB_CDP_URL);
const MARK_VERIFIED_CMD = process.env.OPENWORK_EVAL_MARK_VERIFIED_CMD?.trim() || "";
const ADMIN_EMAIL = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";
const MEMBER_PASSWORD = process.env.OPENWORK_EVAL_MEMBER_PASSWORD?.trim() || "OpenWorkDemo123!";
const PUBLIC_MOCK_MCP_URL = process.env.OPENWORK_EVAL_PUBLIC_MOCK_MCP_URL?.trim() || "";
const EXPLICIT_MOCK_REQUESTS_URL = process.env.OPENWORK_EVAL_PUBLIC_MOCK_MCP_REQUESTS_URL?.trim() || "";
const MOCK_INSPECTION_URL = process.env.OPENWORK_EVAL_PUBLIC_MOCK_MCP_INSPECTION_URL?.trim() || "";

const RUN_TAG = Date.now().toString(36);
const RUN_NONCE = `inactive-account-check-${RUN_TAG}`;
const INVITEE_EMAIL = `morgan+${RUN_TAG}@acme.test`;
const ORG_NAME = "Acme Robotics";
const PLUGIN_NAME = "Inactive Account Check";
const MCP_COMPONENT_NAME = "Employee Directory";
const SUGGESTED_PROMPT = "Show me which employee accounts have been inactive for 30 days.";
const MCP_URL = buildPublicMcpUrl(PUBLIC_MOCK_MCP_URL, RUN_TAG);
const MOCK_REQUESTS_URL = buildMockRequestsUrl({ mcpUrl: MCP_URL, explicitRequestsUrl: EXPLICIT_MOCK_REQUESTS_URL, inspectionUrl: MOCK_INSPECTION_URL });

const state = {
  desktopClient: null,
  webClient: null,
  installClient: null,
  adminToken: null,
  memberToken: null,
  inviteLink: null,
  inviteToken: null,
  installPageUrl: null,
  pluginId: null,
  denSkillId: null,
  connectionId: null,
  connectionName: null,
  openworkUrl: null,
  workspaceId: null,
  sessionId: null,
  chatStartedAt: null,
};

export default {
  id: "invite-connect-first-skill",
  title: "An invited teammate completes their first admin-provided workflow through OpenWork Connect",
  kind: "user-facing",
  requiredEnv: [
    "OPENWORK_EVAL_DEN_API_URL",
    "OPENWORK_EVAL_DEN_WEB_URL",
    "OPENWORK_EVAL_WEB_CDP_URL",
    "OPENWORK_EVAL_MARK_VERIFIED_CMD",
    "OPENWORK_EVAL_PUBLIC_MOCK_MCP_URL",
  ],
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        rememberDesktopClient(ctx);
        await withWebClient(ctx, async () => {
          await ctx.prove("The admin creates the Inactive Account Check bundle from the real plugin editor", {
            voiceover: vo[0],
            action: async () => {
              await assertMockServerReady(ctx);
              await ensureAdminToken(ctx);
              await cleanupStalePluginBundles(ctx);
              await signInToDenWeb(ctx, ADMIN_EMAIL, ADMIN_PASSWORD);
              await selectOrganizationThroughUi(ctx, ORG_NAME);
              await openAdminRoute(ctx, "/dashboard/plugins/new", ORG_NAME, "Create a plugin");
              await ctx.waitFor("location.pathname.endsWith('/dashboard/plugins/new') || location.pathname.includes('/dashboard/plugins/new')", { timeoutMs: 30_000, label: "plugin editor route" });
              await createPluginBundleThroughUi(ctx);
            },
            assert: async () => {
              await ctx.expectText(PLUGIN_NAME, { timeoutMs: 45_000 });
              await ctx.expectText("SKILLS", { timeoutMs: 20_000 });
              await ctx.expectText("MCP SERVERS", { timeoutMs: 20_000 });
              await ctx.expectText("HTTP · OpenWork Connect", { timeoutMs: 20_000 });
              const bundle = await assertCreatedPluginBundle(ctx);
              ctx.output("created-plugin-bundle", JSON.stringify(bundle, null, 2));
            },
            screenshot: {
              name: "admin-plugin-bundle-ready",
              requireText: [PLUGIN_NAME, "SKILLS", "MCP SERVERS", MCP_COMPONENT_NAME, "HTTP · OpenWork Connect"],
              rejectText: ["Failed to create", "Something went wrong"],
            },
          });
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await withWebClient(ctx, async () => {
          await ctx.prove("The invite email names the inviter, organization, role, and one clear get-started action", {
            voiceover: vo[1],
            action: async () => {
              await openAdminRoute(ctx, "/dashboard/members", ORG_NAME, "Invite teammates");
              await clickExactText(ctx, "Add member", "button");
              await ctx.fill('input[placeholder="teammate@example.com"]', INVITEE_EMAIL);
              await clickExactText(ctx, "Send invite", "button");
              await ctx.waitForText(INVITEE_EMAIL, { timeoutMs: 30_000 });
              await ctx.waitForText("Pending", { timeoutMs: 20_000 });
              await navigateToAbsolute(ctx, `${DEN_API_URL}/v1/dev/emails/last?template=organizationInvite`);
              await ctx.waitForText("Accept invite", { timeoutMs: 20_000 });
            },
            assert: async () => {
              const { entry, html } = await getLatestDevEmail(ctx, "organizationInvite", INVITEE_EMAIL);
              ctx.assert(html.includes(ADMIN_EMAIL), "Invite email does not identify the administrator email.");
              ctx.assert(html.includes(ORG_NAME), "Invite email does not identify the organization.");
              ctx.assert(/\bmember\b/i.test(html), "Invite email does not identify member access.");
              ctx.assert(html.includes("Accept invite"), "Invite email is missing the primary accept action.");
              const invite = extractInviteFromHtml(html, ctx);
              state.inviteToken = invite.token;
              state.inviteLink = rewriteDenWebLink(invite.link);
              const installUrl = extractInstallFromHtml(html, ctx);
              state.installPageUrl = rewriteDenWebLink(installUrl);
              ctx.output("invite-email", JSON.stringify({ to: entry.to, subject: entry.subject, inviteLink: state.inviteLink, installPageUrl: state.installPageUrl }, null, 2));
              await ctx.expectText("OPENWORK INVITE");
              await ctx.expectText("Join Acme Robotics");
              await ctx.expectText("Accept invite");
            },
            screenshot: {
              name: "invite-email",
              requireText: ["OPENWORK INVITE", "Join Acme Robotics", "Accept invite", "Download the desktop app"],
              rejectText: ["Something went wrong"],
            },
          });
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await withWebClient(ctx, async () => {
          await ctx.prove("The invite page keeps the teammate in place while they create, verify, and accept their account", {
            voiceover: vo[2],
            action: async () => {
              await clearDenWebSession(ctx);
              await navigateToAbsolute(ctx, requireStateValue(state.inviteLink, "invite link"));
              await ctx.waitForText(ORG_NAME, { timeoutMs: 45_000 });
              await ctx.waitForText("Your team is already set up and waiting.", { timeoutMs: 20_000 });
              await completeInviteSignup(ctx, INVITEE_EMAIL, MEMBER_PASSWORD);
              state.memberToken = await signInAndReturnToken(ctx, INVITEE_EMAIL, MEMBER_PASSWORD);
              state.installPageUrl = await ctx.eval("document.querySelector('[data-testid=\"join-org-download\"]')?.href ?? null") || state.installPageUrl;
            },
            assert: async () => {
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"join-org-success\"]'))", { timeoutMs: 45_000, label: "join org success" });
              await ctx.expectText("You're in");
              await ctx.expectText(ORG_NAME);
              await ctx.expectText("Join team");
              ctx.assert(typeof state.installPageUrl === "string" && state.installPageUrl.includes("/install?token="), "Join success did not preserve the team install link.");
            },
            screenshot: {
              name: "invite-accepted-with-place-preserved",
              requireText: ["You're in", ORG_NAME, "Join team"],
              rejectText: ["This invite can't be opened", "Something went wrong"],
            },
          });
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await withWebClient(ctx, async () => {
          await ctx.prove("The browser success page maps the teammate's remaining journey and current step", {
            voiceover: vo[3],
            action: async () => {
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"join-org-success\"]'))", { timeoutMs: 45_000, label: "join success still open" });
              await ctx.eval("document.querySelector('[data-testid=\"join-org-journey-map\"]')?.scrollIntoView({ block: 'center' })");
              // Step through the page as a keyboard user would; the real Tab
              // keypress draws a :focus-visible ring on the current step's
              // primary download action, which also keeps this frame visually
              // distinct from frame 3's acceptance capture.
              await ctx.eval("document.body.focus()");
              for (let presses = 0; presses < 12; presses += 1) {
                await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
                await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
                const focused = await ctx.eval("document.activeElement?.getAttribute('data-testid') ?? ''");
                if (focused === "join-org-download") break;
              }
              const focusedAction = await ctx.eval("document.activeElement?.getAttribute('data-testid') ?? ''");
              ctx.assert(focusedAction === "join-org-download", `Keyboard focus did not land on the journey download action: ${focusedAction}`);
            },
            assert: async () => {
              await ctx.expectText("Join team");
              await ctx.expectText("Download app");
              await ctx.expectText("Connect and try your first workflow");
              const stepState = await ctx.eval(`(() => ({
                step1: document.querySelector('[data-testid="join-org-step-1"]')?.innerText ?? '',
                step2Current: document.querySelector('[data-testid="join-org-step-2"]')?.getAttribute('aria-current') === 'step',
                step3: document.querySelector('[data-testid="join-org-step-3"]')?.innerText ?? '',
              }))()`);
              ctx.assert(stepState.step1.includes("Done"), `Join step was not marked done: ${JSON.stringify(stepState)}`);
              ctx.assert(stepState.step2Current, "Download step was not marked as the current journey step.");
              ctx.assert(stepState.step3.includes("Up next"), `Workflow step was not marked up next: ${JSON.stringify(stepState)}`);
            },
            screenshot: {
              name: "browser-journey-map",
              requireText: ["Join team", "Download app", "Current", "Connect and try your first workflow", "Up next"],
              rejectText: ["Something went wrong"],
            },
          });
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        await withWebClient(ctx, async () => {
          // The journey map's download action opens the team install page in
          // a new tab, so the invitee's remaining steps stay visible.
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"join-org-download\"]'))", { timeoutMs: 30_000, label: "journey download action" });
          await ctx.eval("document.querySelector('[data-testid=\"join-org-download\"]')?.click()");
        });
        await connectInstallTab(ctx);
        await withInstallTab(ctx, async () => {
          await ctx.prove("The install page recommends the right installer and starts from one primary action", {
            voiceover: vo[4],
            action: async () => {
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"install-card\"]'))", { timeoutMs: 45_000, label: "install card" });
              await ctx.client.send("Network.enable").catch(() => undefined);
              await ctx.client.send("Network.emulateNetworkConditions", {
                offline: false,
                latency: 15_000,
                downloadThroughput: 50_000,
                uploadThroughput: 50_000,
                connectionType: "cellular3g",
              });
              await ctx.eval(`(() => {
                const preventDefaultOnce = (event) => event.preventDefault();
                document.addEventListener('click', preventDefaultOnce, { capture: true, once: true });
                document.querySelector('[data-testid="install-download-primary"]')?.click();
                return true;
              })()`);
              await ctx.waitForText("Checking this install link...", { timeoutMs: 2_000 });
            },
            assert: async () => {
              const primary = await ctx.eval("document.querySelector('[data-testid=\"install-download-primary\"]')?.textContent?.trim() ?? ''");
              ctx.assert(primary.startsWith("Download for "), `Primary installer label was not a recommendation: ${primary}`);
              await ctx.expectText("Windows");
              await ctx.expectText("Linux (x64)");
              await ctx.expectText("Checking this install link...");
            },
            screenshot: {
              name: "recommended-installer-started",
              requireText: ["Download OpenWork for Acme Robotics", "Download for", "Windows", "Checking this install link..."],
              rejectText: ["This install link can't be opened", "Something went wrong"],
            },
          });
        });
      },
    },
    {
      name: "Frame 6",
      run: async (ctx) => {
        await withInstallTab(ctx, async () => {
          await ctx.prove("The installer preparation indicator moves and advances through meaningful stages", {
            voiceover: vo[5],
            action: async () => {
              await ctx.waitForText("Preparing your team package...", { timeoutMs: 8_000 });
              await ctx.waitForText("Fetching release artifacts...", { timeoutMs: 14_000 });
            },
            assert: async () => {
              const firstSpinner = await ctx.eval(`(() => {
                const element = document.querySelector('[data-testid="install-download-spinner"]');
                if (!element) return null;
                const style = getComputedStyle(element);
                return { animationName: style.animationName, animationDuration: style.animationDuration, transform: style.transform };
              })()`);
              await new Promise((resolve) => setTimeout(resolve, 180));
              const secondTransform = await ctx.eval("getComputedStyle(document.querySelector('[data-testid=\"install-download-spinner\"]')).transform");
              ctx.assert(Boolean(firstSpinner), "Install download spinner was not rendered.");
              ctx.assert(firstSpinner.animationName.includes("spin"), `Spinner animation was not spin: ${JSON.stringify(firstSpinner)}`);
              ctx.assert(firstSpinner.animationDuration === "1s", `Spinner animation duration changed: ${JSON.stringify(firstSpinner)}`);
              ctx.assert(firstSpinner.transform !== secondTransform, `Spinner transform did not move across frames: ${firstSpinner.transform}`);
              await ctx.expectText("Fetching release artifacts...");
              ctx.output("install-motion-proof", JSON.stringify({ first: firstSpinner, secondTransform, sampleDelayMs: 180 }, null, 2));
            },
            screenshot: {
              name: "installer-preparation-stages",
              requireText: ["Fetching release artifacts...", "First-time downloads can take a minute"],
              rejectText: ["Download was not requested", "Something went wrong"],
            },
          });
          await restoreNetworkConditions(ctx);
        });
      },
    },
    {
      name: "Frame 7",
      run: async (ctx) => {
        await withInstallTab(ctx, async () => {
          await ctx.prove("The page confirms the automatic browser download request and gives one concise install instruction", {
            voiceover: vo[6],
            action: async () => {
              await restoreNetworkConditions(ctx);
              await ctx.waitFor("document.body.innerText.includes('download requested') || document.body.innerText.includes('Download started')", { timeoutMs: 45_000, label: "download requested confirmation" });
            },
            assert: async () => {
              const status = await ctx.eval("document.querySelector('[data-testid=install-download-status]')?.innerText ?? ''");
              ctx.assert(/download requested|Download started/i.test(status), `Install page did not confirm the browser download request: ${status}`);
              ctx.assert(status.includes("Check your downloads") || status.includes("browser"), `Install instruction was not concise: ${status}`);
              await ctx.expectText("Try again");
            },
            screenshot: {
              name: "installer-download-requested",
              requireText: ["download requested", "Check your downloads", "Try again"],
              rejectText: ["Download was not requested", "Something went wrong"],
            },
          });
        });
      },
    },
    {
      name: "Frame 8",
      run: async (ctx) => {
        useDesktopClient(ctx);
        await ctx.prove("The Electron app accepts the invitee's secure Den handoff through the renderer deep-link bridge", {
          voiceover: vo[7],
          action: async () => {
            await withWebClient(ctx, async () => {
              // The journey tab stayed open because the installer downloaded
              // in its own tab; the invitee continues from step 3 directly.
              await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"join-org-success\"]'))", { timeoutMs: 30_000, label: "journey tab still open" });
              await stubClipboardCapture(ctx);
              await clickExactText(ctx, "Copy sign-in link", "button");
              state.openworkUrl = await ctx.waitFor(
                "typeof window.__capturedSignin === 'string' && window.__capturedSignin.startsWith('openwork://den-auth') && window.__capturedSignin",
                { timeoutMs: 30_000, label: "browser-created OpenWork sign-in link" },
              );
            });
            useDesktopClient(ctx);
            await ensureDesktopReady(ctx);
            await prepareDesktopForDenHandoff(ctx);
            const openworkUrl = requireStateValue(state.openworkUrl, "browser-created desktop handoff");
            ctx.assert(/^openwork:\/\/den-auth\?/.test(openworkUrl), `Unexpected handoff URL: ${openworkUrl}`);
            ctx.assert(openworkUrl.includes("grant=") && openworkUrl.includes("denBaseUrl="), `Handoff URL is missing grant or denBaseUrl: ${openworkUrl}`);
            await deliverDeepLinkToDesktop(ctx, openworkUrl);
          },
          assert: async () => {
            await ctx.waitFor("Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim())", { timeoutMs: 60_000, label: "desktop Den auth token" });
            await ctx.waitFor("(localStorage.getItem('openwork.den.activeOrgName') ?? '').includes('Acme Robotics')", { timeoutMs: 60_000, label: "active Acme org" });
            // The Cloud Account surface is the strongest visible witness that
            // the handoff signed this exact invitee into the invited org.
            await ctx.navigateHash("/settings/cloud-account");
            await ctx.waitForText("Sign out", { timeoutMs: 45_000 });
            await ctx.expectText(ORG_NAME, { timeoutMs: 45_000 });
            await ctx.expectText(INVITEE_EMAIL, { timeoutMs: 45_000 });
            ctx.output("desktop-deep-link-bridge", `Delivered ${state.openworkUrl} through window.dispatchEvent(new CustomEvent('openwork:deep-link', { detail: { urls: [...] } })) — the renderer bridge consumed the same openwork://den-auth grant shape used by native deep links.`);
          },
          screenshot: {
            name: "desktop-signed-into-organization",
            requireText: [ORG_NAME, INVITEE_EMAIL, "Sign out"],
            rejectText: ["Choose your organization", "Something went wrong"],
          },
        });
        // The remaining frames run entirely in Electron; release the
        // standalone Chrome CDP socket so the runner process can exit cleanly.
        closeWebClient();
      },
    },
    {
      name: "Frame 9",
      run: async (ctx) => {
        useDesktopClient(ctx);
        await ctx.prove("OpenWork presents the admin-provided skill and connection as one ready first workflow", {
          voiceover: vo[8],
          action: async () => {
            await ensureDesktopReady(ctx);
            await ctx.navigateHash("/onboarding");
            await ctx.waitFor("Boolean(document.querySelector('[data-openwork-first-workflow=\"true\"]'))", { timeoutMs: 90_000, label: "first workflow card" });
            await ctx.eval("document.querySelector('[data-openwork-first-workflow=\"true\"]')?.scrollIntoView({ block: 'center' })");
          },
          assert: async () => {
            await ctx.expectText("Organization connected");
            await ctx.expectText(PLUGIN_NAME);
            await ctx.expectText("OpenWork Connect");
            await ctx.expectText(SUGGESTED_PROMPT);
            const firstWorkflow = await ctx.eval(`(() => {
              const card = document.querySelector('[data-openwork-first-workflow="true"]');
              return {
                skill: card?.getAttribute('data-openwork-first-workflow-skill') ?? '',
                connection: card?.getAttribute('data-openwork-first-workflow-connection') ?? '',
                text: card?.innerText ?? '',
              };
            })()`);
            ctx.assert(firstWorkflow.skill === PLUGIN_NAME, `Unexpected first workflow skill: ${JSON.stringify(firstWorkflow)}`);
            ctx.assert(firstWorkflow.connection.includes(MCP_COMPONENT_NAME), `Unexpected first workflow connection: ${JSON.stringify(firstWorkflow)}`);
            ctx.assert(firstWorkflow.text.includes("connection ready"), `Connection was not presented as ready: ${JSON.stringify(firstWorkflow)}`);
          },
          screenshot: {
            name: "desktop-first-workflow-ready",
            requireText: ["Organization connected", PLUGIN_NAME, "OpenWork Connect", SUGGESTED_PROMPT, "connection ready"],
            rejectText: ["No resources have been configured", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 10",
      run: async (ctx) => {
        useDesktopClient(ctx);
        await ctx.prove("The suggested first action opens a chat with the exact administrator-provided prompt", {
          voiceover: vo[9],
          action: async () => {
              await clickExactText(ctx, "Start inactive account check", "button");
              // The product owns everything from here: it saves the prompt,
              // creates the task, and mounts the composer with the draft.
              // Creating workspaces/tasks from the eval here would race that
              // handoff and navigate away from the drafted session.
              await ctx.waitFor("location.hash.includes('/session')", { timeoutMs: 60_000, label: "session route after first workflow CTA" });
              await ctx.waitFor("Boolean(document.querySelector('[contenteditable=\"true\"][data-lexical-editor=\"true\"]'))", { timeoutMs: 90_000, label: "chat composer" });
              await waitForPromptInComposer(ctx, SUGGESTED_PROMPT);
              await rememberCurrentSession(ctx);
              await waitForCloudControlMcpSync(ctx);
              // OpenCode loads MCP servers at engine startup, so wait until
              // the runtime actually serves the authenticated /mcp/agent
              // connection (engineSync ok) before running the first task.
              await waitForRuntimeCloudControlMcp(ctx);
          },
          assert: async () => {
            const composer = await composerText(ctx);
            ctx.assert(composer.includes(SUGGESTED_PROMPT), `Composer did not contain the exact suggested prompt: ${composer}`);
            await ctx.expectText("Run task", { timeoutMs: 30_000 });
          },
          screenshot: {
            name: "first-action-prompt-ready",
            requireText: [SUGGESTED_PROMPT, "Run task"],
            rejectText: ["No resources have been configured", "Something went wrong"],
          },
        });
        state.chatStartedAt = new Date().toISOString();
        await clickExactText(ctx, "Run task", "button");
        await rememberCurrentSession(ctx);
      },
    },
    {
      name: "Frame 11",
      run: async (ctx) => {
        useDesktopClient(ctx);
        await ctx.prove("The running task shows clear activity while the agent loads the org skill", {
          voiceover: vo[10],
          action: async () => {
            // Visible in-flight activity: either the Stop affordance or a
            // rendered cloud-capability tool card. Fast agent turns can drop
            // Stop before we capture, so accept both signals.
            await ctx.waitFor(
              `Boolean([...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Stop')) || document.body.innerText.toLowerCase().includes('search capabilities')`,
              { timeoutMs: 45_000, label: "running task activity" },
            );
          },
          assert: async () => {
            await rememberCurrentSession(ctx);
            const witness = await waitForTranscriptSequence(ctx, { requireFullSequence: false, timeoutMs: 120_000 });
            ctx.output("frame-11-transcript-witness", JSON.stringify(witness.summary, null, 2));
            await ctx.waitFor(
              "document.body.innerText.toLowerCase().includes('capabilit')",
              { timeoutMs: 30_000, label: "visible capability activity card" },
            );
          },
          screenshot: {
            name: "agent-running-activity",
            // The prompt bubble scrolls out of the viewport as activity
            // streams in; the claim here is the visible capability activity.
            requireText: ["capabilities"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 12",
      run: async (ctx) => {
        useDesktopClient(ctx);
        await ctx.prove("The completed workspace result lists inactive accounts and records the Employee Directory connection", {
          voiceover: vo[11],
          action: async () => {
            await ctx.waitFor("!Boolean([...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Stop'))", { timeoutMs: 240_000, label: "assistant finished" });
            await ctx.waitFor("document.body.innerText.includes('Maya Chen') && document.body.innerText.includes('Theo Ramirez') && document.body.innerText.includes('Nora Patel')", { timeoutMs: 120_000, label: "inactive employee result" });
          },
          assert: async () => {
            await ctx.expectText("Maya Chen", { timeoutMs: 10_000 });
            await ctx.expectText("Theo Ramirez", { timeoutMs: 10_000 });
            await ctx.expectText("Nora Patel", { timeoutMs: 10_000 });
            await ctx.expectText(MCP_COMPONENT_NAME, { timeoutMs: 10_000 });
            const transcript = await waitForTranscriptSequence(ctx, { requireFullSequence: true, timeoutMs: 30_000 });
            ctx.output("frame-12-transcript-witness", JSON.stringify(transcript.summary, null, 2));
            const mockWitness = await assertFreshMockMcpCall(ctx);
            ctx.output("mock-mcp-call-witness", JSON.stringify(mockWitness, null, 2));
          },
          screenshot: {
            name: "inactive-account-check-complete",
            requireText: ["Maya Chen", "Theo Ramirez", "Nora Patel", MCP_COMPONENT_NAME],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
  ],
};

function cleanBaseUrl(value) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function buildPublicMcpUrl(value, runTag) {
  const raw = value.trim();
  if (!raw) return "";
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error(`OPENWORK_EVAL_PUBLIC_MOCK_MCP_URL must be public https://, got ${raw}`);
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!path || path === "/") {
    url.pathname = "/mcp";
  } else if (!path.endsWith("/mcp")) {
    url.pathname = `${path}/mcp`;
  }
  url.searchParams.set("run", runTag);
  return url.toString();
}

function buildMockRequestsUrl({ mcpUrl, explicitRequestsUrl, inspectionUrl }) {
  const explicit = explicitRequestsUrl || inspectionUrl;
  if (explicit) {
    const url = new URL(explicit);
    if (!url.pathname.endsWith("/requests")) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/requests`;
    }
    url.search = "";
    return url.toString();
  }
  if (!mcpUrl) return "";
  const url = new URL(mcpUrl);
  url.pathname = "/requests";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function rememberDesktopClient(ctx) {
  if (!state.desktopClient) {
    state.desktopClient = ctx.client;
  }
}

function useDesktopClient(ctx) {
  rememberDesktopClient(ctx);
  ctx.client = state.desktopClient;
}

function requireStateValue(value, label) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  throw new Error(`${label} was not prepared by an earlier frame.`);
}

async function withWebClient(ctx, fn) {
  const previous = ctx.client;
  // One persistent CDP session for the whole browser journey: Chrome scopes
  // Network.emulateNetworkConditions to the session that enabled it, so a
  // per-frame connect/close would silently drop the throttled preparation
  // wait between frames 5 and 6.
  if (!state.webClient) {
    const target = await firstPageTarget(WEB_CDP_URL);
    state.webClient = await connect(debuggerUrlFor(WEB_CDP_URL, target));
  }
  ctx.client = state.webClient;
  try {
    return await fn();
  } finally {
    ctx.client = previous;
  }
}

function closeWebClient() {
  for (const key of ["webClient", "installClient"]) {
    try {
      state[key]?.close();
    } catch {
      // Socket already gone.
    }
    state[key] = null;
  }
}

async function connectInstallTab(ctx) {
  if (state.installClient) return;
  // Match this run's exact install token so a stale install tab left over
  // from an earlier attempt can never be selected.
  const installToken = new URL(requireStateValue(state.installPageUrl, "install page URL")).searchParams.get("token") ?? "";
  ctx.assert(installToken.length > 0, "The journey install URL did not carry a token.");
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const targets = await listTargets(WEB_CDP_URL);
    const target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl && entry.url.includes(`/install?token=${installToken}`));
    if (target) {
      state.installClient = await connect(debuggerUrlFor(WEB_CDP_URL, target));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  ctx.assert(false, "The journey download action did not open the team install page in a new tab.");
}

async function withInstallTab(ctx, fn) {
  const previous = ctx.client;
  ctx.assert(Boolean(state.installClient), "The install tab client was not prepared by frame 5.");
  ctx.client = state.installClient;
  try {
    return await fn();
  } finally {
    ctx.client = previous;
  }
}

async function firstPageTarget(cdpBaseUrl) {
  const targets = await listTargets(cdpBaseUrl);
  const existing = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (existing) return existing;

  const base = cdpBaseUrl.replace(/\/+$/, "");
  let response = await fetch(`${base}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) response = await fetch(`${base}/json/new?about:blank`);
  if (!response.ok) throw new Error(`Could not create standalone Chrome page at ${cdpBaseUrl}: ${response.status}`);
  const created = await response.json();
  if (created?.type === "page" && created.webSocketDebuggerUrl) return created;

  const nextTargets = await listTargets(cdpBaseUrl);
  const next = nextTargets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!next) throw new Error(`No standalone Chrome page target available at ${cdpBaseUrl}.`);
  return next;
}

async function denApiFetch(path, options = {}) {
  const response = await fetch(`${DEN_API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      origin: DEN_WEB_URL || DEN_API_URL,
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body, text };
}

async function assertMockServerReady(ctx) {
  const healthUrl = new URL(MOCK_REQUESTS_URL);
  healthUrl.pathname = "/health";
  healthUrl.search = "";
  const response = await fetch(healthUrl.toString());
  const body = await response.json().catch(() => null);
  ctx.assert(response.ok, `Mock MCP server is not reachable at ${healthUrl}: ${response.status}`);
  ctx.assert(body?.mcpAuth === "none", `Mock MCP server must run with public/no-auth MCP enabled: ${JSON.stringify(body)}`);
}

async function ensureAdminToken(ctx) {
  if (state.adminToken) return state.adminToken;
  const signedIn = await denApiFetch("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (signedIn.response.ok && typeof signedIn.body?.token === "string") {
    state.adminToken = signedIn.body.token;
    await activateAdminOrganization(ctx, state.adminToken);
    return state.adminToken;
  }
  const fallback = process.env.OPENWORK_EVAL_DEN_TOKEN?.trim() ?? "";
  ctx.assert(fallback.length > 0, `Admin sign-in failed and OPENWORK_EVAL_DEN_TOKEN is missing: ${signedIn.response.status} ${signedIn.text.slice(0, 200)}`);
  state.adminToken = fallback;
  await activateAdminOrganization(ctx, state.adminToken);
  return fallback;
}

async function activateAdminOrganization(ctx, token) {
  const listed = await denApiFetch("/v1/me/orgs", { headers: { authorization: `Bearer ${token}` } });
  ctx.assert(listed.response.ok, `Could not list admin organizations: ${listed.response.status} ${listed.text.slice(0, 300)}`);
  const organizations = Array.isArray(listed.body?.orgs) ? listed.body.orgs : [];
  const organization = organizations.find((entry) => entry?.name === ORG_NAME);
  ctx.assert(typeof organization?.id === "string", `${ORG_NAME} was not available to ${ADMIN_EMAIL}: ${JSON.stringify(organizations).slice(0, 1000)}`);
  const selected = await denApiFetch("/v1/me/active-organization", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ organizationId: organization.id }),
  });
  ctx.assert(selected.response.ok, `Could not activate ${ORG_NAME}: ${selected.response.status} ${selected.text.slice(0, 300)}`);
}

async function cleanupStalePluginBundles(ctx) {
  const token = await ensureAdminToken(ctx);
  const listed = await denApiFetch("/v1/plugins?status=active&limit=100", {
    headers: { authorization: `Bearer ${token}` },
  });
  ctx.assert(listed.response.ok, `Could not list stale plugin bundles: ${listed.response.status} ${listed.text.slice(0, 300)}`);
  const plugins = Array.isArray(listed.body?.items) ? listed.body.items : [];
  for (const plugin of plugins) {
    if (plugin?.name !== PLUGIN_NAME || typeof plugin.id !== "string") continue;
    const archived = await denApiFetch(`/v1/plugins/${encodeURIComponent(plugin.id)}/archive`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "{}",
    });
    ctx.assert(archived.response.ok, `Could not archive stale ${PLUGIN_NAME} plugin ${plugin.id}: ${archived.response.status} ${archived.text.slice(0, 300)}`);
  }
}

async function signInAndReturnToken(ctx, email, password) {
  const signedIn = await denApiFetch("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  ctx.assert(signedIn.response.ok && typeof signedIn.body?.token === "string", `Sign-in failed for ${email}: ${signedIn.response.status} ${signedIn.text.slice(0, 200)}`);
  return signedIn.body.token;
}

async function goToDenWeb(ctx, path) {
  await navigateToAbsolute(ctx, `${DEN_WEB_URL}${path}`);
  await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 30_000, label: `load ${path}` });
}

async function navigateToAbsolute(ctx, url) {
  await ctx.eval(`(() => { location.assign(${JSON.stringify(url)}); return true; })()`);
}

async function signInToDenWeb(ctx, email, password) {
  await goToDenWeb(ctx, "/");
  await ctx.eval("fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(() => true).catch(() => true)", { awaitPromise: true });
  await goToDenWeb(ctx, "/");
  await ctx.waitFor("Boolean(document.querySelector('input[type=\"email\"], input[name=\"email\"]'))", { timeoutMs: 30_000, label: "email-first sign-in screen" });
  await ctx.fill('input[type="email"], input[name="email"]', email);
  await clickExactText(ctx, "Next", "button");
  await ctx.waitFor("Boolean(document.querySelector('input[type=\"password\"]'))", { timeoutMs: 20_000, label: "password sign-in step" });
  await ctx.fill('input[type="password"]', password);
  await clickLastExactText(ctx, "Sign in", "button");
  await ctx.waitFor("location.pathname.startsWith('/dashboard')", { timeoutMs: 45_000, label: "dashboard after sign-in" });
}

async function selectOrganizationThroughUi(ctx, organizationName) {
  await goToDenWeb(ctx, "/organization");
  await ctx.waitForText(organizationName, { timeoutMs: 30_000 });
  const isCurrent = await ctx.eval(`(() => {
    const row = [...document.querySelectorAll('tr')].find((entry) => entry.innerText.includes(${JSON.stringify(organizationName)}));
    return Boolean(row?.innerText.includes('Current Organization'));
  })()`);
  if (!isCurrent) {
    await ctx.waitFor(`(() => {
      const row = [...document.querySelectorAll('tr')].find((entry) => entry.innerText.includes(${JSON.stringify(organizationName)}));
      const button = [...(row?.querySelectorAll('button') ?? [])].find((entry) => entry.textContent.trim() === 'Switch');
      button?.click();
      return Boolean(button);
    })()`, { timeoutMs: 20_000, label: `switch to ${organizationName}` });
    await ctx.waitFor("location.pathname.startsWith('/dashboard')", { timeoutMs: 30_000, label: "organization dashboard chooser" });
  }
  await goToDenWeb(ctx, "/dashboard");
  await ctx.waitFor(
    "document.body.innerText.includes('Choose an organization') || document.body.innerText.includes('Good morning')",
    { timeoutMs: 30_000, label: "dashboard organization state" },
  );
  const needsDashboardChoice = await ctx.eval("document.body.innerText.includes('Choose an organization')");
  if (needsDashboardChoice) {
    await ctx.waitFor(`(() => {
      const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent.includes(${JSON.stringify(organizationName)}));
      button?.click();
      return Boolean(button);
    })()`, { timeoutMs: 20_000, label: `choose ${organizationName} dashboard` });
    await ctx.waitFor(
      `location.pathname === '/dashboard' && document.body.innerText.includes(${JSON.stringify(organizationName)}) && document.body.innerText.includes('Good morning')`,
      { timeoutMs: 30_000, label: `${organizationName} dashboard loaded` },
    );
  }
  await ctx.waitFor(
    `location.pathname === '/dashboard' && document.body.innerText.includes(${JSON.stringify(organizationName)}) && document.body.innerText.includes('Good morning')`,
    { timeoutMs: 30_000, label: `${organizationName} active dashboard` },
  );
  await waitForBrowserActiveOrganization(ctx, organizationName);
}

async function openAdminRoute(ctx, path, organizationName, expectedText) {
  await goToDenWeb(ctx, path);
  await ctx.waitFor(
    `document.body.innerText.includes('Choose an organization') || document.body.innerText.includes(${JSON.stringify(expectedText)})`,
    { timeoutMs: 30_000, label: `${path} or organization gate` },
  );
  const gated = await ctx.eval("document.body.innerText.includes('Choose an organization')");
  if (!gated) return;

  await ctx.waitFor(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent.includes(${JSON.stringify(organizationName)}));
    button?.click();
    return Boolean(button);
  })()`, { timeoutMs: 20_000, label: `clear ${organizationName} admin route gate` });
  await ctx.waitFor(
    `location.pathname === '/dashboard' && document.body.innerText.includes(${JSON.stringify(organizationName)}) && document.body.innerText.includes('Good morning')`,
    { timeoutMs: 30_000, label: `${organizationName} dashboard after route gate` },
  );
  await waitForBrowserActiveOrganization(ctx, organizationName);
  await goToDenWeb(ctx, path);
  await ctx.waitForText(expectedText, { timeoutMs: 30_000 });
}

async function waitForBrowserActiveOrganization(ctx, organizationName) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const activeName = await ctx.eval(`fetch('/api/den/v1/me/orgs').then(async (response) => {
      if (!response.ok) return '';
      const body = await response.json();
      const active = Array.isArray(body.orgs) ? body.orgs.find((entry) => entry?.id === body.activeOrgId) : null;
      return active?.name ?? '';
    })`, { awaitPromise: true }).catch(() => "");
    if (activeName === organizationName) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Browser session did not persist ${organizationName} as its active organization.`);
}

async function clearDenWebSession(ctx) {
  await goToDenWeb(ctx, "/");
  await ctx.eval(`fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null).then(() => {
    localStorage.clear();
    sessionStorage.clear();
    return true;
  })`, { awaitPromise: true });
}

async function clickExactText(ctx, text, selector) {
  return ctx.waitFor(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const element = candidates.find((candidate) => (candidate.textContent ?? '').trim() === ${JSON.stringify(text)} && !candidate.disabled);
    element?.scrollIntoView({ block: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs: 20_000, label: `click exact text ${text}` });
}

async function clickLastExactText(ctx, text, selector) {
  return ctx.waitFor(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((candidate) => (candidate.textContent ?? '').trim() === ${JSON.stringify(text)} && !candidate.disabled);
    const element = candidates[candidates.length - 1];
    element?.scrollIntoView({ block: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs: 20_000, label: `click last exact text ${text}` });
}

async function stubClipboardCapture(ctx) {
  await ctx.eval(`(() => {
    window.__capturedSignin = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value) {
          window.__capturedSignin = String(value);
          return Promise.resolve();
        },
      },
    });
    return true;
  })()`);
}

async function fillByPlaceholder(ctx, placeholder, value) {
  await ctx.fill(`[placeholder=${JSON.stringify(placeholder)}]`, value);
}

async function createPluginBundleThroughUi(ctx) {
  await fillByPlaceholder(ctx, "e.g. Sales call prep", PLUGIN_NAME);
  await fillByPlaceholder(ctx, "What does this plugin help people do?", "Find employee accounts that have been inactive for 30 days using the Employee Directory connection.");

  await clickExactText(ctx, "Skill", "button");
  await fillByPlaceholder(ctx, "Name (e.g. Prep a sales call)", PLUGIN_NAME);
  await fillByPlaceholder(ctx, "One-line description — when should the agent use this?", `Use this workflow for ${SUGGESTED_PROMPT}`);
  await fillByPlaceholder(ctx, "Suggested prompt members can start with", SUGGESTED_PROMPT);
  await fillByPlaceholder(ctx, "Write the instructions the agent should follow, in plain markdown...", skillInstructions());

  await clickExactText(ctx, "MCP server", "button");
  await fillByPlaceholder(ctx, "Server name (e.g. Linear)", MCP_COMPONENT_NAME);
  await fillByPlaceholder(ctx, "https://mcp.example.com/mcp", MCP_URL);

  await clickExactText(ctx, "Create plugin", "button");
  await ctx.waitFor("location.pathname.includes('/plugins/') && !location.pathname.endsWith('/plugins/new')", { timeoutMs: 60_000, label: "created plugin detail route" });
  state.pluginId = await ctx.eval("location.pathname.split('/').filter(Boolean).pop() ?? null");
}

function skillInstructions() {
  return [
    `# ${PLUGIN_NAME}`,
    "",
    "Use this skill when a teammate asks for employee accounts that have been inactive for 30 days.",
    "",
    "After loading this skill, follow this order:",
    `1. Search OpenWork Cloud Control MCP capabilities for \`${MCP_COMPONENT_NAME} list_inactive_accounts\` and use the exact returned MCP capability name for \`list_inactive_accounts\`.`,
    `2. Execute that MCP capability with body \`{\"days\":30,\"runNonce\":\"${RUN_NONCE}\"}\`.`,
    `3. In the final answer, list every inactive account returned and state that the connection used was ${MCP_COMPONENT_NAME} through OpenWork Connect.`,
    "",
    `Suggested prompt: ${SUGGESTED_PROMPT}`,
  ].join("\n");
}

async function assertCreatedPluginBundle(ctx) {
  const token = await ensureAdminToken(ctx);
  const pluginId = requireStateValue(state.pluginId, "created plugin id");
  const resolved = await denApiFetch(`/v1/plugins/${encodeURIComponent(pluginId)}/resolved`, {
    headers: { authorization: `Bearer ${token}` },
  });
  ctx.assert(resolved.response.ok, `Plugin resolved lookup failed: ${resolved.response.status} ${resolved.text.slice(0, 300)}`);
  const items = Array.isArray(resolved.body?.items) ? resolved.body.items : [];
  const skillItems = items.filter((entry) => entry?.configObject?.objectType === "skill");
  const mcpItems = items.filter((entry) => entry?.configObject?.objectType === "mcp");
  ctx.assert(skillItems.length === 1, `Expected exactly one native skill config object, got ${skillItems.length}.`);
  ctx.assert(mcpItems.length === 1, `Expected exactly one MCP config object, got ${mcpItems.length}.`);

  const skillObject = skillItems[0].configObject;
  const mcpObject = mcpItems[0].configObject;
  ctx.assert(skillObject.title === PLUGIN_NAME, `Unexpected skill title: ${skillObject.title}`);
  ctx.assert(mcpObject.title === MCP_COMPONENT_NAME, `Unexpected MCP title: ${mcpObject.title}`);
  const skillPayload = skillObject.latestVersion?.normalizedPayloadJson;
  state.denSkillId = typeof skillPayload?.denSkillId === "string" ? skillPayload.denSkillId : null;
  ctx.assert(typeof state.denSkillId === "string", "Resolved skill config did not point at a native Den skill.");
  const mcpPayload = mcpObject.latestVersion?.normalizedPayloadJson;
  state.connectionId = typeof mcpPayload?.externalMcpConnectionId === "string" ? mcpPayload.externalMcpConnectionId : null;
  ctx.assert(typeof state.connectionId === "string", "Resolved MCP config did not point at an ExternalMcpConnection.");

  const skills = await denApiFetch("/v1/skills", { headers: { authorization: `Bearer ${token}` } });
  ctx.assert(skills.response.ok, `Skill list failed: ${skills.response.status} ${skills.text.slice(0, 300)}`);
  const matchingSkills = (Array.isArray(skills.body?.skills) ? skills.body.skills : []).filter((skill) => skill?.id === state.denSkillId && skill?.title === PLUGIN_NAME);
  ctx.assert(matchingSkills.length === 1, `Expected exactly one native Den skill with id ${state.denSkillId}, got ${matchingSkills.length}.`);

  const connections = await denApiFetch("/v1/mcp-connections?scope=usable", { headers: { authorization: `Bearer ${token}` } });
  ctx.assert(connections.response.ok, `Usable MCP connection list failed: ${connections.response.status} ${connections.text.slice(0, 300)}`);
  const usableConnections = (Array.isArray(connections.body?.connections) ? connections.body.connections : []).filter((connection) => connection?.id === state.connectionId);
  ctx.assert(usableConnections.length === 1, `Expected exactly one usable ExternalMcpConnection for ${state.connectionId}, got ${usableConnections.length}.`);
  const connection = usableConnections[0];
  ctx.assert(connection.connected === true && connection.connectedForMe === true, `External MCP connection is not usable: ${JSON.stringify(connection)}`);
  ctx.assert(connection.authType === "none" && connection.credentialMode === "shared", `External MCP connection is not shared/no-auth: ${JSON.stringify(connection)}`);
  ctx.assert(connection.url === MCP_URL, `External MCP connection URL drifted: ${connection.url} !== ${MCP_URL}`);
  state.connectionName = connection.name;
  ctx.assert(connection.name.includes(MCP_COMPONENT_NAME), `External MCP connection name does not include ${MCP_COMPONENT_NAME}: ${connection.name}`);

  return {
    pluginId,
    denSkillId: state.denSkillId,
    skillCount: skillItems.length,
    mcpConfigCount: mcpItems.length,
    externalMcpConnection: {
      id: connection.id,
      name: connection.name,
      authType: connection.authType,
      credentialMode: connection.credentialMode,
      connected: connection.connected,
      connectedForMe: connection.connectedForMe,
      url: connection.url,
    },
  };
}

async function getLatestDevEmail(ctx, template, expectedTo) {
  const listResponse = await fetch(`${DEN_API_URL}/v1/dev/emails?template=${encodeURIComponent(template)}`);
  const listText = await listResponse.text();
  ctx.assert(listResponse.ok, `Could not list ${template} emails: ${listResponse.status} ${listText.slice(0, 200)}`);
  const list = JSON.parse(listText);
  const emails = Array.isArray(list.emails) ? list.emails : [];
  const entry = emails.find((candidate) => candidate?.to === expectedTo) ?? null;
  ctx.assert(Boolean(entry), `No ${template} email found for ${expectedTo}.`);
  ctx.assert(emails[0]?.to === expectedTo, `Latest ${template} email is ${emails[0]?.to ?? "none"}, expected ${expectedTo}.`);

  const htmlResponse = await fetch(`${DEN_API_URL}/v1/dev/emails/last?template=${encodeURIComponent(template)}`);
  const html = await htmlResponse.text();
  ctx.assert(htmlResponse.ok, `Could not fetch latest ${template} email HTML: ${htmlResponse.status} ${html.slice(0, 200)}`);
  return { entry, html };
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function extractInviteFromHtml(html, ctx) {
  const absoluteMatch = html.match(/https?:\/\/[^"'<>\s]+\/join-org\?invite=[^"'<>\s]+/);
  const relativeMatch = html.match(/\/join-org\?invite=[^"'<>\s]+/);
  const rawLink = absoluteMatch?.[0] ?? relativeMatch?.[0] ?? "";
  const link = decodeHtmlAttribute(rawLink);
  ctx.assert(link.length > 0, "Invite email did not contain a /join-org?invite= link.");
  const parsed = new URL(link, DEN_WEB_URL);
  const token = parsed.searchParams.get("invite")?.trim() ?? "";
  ctx.assert(token.length > 0, `Invite link did not include an invite token: ${link}`);
  return { link: parsed.toString(), token };
}

function extractInstallFromHtml(html, ctx) {
  const absoluteMatch = html.match(/https?:\/\/[^"'<>\s]+\/install\?token=[^"'<>\s]+/);
  const relativeMatch = html.match(/\/install\?token=[^"'<>\s]+/);
  const rawLink = absoluteMatch?.[0] ?? relativeMatch?.[0] ?? "";
  const link = decodeHtmlAttribute(rawLink);
  ctx.assert(link.length > 0, "Invite email did not contain an /install?token= link.");
  const parsed = new URL(link, DEN_WEB_URL);
  ctx.assert(parsed.pathname === "/install", `Invite desktop CTA did not target /install: ${link}`);
  ctx.assert(Boolean(parsed.searchParams.get("token")?.trim()), `Install link did not include an opaque token: ${link}`);
  return parsed.toString();
}

function rewriteDenWebLink(rawLink) {
  const parsed = new URL(rawLink, DEN_WEB_URL);
  return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, DEN_WEB_URL).toString();
}

async function completeInviteSignup(ctx, email, password) {
  await ctx.waitFor("Boolean(document.querySelector('input[type=\"password\"]'))", { timeoutMs: 30_000, label: "invite password field" });
  await ctx.fill('input[type="password"]', password);
  await clickExactText(ctx, `Join ${ORG_NAME}`, "button");
  await ctx.waitFor(`document.body.innerText.includes("You're one click away from the team workspace.") || Boolean(document.querySelector('[data-testid="join-org-success"]'))`, { timeoutMs: 45_000, label: "signed in invite accept step" });
  const alreadySuccess = await ctx.eval("Boolean(document.querySelector('[data-testid=\"join-org-success\"]'))");
  if (!alreadySuccess) {
    await ctx.expectText(email, { timeoutMs: 20_000 });
    markEmailVerified(ctx, email);
    await clickExactText(ctx, `Join ${ORG_NAME}`, "button");
  }
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"join-org-success\"]'))", { timeoutMs: 45_000, label: "join org success" });
}

function markEmailVerified(ctx, email) {
  ctx.assert(MARK_VERIFIED_CMD.length > 0, "Invitation acceptance requires a verified email; set OPENWORK_EVAL_MARK_VERIFIED_CMD (shell template with {email}).");
  execSync(MARK_VERIFIED_CMD.replaceAll("{email}", email), { stdio: "ignore" });
}

async function restoreNetworkConditions(ctx) {
  await ctx.client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: "none",
  }).catch(() => undefined);
}

async function ensureDesktopReady(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 90_000, label: "desktop control API" });
}

async function prepareDesktopForDenHandoff(ctx) {
  await ctx.waitFor("Boolean(window.__OPENWORK_ELECTRON__?.invokeDesktop)", { timeoutMs: 30_000, label: "desktop bridge" });
  const bootstrap = { baseUrl: DEN_API_URL, apiBaseUrl: DEN_API_URL, requireSignin: false, handoff: null };
  const result = await ctx.eval(`window.__OPENWORK_ELECTRON__.invokeDesktop("setDesktopBootstrapConfig", ${JSON.stringify(bootstrap)})`, { awaitPromise: true });
  ctx.assert(Boolean(result), "Desktop bootstrap config was not written.");
  await ctx.eval(`(() => {
    localStorage.setItem('openwork.den.baseUrl', ${JSON.stringify(DEN_API_URL)});
    localStorage.setItem('openwork.den.apiBaseUrl', ${JSON.stringify(DEN_API_URL)});
    for (const key of ['openwork.den.authToken', 'openwork.den.activeOrgId', 'openwork.den.activeOrgSlug', 'openwork.den.activeOrgName', 'openwork.den.mcp.sync']) {
      localStorage.removeItem(key);
    }
    window.dispatchEvent(new CustomEvent('openwork-den-session-updated', { detail: { status: 'signed_out' } }));
    return true;
  })()`);
  await ctx.eval("location.reload()");
  await ensureDesktopReady(ctx);
}

async function deliverDeepLinkToDesktop(ctx, openworkUrl) {
  await ctx.eval(`(() => {
    const url = ${JSON.stringify(openworkUrl)};
    window.__OPENWORK__ = window.__OPENWORK__ || {};
    const pending = window.__OPENWORK__.deepLinks || [];
    window.__OPENWORK__.deepLinks = [...pending, url];
    window.dispatchEvent(new CustomEvent("openwork:deep-link", { detail: { urls: [url] } }));
    return true;
  })()`);
}

async function composerText(ctx) {
  return await ctx.eval("document.querySelector('[contenteditable=\"true\"][data-lexical-editor=\"true\"]')?.innerText ?? ''");
}

async function waitForPromptInComposer(ctx, prompt) {
  await ctx.waitFor(
    `(document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')?.innerText ?? '').includes(${JSON.stringify(prompt)})`,
    { timeoutMs: 15_000, label: "administrator-provided prompt carried into composer" },
  );
}

async function waitForCloudControlMcpSync(ctx) {
  await ctx.waitFor("Boolean(localStorage.getItem('openwork.den.mcp.sync'))", { timeoutMs: 120_000, label: "OpenWork Cloud Control MCP sync marker" });
}

async function readRuntimeCloudControlMcp(ctx) {
  const pinnedWorkspaceId = state.workspaceId ?? "";
  return ctx.eval(`(async () => {
    const parts = window.location.hash.split('/');
    const workspaceIndex = parts.indexOf('workspace');
    const workspaceId = ${JSON.stringify(pinnedWorkspaceId)} || (workspaceIndex >= 0 ? parts[workspaceIndex + 1] : '');
    const port = localStorage.getItem('openwork.server.port');
    const token = localStorage.getItem('openwork.server.token');
    const hostToken = localStorage.getItem('openwork.server.hostToken');
    if (!workspaceId || !port || !token) return { ok: false, reason: 'missing workspace/server auth', workspaceId, port: Boolean(port), token: Boolean(token) };
    const headers = { Authorization: 'Bearer ' + token };
    if (hostToken) headers['X-OpenWork-Host-Token'] = hostToken;
    const response = await fetch('http://127.0.0.1:' + port + '/workspace/' + workspaceId + '/mcp', { headers });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    if (!response.ok) return { ok: false, reason: 'mcp endpoint failed', status: response.status, text: text.slice(0, 300) };
    const items = payload?.items ?? [];
    const entry = items.find((item) => item.name === 'openwork-cloud');
    const engineSync = payload?.engineSync?.status ?? null;
    return {
      ok: Boolean(entry?.config?.url?.includes('/mcp/agent') && entry?.config?.headers?.Authorization && engineSync === 'ok'),
      workspaceId,
      names: items.map((item) => item.name),
      engineSync,
      engineFailures: payload?.engineSync?.failures ?? [],
    };
  })()`, { awaitPromise: true });
}

async function waitForRuntimeCloudControlMcp(ctx) {
  let last = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      last = await readRuntimeCloudControlMcp(ctx);
      if (last?.ok) return;
    } catch (error) {
      last = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Runtime OpenWork Cloud Control MCP config never became ready: ${JSON.stringify(last)}`);
}

async function rememberCurrentSession(ctx) {
  const route = await ctx.waitFor(`(() => {
    const snapshotRoute = window.__openworkControl?.snapshot?.().route ?? '';
    const hashRoute = location.hash.replace(/^#/, '');
    const route = snapshotRoute || hashRoute;
    const match = route.match(new RegExp('/workspace/([^/]+)/session(?:/([^/?#]+))?'));
    if (!match || !match[2]) return null;
    return { route, workspaceId: decodeURIComponent(match[1]), sessionId: decodeURIComponent(match[2]) };
  })()`, { timeoutMs: 60_000, label: "workspace session route with session id" });
  state.workspaceId = route.workspaceId;
  state.sessionId = route.sessionId;
  return route;
}

async function readSessionSnapshot(ctx) {
  if (!state.workspaceId || !state.sessionId) await rememberCurrentSession(ctx);
  const workspaceId = requireStateValue(state.workspaceId, "workspace id");
  const sessionId = requireStateValue(state.sessionId, "session id");
  const payload = await ctx.eval(`(async () => {
    const workspaceId = ${JSON.stringify(workspaceId)};
    const sessionId = ${JSON.stringify(sessionId)};
    const info = await window.__OPENWORK_ELECTRON__?.invokeDesktop?.("openworkServerInfo");
    let baseUrl = String(info?.baseUrl || info?.connectUrl || '');
    while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    const token = String(info?.ownerToken || info?.clientToken || '').trim();
    if (!baseUrl || !token) return { ok: false, status: 0, body: null, text: 'missing server info' };
    const snapshotUrl = baseUrl + '/workspace/' + encodeURIComponent(workspaceId) + '/sessions/' + encodeURIComponent(sessionId) + '/snapshot?limit=400';
    const response = await fetch(snapshotUrl, { headers: { authorization: 'Bearer ' + token } });
    const text = await response.text();
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch {}
    return { ok: response.ok, status: response.status, body, text: text.slice(0, 200000) };
  })()`, { awaitPromise: true });
  ctx.assert(payload?.ok, `Could not read app/session API snapshot: ${payload?.status} ${String(payload?.text ?? '').slice(0, 300)}`);
  return payload.body;
}

function stringifyCompact(value) {
  return JSON.stringify(value, (_key, entry) => entry, 2).slice(0, 4_000);
}

function collectToolEvents(value) {
  const events = [];
  const visit = (entry, path) => {
    if (!entry || typeof entry !== "object") return;
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    const tool = typeof entry.tool === "string"
      ? entry.tool
      : typeof entry.toolName === "string"
        ? entry.toolName
        : null;
    const type = typeof entry.type === "string" ? entry.type : "";
    const text = stringifyCompact(entry);
    if (tool || type === "tool" || type === "dynamic-tool") {
      events.push({ index: events.length, path, tool: tool || type || "tool", text });
    }
    for (const [key, item] of Object.entries(entry)) {
      visit(item, `${path}.${key}`);
    }
  };
  visit(value, "$.");
  return events;
}

function eventContains(event, needle) {
  return event.text.includes(needle) || event.tool.includes(needle);
}

function findToolSequence(snapshot, { requireFullSequence }) {
  const events = collectToolEvents(snapshot);
  // Match execute events by their INPUT capability name — the skill's own
  // output text mentions the MCP tool, so bare substring matching would
  // conflate the two calls.
  const firstSearch = events.findIndex((event) => eventContains(event, "search_capabilities"));
  const skillExecute = events.findIndex((event, index) => index > firstSearch && eventContains(event, "execute_capability") && event.text.includes('"name": "skill:'));
  const mcpExecute = events.findIndex((event, index) => index > skillExecute && eventContains(event, "execute_capability") && event.text.includes('"name": "mcp:') && eventContains(event, "list_inactive_accounts"));
  const sequence = { firstSearch, skillExecute, mcpExecute };
  const partialOk = firstSearch >= 0 && skillExecute > firstSearch;
  // The narration's guarantee: search found the org bundle, the skill was
  // loaded, and only then did the directory call happen through Connect.
  const fullOk = partialOk && mcpExecute > skillExecute;
  return {
    ok: requireFullSequence ? fullOk : partialOk,
    sequence,
    events,
    summary: {
      sequence,
      orderedCalls: [firstSearch, skillExecute, mcpExecute].filter((index) => index >= 0).map((index) => ({
        index,
        tool: events[index]?.tool,
        path: events[index]?.path,
        excerpt: events[index]?.text.slice(0, 900),
      })),
      session: { workspaceId: state.workspaceId, sessionId: state.sessionId },
    },
  };
}

async function waitForTranscriptSequence(ctx, { requireFullSequence, timeoutMs }) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await readSessionSnapshot(ctx);
    const sequence = findToolSequence(snapshot, { requireFullSequence });
    last = sequence;
    if (sequence.ok) return sequence;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${requireFullSequence ? "full" : "partial"} app/session API tool-call sequence. Last: ${JSON.stringify(last?.summary ?? null).slice(0, 1600)}`);
}

async function assertFreshMockMcpCall(ctx) {
  const response = await fetch(MOCK_REQUESTS_URL);
  const body = await response.json().catch(() => null);
  ctx.assert(response.ok && Array.isArray(body?.requests), `Could not read mock MCP requests from ${MOCK_REQUESTS_URL}: ${response.status}`);
  const fresh = body.requests.filter((entry) => entry?.method === "POST" && entry?.path === "/mcp" && (!state.chatStartedAt || entry.at >= state.chatStartedAt));
  const matching = fresh.find((entry) => {
    const rpcEntries = Array.isArray(entry.rpc) ? entry.rpc : [entry.rpc];
    return rpcEntries.some((rpc) => rpc?.method === "tools/call" && rpc?.toolName === "list_inactive_accounts" && Number(rpc?.arguments?.days) === 30 && rpc?.arguments?.runNonce === RUN_NONCE);
  });
  ctx.assert(Boolean(matching), `No fresh tools/call list_inactive_accounts with days=30 and runNonce=${RUN_NONCE}. Fresh log: ${JSON.stringify(fresh).slice(0, 1600)}`);
  return {
    requestsUrl: MOCK_REQUESTS_URL,
    runStartedAt: state.chatStartedAt,
    matchedRequest: matching,
  };
}
