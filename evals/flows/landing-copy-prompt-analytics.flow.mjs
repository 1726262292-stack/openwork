const COPY_BUTTON_SELECTOR = 'button[aria-label="Copy the agent setup prompt"]';
const POSTHOG_CLIENT_EVENT = "landing_copy_prompt_clicked";
const POSTHOG_SERVER_EVENT = "landing_start_md_fetched";
const PROMPT_VARIANT = "bootstrap-workspace";
const AGENT_USER_AGENT = "fraimz-eval-agent/1.0";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function routeUrl(ctx, path) {
  return new URL(path, ctx.env.OPENWORK_EVAL_LANDING_URL).toString();
}

function mockUrl(ctx, path) {
  return new URL(path, ctx.env.OPENWORK_EVAL_POSTHOG_MOCK_URL).toString();
}

function recordAssertion(ctx, assertion, passed, actual) {
  ctx.recordEvidence({
    type: "assertion",
    status: passed ? "passed" : "failed",
    assertion,
    actual,
  });
  ctx.assert(passed, `${assertion}. Actual: ${JSON.stringify(actual)}`);
}

async function readMockEvents(ctx) {
  const response = await fetch(mockUrl(ctx, "/events"));
  const body = await response.json();
  return Array.isArray(body) ? body : [];
}

async function waitForMockEvents(ctx, eventName, minimumCount) {
  const startedAt = Date.now();
  let latestMatches = [];
  while (Date.now() - startedAt < 5_000) {
    const events = await readMockEvents(ctx);
    latestMatches = events.filter((event) => event?.event === eventName);
    if (latestMatches.length >= minimumCount) return latestMatches;
    await sleep(250);
  }
  return latestMatches;
}

