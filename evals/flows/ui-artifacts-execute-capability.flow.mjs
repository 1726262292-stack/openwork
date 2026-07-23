import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  denApiFetch,
  denApiUrl,
  denWebUrl,
  mcpAgentCall,
  signInApi,
} from "./lib/den-web.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "ui-artifacts-execute-capability";
const ARTIFACT_IDS = [
  "workspace.brief",
  "calendar.day",
  "communication.thread",
  "mail.inbox",
  "work.attention",
  "work.approvals",
  "work.progress",
  "metrics.glance",
];
const SEARCH_CAPABILITY = "openwork.ui_artifacts.search";
const USE_CAPABILITY = "openwork.ui_artifacts.use";
const EMAIL = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const PASSWORD = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";
const FIXTURE_WORKSPACE = join(tmpdir(), "openwork-ui-artifacts-eval");
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const state = {
  sessionToken: null,
  organizationId: null,
  briefResult: null,
  approvalResult: null,
  approvalUpdatedResult: null,
};

function parseToolText(result) {
  const text = result?.content?.find((entry) => entry?.type === "text")?.text;
  return typeof text === "string" ? JSON.parse(text) : null;
}

async function prepareCloud(ctx) {
  state.sessionToken = process.env.OPENWORK_EVAL_DEN_TOKEN?.trim() || await signInApi(EMAIL, PASSWORD);
  ctx.assert(Boolean(state.sessionToken), `Could not sign in ${EMAIL} to the local Den.`);

  const orgs = await denApiFetch("/v1/me/orgs", {
    headers: { authorization: `Bearer ${state.sessionToken}` },
  });
  ctx.assert(orgs.response.ok, `Could not list organizations: ${orgs.response.status}`);
  state.organizationId = orgs.body.activeOrgId ?? orgs.body.orgs?.[0]?.id ?? null;
  ctx.assert(Boolean(state.organizationId), "The signed-in member has no organization.");

  if (!orgs.body.activeOrgId) {
    const active = await denApiFetch("/v1/me/active-organization", {
      method: "POST",
      headers: { authorization: `Bearer ${state.sessionToken}` },
      body: JSON.stringify({ organizationId: state.organizationId }),
    });
    ctx.assert(active.response.ok, `Could not select the organization: ${active.response.status}`);
  }

  const preferences = await denApiFetch("/v1/me/ui-artifacts", {
    method: "PUT",
    headers: {
      authorization: `Bearer ${state.sessionToken}`,
      "x-openwork-legacy-org-id": state.organizationId,
    },
    body: JSON.stringify({ enabled: true, enabledArtifactIds: ARTIFACT_IDS }),
  });
  ctx.assert(preferences.response.ok, `Could not enable UI artifacts: ${preferences.response.status}`);
  ctx.assert(preferences.body.enabled === true, "Den did not persist the enabled artifact preference.");

  const minted = await denApiFetch("/v1/mcp/token", {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.sessionToken}`,
      "x-openwork-legacy-org-id": state.organizationId,
    },
    body: JSON.stringify({ scopes: ["mcp:read", "mcp:write"] }),
  });
  ctx.assert(minted.response.ok && minted.body.token, `Could not mint the MCP token: ${minted.response.status}`);
  return minted.body.token;
}

async function ensureSession(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "OpenWork control API",
  });
  if (await ctx.hasText("Continue without OpenWork Models")) {
    await ctx.clickText("Continue without OpenWork Models", { selector: "button", timeoutMs: 10_000 });
  }
  if (await ctx.hasText("Skip and use the free model")) {
    await ctx.clickText("Skip and use the free model", { selector: "button", timeoutMs: 10_000 });
  }
  const surveySkip = await ctx.eval(`Boolean([...document.querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === "Skip"))`);
  if (surveySkip) await ctx.clickText("Skip", { selector: "button", timeoutMs: 10_000 });

  const hasSession = await ctx.eval("window.__openworkControl.snapshot().route.includes('/session/')");
  if (!hasSession) {
    let actionReady = await ctx.eval(`window.__openworkControl.listActions()
      .some((action) => action.id === "session.create_task" && !action.disabled)`);
    if (!actionReady) {
      await mkdir(FIXTURE_WORKSPACE, { recursive: true });
      const welcomeInput = 'input[placeholder="/workspace/my-project"]';
      const onWelcome = await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(welcomeInput)}))`);
      if (onWelcome) {
        await ctx.fill(welcomeInput, FIXTURE_WORKSPACE);
        await ctx.clickText("Use this folder", { selector: "button", timeoutMs: 10_000 });
        await ctx.clickText("Continue without OpenWork Models", { selector: "button", timeoutMs: 30_000 }).catch(() => {});
        await ctx.clickText("Skip and use the free model", { selector: "button", timeoutMs: 30_000 }).catch(() => {});
        await ctx.clickText("Skip", { selector: "button", timeoutMs: 10_000 }).catch(() => {});
      } else {
        await ctx.waitFor(
          `window.__openworkControl.listActions()
            .some((action) => action.id === "workspace.create" && !action.disabled)`,
          { timeoutMs: 30_000, label: "workspace creation action" },
        );
        await ctx.control("workspace.create", { path: FIXTURE_WORKSPACE });
      }
      await ctx.waitFor(
        `window.__openworkControl.listActions()
          .some((action) => action.id === "session.create_task" && !action.disabled)`,
        { timeoutMs: 60_000, label: "task creation action" },
      );
      actionReady = true;
    }
    ctx.assert(actionReady, "A workspace session is required for the UI artifact eval.");
    await ctx.control("session.create_task");
    await ctx.waitFor(
      "window.__openworkControl.snapshot().route.includes('/session/')",
      { timeoutMs: 60_000, label: "active session" },
    );
  }
}

