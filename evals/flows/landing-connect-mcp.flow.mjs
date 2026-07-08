import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "landing-connect-mcp";
const MCP_SERVER_URL = "https://api.openworklabs.com/mcp/agent";
const DOCS_URL = "https://openworklabs.com/docs/cloud/run-in-the-cloud/cloud-mcp";
const SECTION_SELECTOR = "#connect-mcp";
const EXAMPLE_SELECTOR = '[data-testid="connect-mcp-example"]';
const CLAUDE_CODE_COMMAND = `claude mcp add --transport http openwork ${MCP_SERVER_URL}`;
const INSTALL_COPY_BUTTON_SELECTOR = `${SECTION_SELECTOR} [role="tabpanel"]:not([hidden]) button[aria-label="Copy the OpenWork MCP install command"]`;

// Narration is loaded from the approved script (evals/voiceovers/landing-connect-mcp.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function routeUrl(ctx, path) {
  return new URL(path, ctx.env.OPENWORK_EVAL_LANDING_URL).toString();
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

async function applyDesktopViewport(ctx) {
  if (!ctx.client?.send) {
    ctx.log("Desktop viewport skipped: no raw CDP send method on context.");
    return;
  }

  await ctx.client.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  }).catch((error) => {
    ctx.log(`Desktop viewport skipped: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function scrollSectionIntoView(ctx) {
  await ctx.eval(`(() => {
    document.querySelector(${JSON.stringify(SECTION_SELECTOR)})?.scrollIntoView({ block: "start", behavior: "instant" });
    return true;
  })()`);
}

async function ensureConnectSection(ctx) {
  await applyDesktopViewport(ctx);
  const hasSection = await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(SECTION_SELECTOR)}))`).catch(() => false);

  if (!hasSection) {
    await fetch(routeUrl(ctx, "/")).catch(() => {});
    await ctx.eval(`location.href = ${JSON.stringify(routeUrl(ctx, "/"))}; true`);
  }

  await ctx.waitFor(
    `(() => {
      const section = document.querySelector(${JSON.stringify(SECTION_SELECTOR)});
      const text = section ? section.innerText : "";
      return Boolean(section) && text.includes("Connect any agent") && text.includes(${JSON.stringify(MCP_SERVER_URL)});
    })()`,
    { timeoutMs: 30_000, label: "Connect any agent MCP section" },
  );
  await scrollSectionIntoView(ctx);
}

async function realMouseClick(ctx, elementExpression, label) {
  const point = await ctx.eval(`(() => {
    const element = ${elementExpression};
    if (!element) return null;
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = element.getBoundingClientRect();
    return {
      visible: rect.width > 0 && rect.height > 0,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  })()`);

  ctx.assert(point !== null && point.visible === true, `${label} was not found or visible.`);

  if (!ctx.client?.send) {
    await ctx.eval(`(() => {
      const element = ${elementExpression};
      element?.click();
      return true;
    })()`);
    return;
  }

  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

function tabByLabelExpression(label) {
  return `Array.from(document.querySelectorAll(${JSON.stringify(`${SECTION_SELECTOR} [role="tab"]`)}))
    .find((tab) => (tab.textContent || "").trim() === ${JSON.stringify(label)})`;
}

async function scrollExampleTextIntoView(ctx, text) {
  await ctx.eval(`(() => {
    const example = document.querySelector(${JSON.stringify(EXAMPLE_SELECTOR)});
    if (!example) return false;
    const target = Array.from(example.querySelectorAll("*"))
      .find((element) => (element.textContent || "").includes(${JSON.stringify(text)}));
    (target || example).scrollIntoView({ block: "center", behavior: "instant" });
    return true;
  })()`);
}

export default {
  id: FLOW_ID,
  title: "Connect any agent to OpenWork Cloud from the landing page",
  kind: "user-facing",
  spec: "evals/README.md",
  preserveTheme: true,
  requiredEnv: ["OPENWORK_EVAL_LANDING_URL"],
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("The landing page exposes the Connect any agent MCP section and server URL.", {
          voiceover: vo[0],
          // "Scrolling the OpenWork landing page, I reach a new section — Connect any age"
          action: async () => {
            await ensureConnectSection(ctx);
          },
          assert: async () => {
            const actual = await ctx.eval(`(() => {
              const section = document.querySelector(${JSON.stringify(SECTION_SELECTOR)});
              const bodyText = document.body.innerText;
              return {
                sectionExists: Boolean(section),
                bodyHasHeading: bodyText.includes("Connect any agent"),
                bodyHasServerUrl: bodyText.includes(${JSON.stringify(MCP_SERVER_URL)}),
                sectionText: section ? section.innerText.slice(0, 500) : "",
              };
            })()`);
            recordAssertion(
              ctx,
              "The Connect any agent section and OpenWork MCP server URL are present on the landing page",
              actual.sectionExists === true && actual.bodyHasHeading === true && actual.bodyHasServerUrl === true,
              actual,
            );
          },
          screenshot: { name: "frame-1", requireText: ["Connect any agent"] },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("Cursor is the default MCP install tab and its one-click deeplink encodes the OpenWork server URL.", {
          voiceover: vo[1],
          // "I pick my client: Cursor is selected with a one-click Add to Cursor button, "
          action: async () => {
            await ensureConnectSection(ctx);
            // Center the install card on the Add to Cursor button so this frame
            // shows the client picker itself (and differs from frame 1's
            // section-top framing — the runner rejects duplicate captures).
            await ctx.eval(`(() => {
              const links = Array.from(document.querySelectorAll(${JSON.stringify(`${SECTION_SELECTOR} a`)}));
              const addToCursor = links.find((link) => (link.textContent || "").trim() === "Add to Cursor");
              addToCursor?.scrollIntoView({ block: "center", behavior: "instant" });
              return Boolean(addToCursor);
            })()`);
          },
          assert: async () => {
            const actual = await ctx.eval(`(() => {
              const section = document.querySelector(${JSON.stringify(SECTION_SELECTOR)});
              const tabs = Array.from(section ? section.querySelectorAll('[role="tab"]') : []);
              const cursorTab = tabs.find((tab) => (tab.textContent || "").trim() === "Cursor");
              const links = Array.from(section ? section.querySelectorAll("a") : []);
              const addToCursor = links.find((link) => (link.textContent || "").trim() === "Add to Cursor");
              const href = addToCursor ? addToCursor.href : "";
              let decodedConfig = "";
              let decodedUrl = "";
              let parseError = "";

              try {
                const config = new URL(href).searchParams.get("config") || "";
                decodedConfig = atob(config);
                const parsed = JSON.parse(decodedConfig);
                decodedUrl = typeof parsed.url === "string" ? parsed.url : "";
              } catch (error) {
                parseError = error instanceof Error ? error.message : String(error);
              }

              return {
                cursorSelected: cursorTab ? cursorTab.getAttribute("aria-selected") : null,
                addToCursorExists: Boolean(addToCursor),
                href,
                decodedConfig,
                decodedUrl,
                parseError,
              };
            })()`);
            ctx.recordEvidence({
              type: "output",
              name: "Decoded Cursor MCP config",
              text: actual.decodedConfig,
            });
            recordAssertion(
              ctx,
              "The Cursor tab is selected by default and the Add to Cursor anchor exists",
              actual.cursorSelected === "true" && actual.addToCursorExists === true,
              actual,
            );
            recordAssertion(
              ctx,
              "The Add to Cursor deeplink config decodes to the OpenWork MCP server URL",
              actual.parseError === "" && actual.decodedUrl === MCP_SERVER_URL,
              actual,
            );
          },
          screenshot: { name: "frame-2", requireText: ["Add to Cursor"] },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        let clipboardRead = { text: "", error: "not read" };

        await ctx.prove("Claude Code is a single command, and copying writes that exact command to the clipboard.", {
          voiceover: vo[2],
          // "I switch to Claude Code and it's a single command; I hit copy and the exact "
          action: async () => {
            await ensureConnectSection(ctx);
            await realMouseClick(ctx, tabByLabelExpression("Claude Code"), "Claude Code tab");
            await ctx.waitFor(
              `(() => {
                const panel = document.querySelector(${JSON.stringify(`${SECTION_SELECTOR} [role="tabpanel"]:not([hidden])`)});
                return Boolean(panel && panel.innerText.includes(${JSON.stringify(CLAUDE_CODE_COMMAND)}));
              })()`,
              { timeoutMs: 10_000, label: "Claude Code command visible" },
            );
            await grantClipboardPermissions(ctx);
            await realMouseClick(
              ctx,
              `document.querySelector(${JSON.stringify(INSTALL_COPY_BUTTON_SELECTOR)})`,
              "visible OpenWork MCP install copy button",
            );
            await ctx.waitFor(
              `(() => {
                const section = document.querySelector(${JSON.stringify(SECTION_SELECTOR)});
                return Boolean(section && section.querySelector('[data-feedback="true"]') && section.innerText.includes("Copied"));
              })()`,
              { timeoutMs: 10_000, label: "Copied feedback state" },
            );

            try {
              const text = await ctx.eval("navigator.clipboard.readText()", { awaitPromise: true });
              clipboardRead = { text, error: "" };
            } catch (error) {
              clipboardRead = {
                text: "",
                error: error instanceof Error ? error.message : String(error),
              };
            }
            await sleep(150);
          },
          assert: async () => {
            const feedbackScan = await ctx.eval(`(() => {
              const section = document.querySelector(${JSON.stringify(SECTION_SELECTOR)});
              return {
                feedbackActive: Boolean(section && section.querySelector('[data-feedback="true"]')),
                copiedVisible: Boolean(section && section.innerText.includes("Copied")),
                visiblePanelText: document.querySelector(${JSON.stringify(`${SECTION_SELECTOR} [role="tabpanel"]:not([hidden])`)})?.innerText || "",
              };
            })()`);
            ctx.recordEvidence({
              type: "output",
              name: "Clipboard readText result",
              text: JSON.stringify(clipboardRead, null, 2),
            });
            recordAssertion(
              ctx,
              "navigator.clipboard.readText returns the exact Claude Code MCP command",
              clipboardRead.error === "" && clipboardRead.text === CLAUDE_CODE_COMMAND,
              clipboardRead,
            );
            recordAssertion(
              ctx,
              "The install card shows the Copied feedback state after copying",
              feedbackScan.feedbackActive === true && feedbackScan.copiedVisible === true,
              feedbackScan,
            );
          },
          screenshot: { name: "frame-3", requireText: ["Copied"] },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("The example panel shows search_capabilities finding meeting notes in the org's Granola connection.", {
          voiceover: vo[3],
          // "Beside the install card, the section shows what connecting unlocks: the agen"
          action: async () => {
            await ensureConnectSection(ctx);
            await scrollExampleTextIntoView(ctx, "search_capabilities");
            await ctx.waitFor(
              `(() => {
                const example = document.querySelector(${JSON.stringify(EXAMPLE_SELECTOR)});
                const text = example ? example.innerText : "";
                return text.includes("search_capabilities") && text.includes("meeting notes") && text.includes("granola");
              })()`,
              { timeoutMs: 10_000, label: "search_capabilities example" },
            );
          },
          assert: async () => {
            const actual = await ctx.eval(`(() => {
              const example = document.querySelector(${JSON.stringify(EXAMPLE_SELECTOR)});
              const text = example ? example.innerText : "";
              return {
                exampleExists: Boolean(example),
                hasSearchCapabilities: text.includes("search_capabilities"),
                hasMeetingNotes: text.includes("meeting notes"),
                hasGranola: text.includes("granola"),
                hasPathParams: text.includes("pathParams"),
                hasQueryParams: text.includes("queryParams"),
              };
            })()`);
            recordAssertion(
              ctx,
              "The example search shows meeting notes, the Granola connection, and capability parameters",
              actual.exampleExists === true
                && actual.hasSearchCapabilities === true
                && actual.hasMeetingNotes === true
                && actual.hasGranola === true
                && actual.hasPathParams === true
                && actual.hasQueryParams === true,
              actual,
            );
          },
          screenshot: { name: "frame-4", requireText: ["search_capabilities"] },
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        await ctx.prove("The example continues from search_capabilities into execute_capability and returns meeting data.", {
          voiceover: vo[4],
          // "Then execute_capability runs the top match and the data comes back — search,"
          action: async () => {
            await ensureConnectSection(ctx);
            await scrollExampleTextIntoView(ctx, "execute_capability");
            await ctx.waitFor(
              `(() => {
                const example = document.querySelector(${JSON.stringify(EXAMPLE_SELECTOR)});
                const text = example ? example.innerText : "";
                return text.includes("execute_capability") && text.includes("Design review") && text.includes("Customer onboarding");
              })()`,
              { timeoutMs: 10_000, label: "execute_capability example result" },
            );
          },
          assert: async () => {
            const actual = await ctx.eval(`(() => {
              const example = document.querySelector(${JSON.stringify(EXAMPLE_SELECTOR)});
              const text = example ? example.innerText : "";
              return {
                hasExecuteCapability: text.includes("execute_capability"),
                hasTopMatchName: text.includes("mcp:granola:query_meetings"),
                hasDesignReview: text.includes("Design review"),
                hasCustomerOnboarding: text.includes("Customer onboarding"),
              };
            })()`);
            recordAssertion(
              ctx,
              "The example execute call runs the Granola top match and returns meeting result data",
              actual.hasExecuteCapability === true
                && actual.hasTopMatchName === true
                && actual.hasDesignReview === true
                && actual.hasCustomerOnboarding === true,
              actual,
            );
          },
          screenshot: { name: "frame-5", requireText: ["execute_capability"] },
        });
      },
    },
    {
      name: "Frame 6",
      run: async (ctx) => {
        await ctx.prove("Read the docs links to the Cloud MCP guide for OAuth details.", {
          voiceover: vo[5],
          // "Read the docs points at the Cloud MCP guide with the OAuth details — sign in"
          action: async () => {
            await ensureConnectSection(ctx);
            await ctx.eval(`(() => {
              const links = Array.from(document.querySelectorAll(${JSON.stringify(`${SECTION_SELECTOR} a`)}));
              const docs = links.find((link) => (link.textContent || "").trim() === "Read the docs");
              docs?.scrollIntoView({ block: "center", behavior: "instant" });
              return Boolean(docs);
            })()`);
            await ctx.waitFor(
              `(() => Array.from(document.querySelectorAll(${JSON.stringify(`${SECTION_SELECTOR} a`)}))
                .some((link) => (link.textContent || "").trim() === "Read the docs"))()`,
              { timeoutMs: 10_000, label: "Read the docs link" },
            );
          },
          assert: async () => {
            const actual = await ctx.eval(`(() => {
              const links = Array.from(document.querySelectorAll(${JSON.stringify(`${SECTION_SELECTOR} a`)}));
              const docs = links.find((link) => (link.textContent || "").trim() === "Read the docs");
              return {
                exists: Boolean(docs),
                href: docs ? docs.href : "",
                target: docs ? docs.target : "",
                rel: docs ? docs.rel : "",
              };
            })()`);
            recordAssertion(
              ctx,
              "Read the docs points exactly to the OpenWork Cloud MCP guide",
              actual.exists === true && actual.href === DOCS_URL,
              actual,
            );
          },
          screenshot: { name: "frame-6", requireText: ["Read the docs"] },
        });
      },
    },
  ],
};