async function grantClipboardPermissions(ctx) {
  if (!ctx.client?.send) {
    ctx.log("Clipboard permission grant skipped: no raw CDP send method on context.");
    return;
  }

  const origin = new URL(ctx.env.OPENWORK_EVAL_LANDING_URL).origin;
  await ctx.client.send("Browser.grantPermissions", {
    origin,
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
  }).catch((error) => {
    ctx.log(`Clipboard permission grant skipped: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export default {
  id: "landing-copy-prompt-analytics",
  title: "Landing Copy Prompt analytics fire end-to-end",
  kind: "user-facing",
  spec: "evals/README.md",
  // The landing website has no theme system or __openworkControl API; skip the
  // desktop-app light-mode bootstrap instead of waiting for it to time out.
  preserveTheme: true,
  requiredEnv: ["OPENWORK_EVAL_LANDING_URL", "OPENWORK_EVAL_POSTHOG_MOCK_URL"],
  steps: [
    {
      name: "Copy Prompt click captures the analytics event",
      run: async (ctx) => {
        await ctx.prove("Copy Prompt click captures the analytics event.", {
          action: async () => {
            await ctx.eval(`location.href = ${JSON.stringify(routeUrl(ctx, "/"))}; true`);
            await ctx.waitFor(
              `Boolean(document.querySelector(${JSON.stringify(COPY_BUTTON_SELECTOR)}))`,
              { timeoutMs: 30_000, label: "Copy Prompt nav button" },
            );
            // Freeze the recording stub onto window.posthog: PostHog's async
            // array.js loader assigns window.posthog when it arrives, and on a
            // fresh navigation that write can land after this step. A frozen
            // property makes the late assignment a silent no-op, so captures
            // deterministically reach the stub (and never real PostHog).
            await ctx.eval(`(() => {
              window.__capturedPosthogEvents = [];
              Object.defineProperty(window, "posthog", {
                value: {
                  capture: (event, properties) => {
                    window.__capturedPosthogEvents.push({ event, properties });
                  },
                },
                writable: false,
                configurable: false,
              });
              return true;
            })()`);
            await grantClipboardPermissions(ctx);
            await ctx.eval(`(() => {
              const button = document.querySelector(${JSON.stringify(COPY_BUTTON_SELECTOR)});
              button.scrollIntoView({ block: "center" });
              button.click();
              return true;
            })()`);
            await ctx.waitFor(
              `(() => {
                const events = window.__capturedPosthogEvents || [];
                return events.some((entry) => entry.event === ${JSON.stringify(POSTHOG_CLIENT_EVENT)}) && Boolean(document.querySelector('[data-feedback="true"]'));
              })()`,
              { timeoutMs: 10_000, label: "client PostHog event and feedback state" },
            );
            // Let the 200ms copy-feedback morph settle so the frame shows a
            // clean "Copied" state instead of overlapping transition labels.
            await sleep(400);
          },
          assert: async () => {
            const clientCapture = await ctx.eval(`(() => {
              const events = window.__capturedPosthogEvents || [];
              const matches = events.filter((entry) => entry.event === ${JSON.stringify(POSTHOG_CLIENT_EVENT)});
              return {
                count: matches.length,
                event: matches[0] || null,
                feedbackActive: Boolean(document.querySelector('[data-feedback="true"]')),
              };
            })()`);
            ctx.recordEvidence({
              type: "output",
              name: "Captured client PostHog event",
              text: JSON.stringify(clientCapture.event, null, 2),
            });

            const properties = clientCapture.event?.properties ?? {};
            const method = properties.method;
            recordAssertion(
              ctx,
              "Exactly one landing_copy_prompt_clicked event was captured with variant, copied, and method properties",
              clientCapture.count === 1
                && properties.variant === PROMPT_VARIANT
                && typeof properties.copied === "boolean"
                && (method === "clipboard" || method === "execCommand" || method === "none"),
              clientCapture,
            );
            recordAssertion(
              ctx,
              "The Copy Prompt button entered its post-click feedback state",
              clientCapture.feedbackActive === true,
              clientCapture,
            );
          },
          screenshot: {
            name: "copy-prompt-feedback",
            requireText: ["Copied"],
          },
        });
      },
    },
    {
      name: "Agent fetch of start.md is captured server-side",
      run: async (ctx) => {
        let guideFetch = null;
        let agentEvent = null;
        let browserEvents = [];

        await ctx.prove("Agent fetch of start.md is captured server-side.", {
          action: async () => {
            await fetch(mockUrl(ctx, "/events"), { method: "DELETE" });
            const response = await fetch(routeUrl(ctx, `/start.md?v=${PROMPT_VARIANT}`), {
              headers: { "user-agent": AGENT_USER_AGENT },
            });
            const body = await response.text();
            guideFetch = {
              status: response.status,
              firstLines: body.split("\n").slice(0, 3).join("\n"),
              startsWithGuide: body.startsWith("# OpenWork Start"),
            };
            const agentEvents = await waitForMockEvents(ctx, POSTHOG_SERVER_EVENT, 1);
            agentEvent = agentEvents[0] || null;

            await ctx.eval(`location.href = ${JSON.stringify(routeUrl(ctx, `/start.md?v=${PROMPT_VARIANT}`))}; true`);
            await ctx.waitFor(
              `document.body.innerText.includes(${JSON.stringify("OpenWork Start")})`,
              { timeoutMs: 30_000, label: "start.md guide in browser" },
            );
            browserEvents = await waitForMockEvents(ctx, POSTHOG_SERVER_EVENT, 2);
          },
          assert: async () => {
            ctx.recordEvidence({
              type: "output",
              name: "start.md fetch preview",
              text: guideFetch?.firstLines ?? "",
            });
            recordAssertion(
              ctx,
              "Agent fetch returns HTTP 200 and the OpenWork start guide markdown",
              guideFetch?.status === 200 && guideFetch.startsWithGuide === true,
              guideFetch,
            );

            ctx.recordEvidence({
              type: "output",
              name: "PostHog mock event after agent fetch",
              text: JSON.stringify(agentEvent, null, 2),
            });
            const properties = agentEvent?.properties ?? {};
            recordAssertion(
              ctx,
              "Mock captured an anonymous landing_start_md_fetched event with the expected agent properties",
              agentEvent?.event === POSTHOG_SERVER_EVENT
                && properties.variant === PROMPT_VARIANT
                && properties.user_agent === AGENT_USER_AGENT
                && properties.$process_person_profile === false
                && typeof agentEvent.distinct_id === "string"
                && UUID_PATTERN.test(agentEvent.distinct_id),
              agentEvent,
            );
            recordAssertion(
              ctx,
              "Browser navigation to start.md produced a second server capture",
              browserEvents.filter((event) => event?.event === POSTHOG_SERVER_EVENT).length >= 2,
              browserEvents,
            );
          },
          screenshot: {
            name: "start-md-guide",
            requireText: ["OpenWork Start"],
          },
        });
      },
    },
  ],
};