export default {
  id: FLOW_ID,
  title: "execute_capability discovers, renders, and displays a native UI artifact",
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_WEB_URL"],
  steps: [
    {
      name: "The cloud surface remains exactly two tools",
      run: async (ctx) => {
        const mcpToken = await prepareCloud(ctx);
        const tools = await mcpAgentCall(mcpToken, "tools/list", {}, ctx);
        const names = (tools.tools ?? []).map((tool) => tool.name).sort();
        ctx.assert(
          names.join(",") === "execute_capability,search_capabilities",
          `Unexpected agent tool surface: ${names.join(", ")}`,
        );

        const briefSearch = await mcpAgentCall(mcpToken, "tools/call", {
          name: "execute_capability",
          arguments: {
            name: SEARCH_CAPABILITY,
            body: {
              query: "replace the full work home dashboard with one chat-native morning brief",
              signal: { toolName: "openwork_today_summary" },
              limit: 1,
            },
          },
        }, ctx);
        ctx.assert(briefSearch.isError !== true, "The workspace brief search failed.");
        const briefSearchResult = parseToolText(briefSearch);
        const briefMatch = briefSearchResult?.matches?.[0];
        ctx.assert(briefMatch?.artifactId === "workspace.brief", "Artifact search did not rank the workspace brief first.");
        ctx.assert(
          briefMatch?.toolDefinition?.invocation?.capability === USE_CAPABILITY,
          "Artifact search did not return the execute_capability use invocation.",
        );

        const briefRendered = await mcpAgentCall(mcpToken, "tools/call", {
          name: "execute_capability",
          arguments: {
            name: USE_CAPABILITY,
            body: briefMatch.toolDefinition.exampleArguments,
          },
        }, ctx);
        ctx.assert(briefRendered.isError !== true, "The workspace brief render failed.");
        state.briefResult = parseToolText(briefRendered);
        ctx.assert(state.briefResult?.status === "rendered", "The brief receipt is missing its rendered status.");
        ctx.assert(state.briefResult?.artifact?.artifactId === "workspace.brief", "The render receipt is not a workspace brief.");

        const approvalSearch = await mcpAgentCall(mcpToken, "tools/call", {
          name: "execute_capability",
          arguments: {
            name: SEARCH_CAPABILITY,
            body: { query: "approvals waiting for my approve or reject decision", limit: 1 },
          },
        }, ctx);
        const approvalMatch = parseToolText(approvalSearch)?.matches?.[0];
        ctx.assert(approvalMatch?.artifactId === "work.approvals", "Artifact search did not return the approval queue.");

        const approvalRendered = await mcpAgentCall(mcpToken, "tools/call", {
          name: "execute_capability",
          arguments: {
            name: USE_CAPABILITY,
            body: approvalMatch.toolDefinition.exampleArguments,
          },
        }, ctx);
        state.approvalResult = parseToolText(approvalRendered);
        ctx.assert(state.approvalResult?.artifact?.revision === 1, "The mock approval queue did not start at revision 1.");

        const decisionBody = {
          operation: "decide",
          artifactId: "work.approvals",
          instanceId: state.approvalResult.artifact.instanceId,
          itemId: "expense-lisbon",
          decision: "approve",
          expectedRevision: 1,
        };
        const approved = await mcpAgentCall(mcpToken, "tools/call", {
          name: "execute_capability",
          arguments: { name: USE_CAPABILITY, body: decisionBody },
        }, ctx);
        ctx.assert(approved.isError !== true, "The explicit mock approval decision failed.");
        state.approvalUpdatedResult = parseToolText(approved);
        ctx.assert(state.approvalUpdatedResult?.artifact?.revision === 2, "The mock approval queue did not advance to revision 2.");
        ctx.assert(
          state.approvalUpdatedResult?.artifact?.data?.items?.[0]?.status === "approved",
          "The selected mock request was not approved.",
        );

        const stale = await mcpAgentCall(mcpToken, "tools/call", {
          name: "execute_capability",
          arguments: {
            name: USE_CAPABILITY,
            body: { ...decisionBody, itemId: "access-production", decision: "reject" },
          },
        }, ctx);
        ctx.assert(stale.isError === true, "A stale approval decision unexpectedly succeeded.");
        ctx.assert(parseToolText(stale)?.code === "revision_conflict", "The stale decision did not return revision_conflict.");
      },
    },
    {
      name: "The desktop shows the synced tile catalog and native card",
      run: async (ctx) => {
        await ensureSession(ctx);
        const desktopBootstrap = {
          baseUrl: denWebUrl(),
          apiBaseUrl: denApiUrl(),
          requireSignin: false,
          handoff: null,
        };
        const desktopSession = await ctx.eval(`(async () => {
          const bridge = window.__OPENWORK_ELECTRON__?.invokeDesktop;
          if (!bridge) return { ok: false, reason: "desktop bridge unavailable" };
          await bridge("setDesktopBootstrapConfig", ${JSON.stringify(desktopBootstrap)});
          localStorage.setItem("openwork.den.baseUrl", ${JSON.stringify(denWebUrl())});
          localStorage.setItem("openwork.den.authToken", ${JSON.stringify(state.sessionToken)});
          localStorage.setItem("openwork.den.activeOrgId", ${JSON.stringify(state.organizationId)});
          const current = JSON.parse(localStorage.getItem("openwork.preferences") || "{}");
          localStorage.setItem("openwork.preferences", JSON.stringify({
            ...current,
            featureFlags: { ...(current.featureFlags || {}), uiArtifacts: true },
            uiArtifacts: { enabledArtifactIds: ${JSON.stringify(ARTIFACT_IDS)} },
          }));
          window.location.reload();
          return { ok: true };
        })()`, { awaitPromise: true });
        ctx.assert(desktopSession?.ok, `Could not configure the desktop Den session: ${desktopSession?.reason ?? "unknown"}`);
        await ensureSession(ctx);
        await ctx.waitFor(
          `!document.body.innerText.includes("OpenWork Cloud is temporarily unavailable.")`,
          { timeoutMs: 30_000, label: "desktop Den session available" },
        );

        await ctx.prove("The right rail offers eight member-controlled chat artifact tiles", {
          voiceover: vo[0],
          action: async () => {
            await ctx.waitFor(
              `Boolean(document.querySelector('button[aria-label="UI Artifacts"]'))`,
              { timeoutMs: 30_000, label: "UI Artifacts rail button" },
            );
            await ctx.eval(`document.querySelector('button[aria-label="UI Artifacts"]')?.click()`);
          },
          assert: async () => {
            await ctx.expectText("8 of 8 standard artifacts enabled", { timeoutMs: 20_000 });
            await ctx.expectText("Workspace brief");
            await ctx.expectText("Day agenda");
            await ctx.expectText("Priority inbox");
            await ctx.expectText("Approval queue");
          },
          screenshot: {
            name: "ui-artifact-catalog",
            requireText: ["8 of 8 standard artifacts enabled", "Workspace brief", "Approval queue"],
            rejectText: ["Something went wrong", "OpenWork Cloud is temporarily unavailable."],
          },
        });
        await ctx.eval(`document.querySelector('button[aria-label="Close UI artifacts"]')?.click()`);

        await ctx.waitFor(
          `window.__openworkControl.listActions().some((action) => action.id === "eval.ui_artifact.seed_chat" && !action.disabled)`,
          { timeoutMs: 20_000, label: "UI artifact eval action" },
        );
        await ctx.prove("A single workspace brief replaces the screenshot-style home dashboard inside chat", {
          voiceover: vo[1],
          action: async () => {
            await ctx.control("eval.ui_artifact.seed_chat", { result: state.briefResult });
            await ctx.waitFor(
              `Boolean(document.querySelector('[data-ui-artifact-id="workspace.brief"]'))`,
              { timeoutMs: 20_000, label: "native workspace brief artifact card" },
            );
            await ctx.eval(`document.querySelector('[data-ui-artifact-id="workspace.brief"]')?.scrollIntoView({ block: "center" })`);
          },
          assert: async () => {
            await ctx.expectText("Good morning, Alex");
            await ctx.expectText("Today at a glance");
            await ctx.expectText("Needs your attention");
            await ctx.expectText("Your widgets");
            await ctx.expectText("Architecture review");
            await ctx.expectText("Demo data");
          },
          screenshot: {
            name: "workspace-brief-in-chat",
            requireText: ["Good morning, Alex", "Today at a glance", "Needs your attention", "Your widgets", "Demo data"],
            rejectText: ["Something went wrong", "UI artifact renderer unavailable", "OpenWork Cloud is temporarily unavailable."],
          },
        });

        await ctx.prove("The approval artifact starts at revision one without making a decision", {
          voiceover: vo[2],
          action: async () => {
            await ctx.control("eval.ui_artifact.seed_chat", { result: state.approvalResult });
            await ctx.waitFor(
              `Boolean(document.querySelector('[data-ui-artifact-id="work.approvals"]'))`,
              { timeoutMs: 20_000, label: "native approval queue artifact card" },
            );
            await ctx.eval(`document.querySelector('[data-ui-artifact-id="work.approvals"]')?.scrollIntoView({ block: "center" })`);
          },
          assert: async () => {
            await ctx.expectText("Customer workshop travel");
            await ctx.expectText("Mock state · revision 1");
            await ctx.expectText("Approve");
            await ctx.expectText("Reject");
          },
          screenshot: {
            name: "approval-awaiting-decision",
            requireText: ["Approvals", "Customer workshop travel", "Mock state · revision 1", "Approve", "Reject"],
            rejectText: ["Something went wrong", "OpenWork Cloud is temporarily unavailable."],
          },
        });

        await ctx.prove("Approval stays user-controlled by staging a minimal revision-bound prompt", {
          voiceover: vo[3],
          action: async () => {
            await ctx.clickText("Approve", { selector: "button", timeoutMs: 10_000 });
            await ctx.waitFor(
              `document.querySelector("[contenteditable='true']")?.textContent?.includes("openwork.ui_artifacts.use")`,
              { timeoutMs: 10_000, label: "minimal approval prompt staged in composer" },
            );
            const stagedPrompt = await ctx.eval(`document.querySelector("[contenteditable='true']")?.textContent || ""`);
            ctx.assert(stagedPrompt.includes('"expectedRevision":1'), "The staged approval prompt omitted the expected revision.");
            ctx.assert(!stagedPrompt.includes("Flights and two hotel nights"), "The staged approval prompt copied unnecessary artifact detail.");
            ctx.assert(stagedPrompt.includes("Do not call a provider approval tool"), "The staged approval prompt omitted the mock-only boundary.");
          },
          assert: async () => {
            await ctx.expectText("Mock state · revision 1");
            await ctx.expectText("Do not call a provider approval tool");
          },
          screenshot: {
            name: "approval-prompt-staged",
            requireText: ["Approvals", "Mock state · revision 1", "openwork.ui_artifacts.use", "Do not call a provider approval tool"],
            rejectText: ["Something went wrong", "OpenWork Cloud is temporarily unavailable."],
          },
        });

        await ctx.prove("The successful execute response replaces the card with revision two while stale replay is rejected", {
          voiceover: vo[4],
          action: async () => {
            await ctx.control("eval.ui_artifact.seed_chat", {
              result: state.approvalUpdatedResult,
              clearPrompt: true,
            });
            await ctx.eval(`document.querySelector('[data-ui-artifact-id="work.approvals"]')?.scrollIntoView({ block: "center" })`);
          },
          assert: async () => {
            await ctx.expectText("Updated mock state · revision 2", { timeoutMs: 20_000 });
            await ctx.expectText("approved");
            const composerText = await ctx.eval(`document.querySelector("[contenteditable='true']")?.textContent?.trim() || ""`);
            ctx.assert(composerText === "", "The submitted approval prompt remained in the composer.");
            const renderedApprovalCards = await ctx.eval(
              `document.querySelectorAll('[data-ui-artifact-id="work.approvals"]').length`,
            );
            ctx.assert(renderedApprovalCards === 1, `Expected one reconciled approval card, found ${renderedApprovalCards}.`);
          },
          screenshot: {
            name: "approval-revision-updated",
            requireText: ["Approvals", "approved", "Updated mock state · revision 2"],
            rejectText: ["Something went wrong", "OpenWork Cloud is temporarily unavailable."],
          },
        });
        await ctx.expectNoText("Something went wrong");
      },
    },
  ],
};
