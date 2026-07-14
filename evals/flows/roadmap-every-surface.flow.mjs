import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "roadmap-every-surface";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

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

async function applyDesktopViewport(ctx) {
  if (!ctx.client?.send) return;

  await ctx.client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function navigateTo(ctx, path, expectedText) {
  await applyDesktopViewport(ctx);
  await fetch(routeUrl(ctx, path)).catch(() => {});
  await ctx.eval(`location.href = ${JSON.stringify(routeUrl(ctx, path))}; true`);
  await ctx.waitFor(
    `location.pathname === ${JSON.stringify(path)} && document.body.innerText.includes(${JSON.stringify(expectedText)})`,
    { timeoutMs: 30_000, label: `${path} route with ${expectedText}` },
  );
}

async function scrollTo(ctx, selector, block = "start") {
  await ctx.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element?.scrollIntoView({ block: ${JSON.stringify(block)}, behavior: "instant" });
    return Boolean(element);
  })()`);
  await ctx.waitFor(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    })()`,
    { timeoutMs: 10_000, label: `${selector} visible` },
  );
}

async function sectionState(ctx, selector) {
  return ctx.eval(`(() => {
    const section = document.querySelector(${JSON.stringify(selector)});
    const text = section?.innerText || "";
    return {
      exists: Boolean(section),
      text,
      live: Array.from(section?.querySelectorAll("span") || []).filter((node) => node.textContent?.trim() === "Live").length,
      building: Array.from(section?.querySelectorAll("span") || []).filter((node) => node.textContent?.trim() === "Building").length,
      next: Array.from(section?.querySelectorAll("span") || []).filter((node) => node.textContent?.trim() === "Next").length,
      exploring: Array.from(section?.querySelectorAll("span") || []).filter((node) => node.textContent?.trim() === "Exploring").length,
    };
  })()`);
}

