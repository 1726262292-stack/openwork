import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "landing-connect-mcp";
const MCP_SERVER_URL = "https://api.openworklabs.com/mcp/agent";
const DOCS_URL = "https://openworklabs.com/docs/cloud/run-in-the-cloud/cloud-mcp";
const SECTION_SELECTOR = "#connect-mcp";
const BRING_SELECTOR = '[data-testid="connect-mcp-bring"]';
const EXAMPLE_SELECTOR = '[data-testid="connect-mcp-example"]';
const INSTALL_SELECTOR = '[data-testid="connect-mcp-install"]';
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

async function scrollSelectorIntoView(ctx, selector, block = "center") {
  await ctx.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element?.scrollIntoView({ block: ${JSON.stringify(block)}, behavior: "instant" });
    return Boolean(element);
  })()`);
}

async function ensureConnectSection(ctx, { forceReload = false } = {}) {
  await applyDesktopViewport(ctx);
  const hasSection = await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(SECTION_SELECTOR)}))`).catch(() => false);

  if (!hasSection || forceReload) {
    await fetch(routeUrl(ctx, "/")).catch(() => {});
    await ctx.eval(`location.href = ${JSON.stringify(routeUrl(ctx, "/"))}; true`);
  }

  await ctx.waitFor(
    `(() => {
      const section = document.querySelector(${JSON.stringify(SECTION_SELECTOR)});
      const text = section ? section.innerText : "";
      return Boolean(section)
        && text.includes("Already doing it in your agent?")
        && text.includes("Add it to OpenWork")
        && text.includes(${JSON.stringify(MCP_SERVER_URL)});
    })()`,
    { timeoutMs: 30_000, label: "Connect section with new sharing headline" },
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
  title: "Add existing agent work to OpenWork, share it, and use it anywhere",
  kind: "user-facing",
  spec: "evals/README.md",
  preserveTheme: true,
  requiredEnv: ["OPENWORK_EVAL_LANDING_URL"],
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("The landing page leads with adding existing agent work to OpenWork and sharing it with the team.", {
          voiceover: vo[0],
          action: async () => {
            await ensureConnectSection(ctx, { forceReload: true });
          },
          assert: async () => {
            const actual = await ctx.eval(`(() => {
              const section = document.querySelector(${JSON.stringify(SECTION_SELECTOR)});
              const text = section ? section.innerText : "";
              return {
                sectionExists: Boolean(section),
                hasAlreadyDoingHeading: text.includes("Already doing it in your agent?"),
                hasAddItHeading: text.includes("Add it to OpenWork"),
                hasServerUrl: text.includes(${JSON.stringify(MCP_SERVER_URL)}),
              };
            })()`);
            recordAssertion(
              ctx,
              "The Connect section includes the new heading and OpenWork MCP server URL",
              actual.sectionExists === true
                && actual.hasAlreadyDoingHeading === true
                && actual.hasAddItHeading === true
                && actual.hasServerUrl === true,
              actual,
            );
          },
          screenshot: { name: "frame-1", requireText: ["Add it to OpenWork"] },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("The bring-it-in card shows existing agent setups moving into OpenWork unchanged and shared in one link.", {
          voiceover: vo[1],
          action: async () => {
            await ensureConnectSection(ctx);
            await scrollSelectorIntoView(ctx, BRING_SELECTOR);
            await ctx.waitFor(
              `(() => {
                const card = document.querySelector(${JSON.stringify(BRING_SELECTOR)});
                const text = card ? card.innerText : "";
                return text.includes("Granola")
                  && text.includes("Meeting Brief Generator")
                  && text.includes("review-pr")
                  && text.includes("SKILL.md")
                  && text.includes("one link");
              })()`,
              { timeoutMs: 10_000, label: "bring existing setup card" },
            );
          },
          assert: async () => {
            const actual = await ctx.eval(`(() => {
              const card = document.querySelector(${JSON.stringify(BRING_SELECTOR)});
              const text = card ? card.innerText : "";
              return {
                exists: Boolean(card),
                hasGranola: text.includes("Granola"),
                hasMeetingBriefGenerator: text.includes("Meeting Brief Generator"),
                hasReviewPr: text.includes("review-pr"),
                hasSkillMd: text.includes("SKILL.md"),
                hasOneLink: text.includes("one link"),
              };
            })()`);
            recordAssertion(
              ctx,
              "The bring-it-in card shows Granola, Meeting Brief Generator, review-pr, SKILL.md, and one link",
              actual.exists === true
                && actual.hasGranola === true
                && actual.hasMeetingBriefGenerator === true
                && actual.hasReviewPr === true
                && actual.hasSkillMd === true
                && actual.hasOneLink === true,
              actual,
            );
          },
          screenshot: { name: "frame-2", requireText: ["SKILL.md"] },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("The example window shows search_capabilities finding shared meeting notes, Granola, and the meeting-brief skill.", {
          voiceover: vo[2],
          action: async () => {
            await ensureConnectSection(ctx);
            // Align the example window's top with the viewport top: frame 2
            // centers the sibling bring-it-in card in the same grid row, so a
            // "center" scroll here would land on the same offset and the
            // runner would reject the capture as a duplicate frame.
            await scrollSelectorIntoView(ctx, EXAMPLE_SELECTOR, "start");
            await ctx.waitFor(
              `(() => {
                const example = document.querySelector(${JSON.stringify(EXAMPLE_SELECTOR)});
                const text = example ? example.innerText : "";
                return text.includes("search_capabilities")
                  && text.includes("meeting notes")
                  && text.includes("granola")
                  && text.includes("plugin:meeting-brief:generate");
              })()`,
              { timeoutMs: 10_000, label: "search_capabilities shared results" },
            );
          },
          assert: async () => {
            const actual = await ctx.eval(`(() => {
              const example = document.querySelector(${JSON.stringify(EXAMPLE_SELECTOR)});
              const text = example ? example.innerText : "";
              return {
                exists: Boolean(example),
                hasSearchCapabilities: text.includes("search_capabilities"),
                hasMeetingNotes: text.includes("meeting notes"),
                hasGranola: text.includes("granola"),
                hasMeetingBriefPlugin: text.includes("plugin:meeting-brief:generate"),
              };
            })()`);
            recordAssertion(
              ctx,
              "The teammate agent example finds meeting notes, Granola, and the shared meeting-brief skill",
              actual.exists === true
                && actual.hasSearchCapabilities === true
                && actual.hasMeetingNotes === true
                && actual.hasGranola === true
                && actual.hasMeetingBriefPlugin === true,
              actual,
            );
          },
          screenshot: { name: "frame-3", requireText: ["search_capabilities"] },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("execute_capability runs the shared skill and returns the Acme Corp brief.", {
          voiceover: vo[3],
          action: async () => {
            await ensureConnectSection(ctx);
            await scrollExampleTextIntoView(ctx, "execute_capability");
            await ctx.waitFor(
              `(() => {
                const example = document.querySelector(${JSON.stringify(EXAMPLE_SELECTOR)});
                const text = example ? example.innerText : "";
                return text.includes("execute_capability") && text.includes("Acme Corp") && text.includes("savedTo");
              })()`,
              { timeoutMs: 10_000, label: "execute_capability Acme Corp result" },
            );
          },
          assert: async () => {
            const actual = await ctx.eval(`(() => {
              const example = document.querySelector(${JSON.stringify(EXAMPLE_SELECTOR)});
              const text = example ? example.innerText : "";
              return {
                exists: Boolean(example),
                hasExecuteCapability: text.includes("execute_capability"),
                hasAcmeCorp: text.includes("Acme Corp"),
                hasSavedTo: text.includes("savedTo"),
              };
            })()`);
            recordAssertion(
              ctx,
              "The example execute call returns Acme Corp brief output with savedTo",
              actual.exists === true
                && actual.hasExecuteCapability === true
                && actual.hasAcmeCorp === true
                && actual.hasSavedTo === true,
              actual,
            );
          },
          screenshot: { name: "frame-4", requireText: ["execute_capability"] },
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        let cursorScan = null;
        let clipboardRead = { text: "", error: "not read" };

        await ctx.prove("Connecting an agent starts with Cursor by default, then Claude Code copies the exact MCP command and reveals the OAuth steps.", {
          voiceover: vo[4],
          action: async () => {
            await ensureConnectSection(ctx);
            await scrollSelectorIntoView(ctx, INSTALL_SELECTOR);
            cursorScan = await ctx.eval(`(() => {
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
                const text = section ? section.innerText : "";
                return Boolean(section && section.querySelector('[data-feedback="true"]') && text.includes("Copied") && text.includes("Sign in in the browser") && text.includes("Pick your org"));
              })()`,
              { timeoutMs: 10_000, label: "Copied feedback state and reveal steps" },
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
            ctx.recordEvidence({
              type: "output",
              name: "Decoded Cursor MCP config",
              text: cursorScan?.decodedConfig ?? "",
            });
            recordAssertion(
              ctx,
              "Cursor is selected by default and Add to Cursor decodes to the OpenWork MCP server URL",
              cursorScan?.cursorSelected === "true"
                && cursorScan.addToCursorExists === true
                && cursorScan.parseError === ""
                && cursorScan.decodedUrl === MCP_SERVER_URL,
              cursorScan,
            );

            const feedbackScan = await ctx.eval(`(() => {
              const section = document.querySelector(${JSON.stringify(SECTION_SELECTOR)});
              return {
                feedbackActive: Boolean(section && section.querySelector('[data-feedback="true"]')),
                copiedVisible: Boolean(section && section.innerText.includes("Copied")),
                signInStepVisible: Boolean(section && section.innerText.includes("Sign in in the browser")),
                pickOrgStepVisible: Boolean(section && section.innerText.includes("Pick your org")),
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
              "The install card shows the Copied feedback state and browser sign-in reveal steps after copying",
              feedbackScan.feedbackActive === true
                && feedbackScan.copiedVisible === true
                && feedbackScan.signInStepVisible === true
                && feedbackScan.pickOrgStepVisible === true,
              feedbackScan,
            );
          },
          screenshot: { name: "frame-5", requireText: ["Copied"] },
        });
      },
    },
    {
      name: "Frame 6",
      run: async (ctx) => {
        await ctx.prove("Read the docs links to the Cloud MCP guide for OAuth details.", {
          voiceover: vo[5],
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