export default {
  id: FLOW_ID,
  title: "The OpenWork roadmap presents desktop as home and the same workspace on every surface",
  kind: "user-facing",
  spec: "evals/voiceovers/roadmap-every-surface.md",
  preserveTheme: true,
  requiredEnv: ["OPENWORK_EVAL_LANDING_URL"],
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("The roadmap leads with desktop as home and maps the workspace to current and future surfaces.", {
          voiceover: vo[0],
          action: async () => {
            await navigateTo(ctx, "/roadmap", "on every surface.");
            await scrollTo(ctx, '[data-testid="openwork-roadmap"] > div', "center");
          },
          assert: async () => {
            const actual = await ctx.eval(`(() => {
              const roadmap = document.querySelector('[data-testid="openwork-roadmap"]');
              const text = roadmap?.innerText || "";
              return {
                path: location.pathname,
                roadmapExists: Boolean(roadmap),
                hasDesktop: text.includes("The complete workspace"),
                hasHosted: text.includes("Persistent hosted workspace"),
                hasCurrentAgents: ["Codex", "Claude Code", "Cursor", "OpenCode"].every((name) => text.includes(name)),
                hasFutureSurfaces: ["Slack", "Mobile", "Email", "Custom agents"].every((name) => text.includes(name)),
              };
            })()`);
            recordAssertion(
              ctx,
              "The visual map contains the desktop home base, hosted workspace, current agents, and future surfaces",
              actual.path === "/roadmap"
                && actual.roadmapExists === true
                && actual.hasDesktop === true
                && actual.hasHosted === true
                && actual.hasCurrentAgents === true
                && actual.hasFutureSurfaces === true,
              actual,
            );
          },
          screenshot: {
            name: "frame-1-surface-map",
            requireText: ["The complete workspace", "Persistent hosted workspace", "Slack", "Mobile"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("The desktop section distinguishes what is live from the work actively being built.", {
          voiceover: vo[1],
          action: async () => {
            await scrollTo(ctx, "#desktop-home");
          },
          assert: async () => {
            const actual = await sectionState(ctx, "#desktop-home");
            recordAssertion(
              ctx,
              "The desktop section shows all four current capabilities as Live and long-running organization as Building",
              actual.exists === true
                && actual.text.includes("the desktop app is home")
                && actual.text.includes("Local files and workspaces")
                && actual.text.includes("Organization-managed capabilities")
                && actual.text.includes("Better organization for long-running work")
                && actual.live === 4
                && actual.building === 1,
              actual,
            );
          },
          screenshot: {
            name: "frame-2-desktop-home",
            requireText: ["the desktop app is home", "Local files and workspaces", "Building"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("The portability section shows how the desktop setup travels through OpenWork Connect.", {
          voiceover: vo[2],
          action: async () => {
            await scrollTo(ctx, "#setup-follows");
          },
          assert: async () => {
            const actual = await sectionState(ctx, "#setup-follows");
            recordAssertion(
              ctx,
              "The Connect section names the supported agents, marketplace controls, authentication modes, and Git sync direction",
              actual.exists === true
                && actual.text.includes("your setup follows you")
                && actual.text.includes("OpenWork Connect MCP")
                && actual.text.includes("Codex, Claude Code, Cursor, and OpenCode")
                && actual.text.includes("Organization marketplaces and access controls")
                && actual.text.includes("Shared and per-user authentication")
                && actual.text.includes("Git-based publishing and automatic sync")
                && actual.live === 4
                && actual.building === 1,
              actual,
            );
          },
          screenshot: {
            name: "frame-3-setup-follows",
            requireText: ["your setup follows you", "OpenWork Connect MCP", "Git-based publishing"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("The hosted-workspace section explains the persistent runtime and the sequence of upcoming work.", {
          voiceover: vo[3],
          action: async () => {
            await scrollTo(ctx, "#hosted-workspaces");
          },
          assert: async () => {
            const actual = await sectionState(ctx, "#hosted-workspaces");
            recordAssertion(
              ctx,
              "The hosted-workspace section includes remote connections, persistence, reproducibility, background work, schedules, and surface handoff",
              actual.exists === true
                && actual.text.includes("a workspace that stays on")
                && actual.text.includes("persistent filesystem")
                && actual.text.includes("Remote workspace connections")
                && actual.text.includes("Reproducible environments")
                && actual.text.includes("Long-running and background tasks")
                && actual.text.includes("Scheduled workflows")
                && actual.text.includes("Continue from another surface")
                && actual.live === 1
                && actual.building === 3
                && actual.next === 2,
              actual,
            );
          },
          screenshot: {
            name: "frame-4-hosted-workspaces",
            requireText: ["a workspace that stays on", "Persistent hosted workspaces", "Scheduled workflows"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        await ctx.prove("The surfaces section makes the sequence from desktop to Slack, mobile, and beyond explicit.", {
          voiceover: vo[4],
          action: async () => {
            await scrollTo(ctx, "#every-surface");
          },
          assert: async () => {
            const actual = await sectionState(ctx, "#every-surface");
            recordAssertion(
              ctx,
              "Desktop and MCP agents are Live, Slack and mobile are Next, and later surfaces are Exploring",
              actual.exists === true
                && actual.text.includes("OpenWork on every surface")
                && actual.text.includes("OpenWork desktop")
                && actual.text.includes("Existing AI agents through MCP")
                && actual.text.includes("Slack")
                && actual.text.includes("Mobile")
                && actual.text.includes("Email and messaging")
                && actual.text.includes("Custom organization agents")
                && actual.live === 2
                && actual.next === 2
                && actual.exploring === 2,
              actual,
            );
          },
          screenshot: {
            name: "frame-5-every-surface",
            requireText: ["OpenWork on every surface", "Slack", "Mobile", "Exploring"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 6",
      run: async (ctx) => {
        await ctx.prove("The docs route renders the same shared roadmap and closes with four upcoming specifications.", {
          voiceover: vo[5],
          action: async () => {
            await navigateTo(ctx, "/docs/roadmap", "upcoming specifications");
            await scrollTo(ctx, "#specifications");
          },
          assert: async () => {
            const actual = await ctx.eval(`(() => {
              const roadmap = document.querySelector('[data-testid="openwork-roadmap"]');
              const specs = document.querySelector("#specifications");
              const text = specs?.innerText || "";
              const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
              return {
                path: location.pathname,
                sharedRoadmapExists: Boolean(roadmap),
                specCount: specs?.querySelectorAll("article").length || 0,
                hasCapabilitySpec: text.includes("OpenWork Capability Spec"),
                hasWorkspaceSpec: text.includes("OpenWork Workspace Spec"),
                hasSurfaceSpec: text.includes("OpenWork Surface Spec"),
                hasRunSpec: text.includes("OpenWork Run Spec"),
                canonical,
              };
            })()`);
            recordAssertion(
              ctx,
              "The local docs route uses the shared roadmap component, renders all four specs, and canonicals to the public roadmap",
              actual.path === "/docs/roadmap"
                && actual.sharedRoadmapExists === true
                && actual.specCount === 4
                && actual.hasCapabilitySpec === true
                && actual.hasWorkspaceSpec === true
                && actual.hasSurfaceSpec === true
                && actual.hasRunSpec === true
                && actual.canonical.endsWith("/roadmap"),
              actual,
            );
          },
          screenshot: {
            name: "frame-6-docs-specifications",
            requireText: ["upcoming specifications", "OpenWork Capability Spec", "OpenWork Run Spec"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
  ],
};
