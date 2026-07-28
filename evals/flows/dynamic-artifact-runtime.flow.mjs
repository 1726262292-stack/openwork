import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "dynamic-artifact-runtime";
const EVAL_WORKSPACE = resolve(
  process.env.OPENWORK_EVAL_ARTIFACTS_DIR ?? "evals/results",
  "..",
  "dynamic-artifact-runtime-workspace",
);
const PROJECT_ID = "launch-radar";
const INSTANCE_ID = `launch-radar-eval-${Date.now().toString(36)}`;
const PROJECT_ROOT = `[data-ui-artifact-project="${PROJECT_ID}"]`;
const FRAME = `${PROJECT_ROOT} iframe`;
const STUDIO = "[data-ui-artifact-studio]";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const state = {
  sessionRoute: null,
  projectRevision: null,
  stateRevision: null,
};

function actionAvailable(actionId) {
  return `window.__openworkControl.listActions()
    .some((action) => action.id === ${JSON.stringify(actionId)} && !action.disabled)`;
}

async function dismissOnboardingPrompts(ctx) {
  const firstStep = await ctx.waitFor(`(() => {
    const ready = window.__openworkControl.listActions()
      .some((action) => action.id === "session.create_task" && !action.disabled);
    if (ready) return "ready";
    const text = document.body.innerText;
    if (text.includes("Skip and use the free model")) return "provider";
    if (text.includes("How did you hear about OpenWork?")) return "survey";
    return null;
  })()`, {
    timeoutMs: 60_000,
    label: "task creation or first-run prompt",
  });
  if (firstStep === "provider") {
    await ctx.clickText("Skip and use the free model", {
      selector: "button",
      timeoutMs: 10_000,
    });
  }
  const secondStep = firstStep === "ready"
    ? "ready"
    : await ctx.waitFor(`(() => {
      const ready = window.__openworkControl.listActions()
        .some((action) => action.id === "session.create_task" && !action.disabled);
      if (ready) return "ready";
      return document.body.innerText.includes("How did you hear about OpenWork?")
        ? "survey"
        : null;
    })()`, {
      timeoutMs: 30_000,
      label: "task creation or attribution prompt",
    });
  if (firstStep === "survey" || secondStep === "survey") {
    await ctx.clickText("Skip", { selector: "button", timeoutMs: 10_000 });
  }
}

async function ensureWorkspace(ctx) {
  await mkdir(EVAL_WORKSPACE, { recursive: true });

  const route = await ctx.eval("String(window.__openworkControl.snapshot().route || '')");
  if (route.includes("/settings")) {
    await ctx.navigateHash("/");
    await ctx.waitFor(
      `!String(window.__openworkControl.snapshot().route || "").includes("/settings")`,
      { timeoutMs: 30_000, label: "return to workspace from settings" },
    );
  }

  if (await ctx.eval(actionAvailable("session.create_task"))) return;
  if (
    (await ctx.hasText("Skip and use the free model")) ||
    (await ctx.hasText("How did you hear about OpenWork?"))
  ) {
    await dismissOnboardingPrompts(ctx);
    if (await ctx.eval(actionAvailable("session.create_task"))) return;
  }

  if (await ctx.hasText("Use Without Cloud")) {
    await ctx.clickText("Use Without Cloud", {
      selector: "button",
      timeoutMs: 15_000,
    });
    await ctx.waitFor("Boolean(window.__openworkControl)", {
      timeoutMs: 30_000,
      label: "OpenWork control API after local-mode selection",
    });
  }

  const welcomeInput = 'input[placeholder="/workspace/my-project"]';
  if (await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(welcomeInput)}))`)) {
    await ctx.fill(welcomeInput, EVAL_WORKSPACE);
    await ctx.clickText("Use this folder", {
      selector: "button",
      timeoutMs: 15_000,
    });
  } else if (!(await ctx.eval(actionAvailable("session.create_task")))) {
    await ctx.waitFor(actionAvailable("workspace.create"), {
      timeoutMs: 30_000,
      label: "workspace.create action",
    });
    await ctx.control("workspace.create", { path: EVAL_WORKSPACE });
  }

  await dismissOnboardingPrompts(ctx);
  await ctx.waitFor(actionAvailable("session.create_task"), {
    timeoutMs: 60_000,
    label: "task creation after isolated workspace setup",
  });
}

async function dismissStartupPromo(ctx) {
  if (!(await ctx.hasText("Start working without API keys"))) return;
  if (await ctx.hasText("Continue with my own provider keys")) {
    await ctx.clickText("Continue with my own provider keys", {
      selector: "button",
      timeoutMs: 10_000,
    });
  } else {
    const closed = await ctx.eval(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"], [data-slot="dialog-content"]')]
        .find((element) => element.textContent?.includes("Start working without API keys"));
      const button = dialog?.querySelector('button[aria-label="Close"]');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    ctx.assert(closed, "The OpenWork Models startup dialog could not be dismissed.");
  }
  await ctx.waitFor(
    `!document.body.innerText.includes("Start working without API keys")`,
    { timeoutMs: 10_000, label: "OpenWork Models startup dialog dismissed" },
  );
}

async function ensureSession(ctx) {
  const route = await ctx.eval("window.__openworkControl.snapshot().route");
  if (typeof route === "string" && route.includes("/session/")) {
    state.sessionRoute = route;
    await dismissStartupPromo(ctx);
    return;
  }

  await ctx.waitFor(actionAvailable("session.create_task"), {
    timeoutMs: 60_000,
    label: "enabled session.create_task action",
  });
  await ctx.control("session.create_task");
  state.sessionRoute = await ctx.waitFor(
    `(() => {
      const next = window.__openworkControl.snapshot().route;
      return typeof next === "string" && next.includes("/session/") ? next : null;
    })()`,
    { timeoutMs: 60_000, label: "session route after task creation" },
  );
  await dismissStartupPromo(ctx);
}

async function readAttachment(ctx) {
  return ctx.eval(`(() => {
    const root = document.querySelector(${JSON.stringify(PROJECT_ROOT)});
    const frame = root?.querySelector("iframe");
    return {
      found: Boolean(root),
      text: root?.innerText ?? "",
      frameState: root?.querySelector("[data-ui-artifact-frame-state]")
        ?.getAttribute("data-ui-artifact-frame-state") ?? null,
      projectRevision: root?.getAttribute("data-ui-artifact-project-revision"),
      stateRevision: root?.getAttribute("data-ui-artifact-state-revision"),
      stateSummary: root?.getAttribute("data-ui-artifact-state-summary"),
      sandbox: frame?.getAttribute("sandbox") ?? "",
      referrerPolicy: frame?.getAttribute("referrerpolicy") ?? "",
      allow: frame?.getAttribute("allow") ?? "",
      srcdoc: frame?.getAttribute("srcdoc") ?? "",
    };
  })()`);
}

async function waitForReadyAttachment(ctx) {
  await ctx.waitFor(
    `Boolean(document.querySelector(${JSON.stringify(`${PROJECT_ROOT} [data-ui-artifact-frame-state="ready"]`)}))`,
    { timeoutMs: 60_000, label: "ready Launch Radar chat attachment" },
  );
  return readAttachment(ctx);
}

async function openStudioFromAttachment(ctx) {
  await ctx.clickText("Open editor", {
    selector: `${PROJECT_ROOT} button`,
    timeoutMs: 30_000,
  });
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(STUDIO)}))`, {
    timeoutMs: 30_000,
    label: "dynamic artifact studio",
  });
}

export default {
  id: FLOW_ID,
  title: "A described React artifact renders safely, stays interactive, and has a managed reusable lifecycle",
  kind: "user-facing",
  spec: "evals/voiceovers/dynamic-artifact-runtime.md",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__openworkControl)", {
      timeoutMs: 60_000,
      label: "OpenWork control API",
    });
    await ensureWorkspace(ctx);
    const availability = await ctx.eval(`(() => {
      const create = window.__openworkControl.listActions()
        .find((action) => action.id === "session.create_task");
      return create && !create.disabled
        ? { ok: true }
        : { ok: false, reason: "The selected workspace cannot create a task." };
    })()`);
    return availability?.ok ? null : availability?.reason;
  },
  steps: [
    {
      name: "Frame 1 — enable the managed builder skill",
      run: async (ctx) => {
        await ctx.prove("The workspace explicitly enables its injected Artifact Builder skill and manages it beside the project library", {
          voiceover: vo[0],
          action: async () => {
            await ensureSession(ctx);
            await ctx.waitFor(actionAvailable("ui-artifacts.seed-dynamic-project"), {
              timeoutMs: 30_000,
              label: "dynamic artifact project seed action",
            });
            await ctx.control("ui-artifacts.seed-dynamic-project", {
              projectId: PROJECT_ID,
              instanceId: INSTANCE_ID,
            });
            const attachment = await waitForReadyAttachment(ctx);
            state.projectRevision = attachment.projectRevision;
            state.stateRevision = attachment.stateRevision;
            const panelOpen = await ctx.eval(
              `document.querySelector('button[aria-label="UI Artifacts"]')?.getAttribute("aria-pressed") === "true"`,
            );
            if (!panelOpen) {
              await ctx.trustedClick('button[aria-label="UI Artifacts"]', {
                timeoutMs: 30_000,
              });
            }
            if (await ctx.eval(`Boolean(document.querySelector('button[aria-label="Back to generated projects"]'))`)) {
              await ctx.trustedClick('button[aria-label="Back to generated projects"]', {
                timeoutMs: 30_000,
              });
            }
            await ctx.waitForText("Artifact Builder skill", { timeoutMs: 30_000 });
            await ctx.waitFor(
              `Boolean(document.querySelector('[aria-label="Disable Artifact Builder skill"]')) &&
                document.body.innerText.includes("Injected")`,
              { timeoutMs: 30_000, label: "injected Artifact Builder skill enabled" },
            );
          },
          assert: async () => {
            await ctx.expectText("Artifact Builder skill");
            await ctx.expectText("Enabled for agents in this workspace.");
            await ctx.expectText("Injected");
            await ctx.expectText("Launch Radar");
          },
          screenshot: {
            name: "dynamic-artifact-builder-skill",
            requireText: ["Artifact Builder skill", "Injected", "Launch Radar"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 2 — create and attach the project",
      run: async (ctx) => {
        await ctx.prove("A deterministic code-mode project is built and attached as a live React artifact in chat", {
          voiceover: vo[1],
          action: async () => {
            if (await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(STUDIO)}))`)) {
              await ctx.trustedClick('button[aria-label="UI Artifacts"]', {
                timeoutMs: 30_000,
              });
            }
            await ctx.navigateHash(state.sessionRoute);
            await ctx.waitFor(
              `window.__openworkControl.snapshot().route === ${JSON.stringify(state.sessionRoute)}`,
              { timeoutMs: 60_000, label: "seeded artifact session route" },
            );
            const attachment = await waitForReadyAttachment(ctx);
            state.projectRevision = attachment.projectRevision;
            state.stateRevision = attachment.stateRevision;
          },
          assert: async () => {
            const attachment = await readAttachment(ctx);
            ctx.assert(attachment.found, "The Launch Radar attachment was not rendered.");
            ctx.assert(attachment.frameState === "ready", `Expected a ready artifact frame, got ${attachment.frameState}.`);
            ctx.assert(attachment.text.includes("Launch Radar"), "The generated attachment does not identify Launch Radar.");
            ctx.assert(attachment.text.includes("Open editor"), "The generated attachment does not expose Open editor.");
            ctx.assert(
              typeof attachment.projectRevision === "string" && /^[a-f0-9]{64}$/.test(attachment.projectRevision),
              `The attachment is missing its immutable project revision: ${attachment.projectRevision}.`,
            );
          },
          screenshot: {
            name: "dynamic-artifact-inline",
            requireText: ["Launch Radar", "Open editor"],
            rejectText: ["Artifact unavailable", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 3 — prove the isolated renderer",
      run: async (ctx) => {
        await ctx.prove("The generated component runs in a ready opaque iframe with network and host authority denied", {
          voiceover: vo[2],
          assert: async () => {
            const attachment = await waitForReadyAttachment(ctx);
            const sandboxTokens = attachment.sandbox.split(/\s+/).filter(Boolean);
            ctx.assert(
              sandboxTokens.length === 1 && sandboxTokens[0] === "allow-scripts",
              `Expected an opaque allow-scripts-only sandbox, got ${JSON.stringify(attachment.sandbox)}.`,
            );
            ctx.assert(!sandboxTokens.includes("allow-same-origin"), "The artifact iframe was granted same-origin access.");
            ctx.assert(attachment.allow === "", `The artifact iframe exposes an allow policy: ${attachment.allow}.`);
            ctx.assert(
              attachment.referrerPolicy === "no-referrer",
              `Expected no-referrer, got ${JSON.stringify(attachment.referrerPolicy)}.`,
            );
            ctx.assert(
              /connect-src\s+'none'/.test(attachment.srcdoc),
              "The artifact iframe document does not deny network connections in its CSP.",
            );
            ctx.assert(attachment.frameState === "ready", "The isolated renderer did not reach ready.");
          },
          screenshot: {
            name: "dynamic-artifact-safe-render",
            requireText: ["Launch Radar"],
            rejectText: ["Artifact unavailable", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 4 — interact with persisted local state",
      run: async (ctx) => {
        await ctx.prove("A click inside the opaque component updates its bounded persisted state", {
          voiceover: vo[3],
          action: async () => {
            const before = await readAttachment(ctx);
            state.stateRevision = before.stateRevision;
            await ctx.trustedClick(FRAME);
            const changed = await ctx.waitFor(
              `(() => {
                const root = document.querySelector(${JSON.stringify(PROJECT_ROOT)});
                const revision = root?.getAttribute("data-ui-artifact-state-revision");
                const summary = root?.getAttribute("data-ui-artifact-state-summary");
                return revision &&
                  revision !== ${JSON.stringify(state.stateRevision)} &&
                  summary === "watching-apollo"
                  ? { revision, summary }
                  : null;
              })()`,
              { timeoutMs: 30_000, label: "persisted Launch Radar watch state" },
            );
            state.stateRevision = changed.revision;
          },
          assert: async () => {
            const attachment = await readAttachment(ctx);
            ctx.assert(
              attachment.stateSummary === "watching-apollo",
              `Expected watching-apollo state, got ${attachment.stateSummary}.`,
            );
            ctx.assert(
              attachment.stateRevision === state.stateRevision,
              "The attachment did not mirror the persisted state revision.",
            );
          },
          screenshot: {
            name: "dynamic-artifact-local-state",
            requireText: ["Launch Radar"],
            rejectText: ["Artifact unavailable", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 5 — open the reusable project",
      run: async (ctx) => {
        await ctx.prove("Open editor reveals a library and editor for the complete five-file artifact project", {
          voiceover: vo[4],
          action: async () => {
            await openStudioFromAttachment(ctx);
            await ctx.waitFor(
              `(() => {
                const studio = document.querySelector(${JSON.stringify(STUDIO)});
                const text = studio?.innerText ?? "";
                return ["artifact.json", "src/App.tsx", "styles.css", "data.json", "data.schema.json"]
                  .every((file) => text.includes(file));
              })()`,
              { timeoutMs: 30_000, label: "complete artifact project file list" },
            );
          },
          assert: async () => {
            const studio = await ctx.eval(`(() => {
              const root = document.querySelector(${JSON.stringify(STUDIO)});
              const text = root?.innerText ?? "";
              const revision = root?.querySelector("[data-ui-artifact-project-revision]")
                ?.getAttribute("data-ui-artifact-project-revision") ?? null;
              return {
                found: Boolean(root),
                hasLibrary: text.toLowerCase().includes("library"),
                hasEditor: text.toLowerCase().includes("editor"),
                hasTitle: text.includes("Launch Radar"),
                revision,
              };
            })()`);
            ctx.assert(studio.found, "The artifact studio did not open.");
            ctx.assert(studio.hasLibrary && studio.hasEditor, "The studio does not expose both Library and Editor.");
            ctx.assert(studio.hasTitle, "The studio did not retain the Launch Radar project.");
            ctx.assert(
              studio.revision === state.projectRevision,
              `Editor revision ${studio.revision} does not match chat revision ${state.projectRevision}.`,
            );
          },
          screenshot: {
            name: "dynamic-artifact-project-editor",
            requireText: ["LIBRARY", "EDITOR", "src/App.tsx", "data.schema.json"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 6 — inspect source, contract, revision, and preview",
      run: async (ctx) => {
        await ctx.prove("The editor keeps React source, its data contract, immutable revision, and live preview together", {
          voiceover: vo[5],
          action: async () => {
            await ctx.clickText("src/App.tsx", { selector: `${STUDIO} button` });
            await ctx.waitFor(
              `(() => {
                const content = document.querySelector(${JSON.stringify(STUDIO)})?.querySelector(".cm-content");
                const text = content?.textContent ?? "";
                return text.includes("export default") && text.includes("Launch Radar");
              })()`,
              { timeoutMs: 30_000, label: "Launch Radar React source" },
            );
            await ctx.clickText("data.schema.json", { selector: `${STUDIO} button` });
            await ctx.waitFor(
              `(() => {
                const content = document.querySelector(${JSON.stringify(STUDIO)})?.querySelector(".cm-content");
                const text = content?.textContent ?? "";
                return text.includes("launches") && text.includes("type");
              })()`,
              { timeoutMs: 30_000, label: "Launch Radar data schema" },
            );
          },
          assert: async () => {
            const proof = await ctx.eval(`(() => {
              const studio = document.querySelector(${JSON.stringify(STUDIO)});
              const preview = studio?.querySelector("[data-ui-artifact-studio-preview]");
              const frame = preview?.querySelector("iframe");
              const revision = studio?.querySelector("[data-ui-artifact-project-revision]")
                ?.getAttribute("data-ui-artifact-project-revision") ?? null;
              const editorText = studio?.querySelector(".cm-content")?.textContent ?? "";
              return {
                hasPreview: Boolean(preview),
                hasPreviewFrame: Boolean(frame),
                schemaVisible: editorText.includes("launches") && editorText.includes("type"),
                revision,
              };
            })()`);
            ctx.assert(proof.hasPreview && proof.hasPreviewFrame, "The live preview is not mounted beside the editor.");
            ctx.assert(proof.schemaVisible, "The data contract is not visible in the source editor.");
            ctx.assert(
              proof.revision === state.projectRevision,
              `The visible revision changed unexpectedly from ${state.projectRevision} to ${proof.revision}.`,
            );
          },
          screenshot: {
            name: "dynamic-artifact-data-contract-preview",
            requireText: ["data.schema.json", "Revision"],
            rejectText: ["Artifact unavailable", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 7 — reload, reopen, and reuse",
      run: async (ctx) => {
        await ctx.prove("Reloading preserves the pinned build and local state, and the project reopens from the Artifacts library", {
          voiceover: vo[6],
          action: async () => {
            await ctx.eval("location.reload()");
            await ctx.waitFor("Boolean(window.__openworkControl)", {
              timeoutMs: 60_000,
              label: "control API after reload",
            });
            await ctx.waitFor(
              `window.__openworkControl.snapshot().route === ${JSON.stringify(state.sessionRoute)}`,
              { timeoutMs: 60_000, label: "same session after reload" },
            );
            await waitForReadyAttachment(ctx);
            await ctx.waitFor(
              `(() => {
                const root = document.querySelector(${JSON.stringify(PROJECT_ROOT)});
                return root?.getAttribute("data-ui-artifact-project-revision") === ${JSON.stringify(state.projectRevision)} &&
                  root?.getAttribute("data-ui-artifact-state-revision") === ${JSON.stringify(state.stateRevision)} &&
                  root?.getAttribute("data-ui-artifact-state-summary") === "watching-apollo";
              })()`,
              { timeoutMs: 30_000, label: "pinned project and state restored after reload" },
            );
            await ctx.trustedClick('button[aria-label="UI Artifacts"]', {
              timeoutMs: 30_000,
            });
            await ctx.waitForText("Launch Radar", { timeoutMs: 30_000 });
            await ctx.clickText("Launch Radar", {
              selector: 'button, [role="button"]',
              timeoutMs: 30_000,
            });
            await ctx.waitFor(
              `(() => {
                const studio = document.querySelector(${JSON.stringify(STUDIO)});
                const revision = studio?.querySelector("[data-ui-artifact-project-revision]")
                  ?.getAttribute("data-ui-artifact-project-revision");
                return revision === ${JSON.stringify(state.projectRevision)};
              })()`,
              { timeoutMs: 30_000, label: "same artifact revision reopened from library" },
            );
          },
          assert: async () => {
            const attachment = await readAttachment(ctx);
            ctx.assert(
              attachment.projectRevision === state.projectRevision,
              "Reload changed the pinned project revision.",
            );
            ctx.assert(
              attachment.stateRevision === state.stateRevision &&
                attachment.stateSummary === "watching-apollo",
              "Reload did not restore the persisted local interaction state.",
            );
            await ctx.expectText("Launch Radar");
            await ctx.expectText("src/App.tsx");
          },
          screenshot: {
            name: "dynamic-artifact-persisted-reopened",
            requireText: ["Launch Radar", "src/App.tsx", "Revision"],
            rejectText: ["Artifact unavailable", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 8 — disable new builds without breaking pinned work",
      run: async (ctx) => {
        await ctx.prove("A project can be disabled from the library while its editor and immutable pinned preview remain available", {
          voiceover: vo[7],
          action: async () => {
            await ctx.trustedClick('button[aria-label="Back to generated projects"]', {
              timeoutMs: 30_000,
            });
            await ctx.waitForText("Artifact Builder skill", { timeoutMs: 30_000 });
            await ctx.waitFor(
              `Boolean(document.querySelector('[aria-label="Disable Launch Radar"]'))`,
              { timeoutMs: 30_000, label: "enabled Launch Radar project switch" },
            );
            await ctx.trustedClick('[aria-label="Disable Launch Radar"]', {
              timeoutMs: 30_000,
            });
            await ctx.waitFor(
              `Boolean(document.querySelector('[aria-label="Enable Launch Radar"]'))`,
              { timeoutMs: 30_000, label: "disabled Launch Radar project switch" },
            );
            await ctx.clickText("Launch Radar", {
              selector: 'button, [role="button"]',
              timeoutMs: 30_000,
            });
            await ctx.waitFor(
              `(() => {
                const studio = document.querySelector(${JSON.stringify(STUDIO)});
                const text = studio?.innerText ?? "";
                const rebuild = Array.from(studio?.querySelectorAll("button") ?? [])
                  .find((button) => button.textContent?.includes("Rebuild"));
                const preview = studio?.querySelector("[data-ui-artifact-studio-preview] iframe");
                return text.includes("Disabled · editing only") &&
                  rebuild?.disabled === true &&
                  Boolean(preview);
              })()`,
              { timeoutMs: 30_000, label: "disabled editable artifact with pinned preview" },
            );
          },
          assert: async () => {
            const lifecycle = await ctx.eval(`(() => {
              const studio = document.querySelector(${JSON.stringify(STUDIO)});
              const text = studio?.innerText ?? "";
              const rebuild = Array.from(studio?.querySelectorAll("button") ?? [])
                .find((button) => button.textContent?.includes("Rebuild"));
              return {
                disabled: text.includes("Disabled · editing only"),
                rebuildDisabled: rebuild?.disabled === true,
                previewPresent: Boolean(
                  studio?.querySelector("[data-ui-artifact-studio-preview] iframe")
                ),
                revision: studio?.querySelector("[data-ui-artifact-project-revision]")
                  ?.getAttribute("data-ui-artifact-project-revision") ?? null,
              };
            })()`);
            ctx.assert(lifecycle.disabled, "The project does not show its disabled lifecycle state.");
            ctx.assert(lifecycle.rebuildDisabled, "A disabled project still allows new builds.");
            ctx.assert(lifecycle.previewPresent, "Disabling the project removed its immutable preview.");
            ctx.assert(
              lifecycle.revision === state.projectRevision,
              "Disabling the project changed its pinned revision.",
            );
          },
          screenshot: {
            name: "dynamic-artifact-disabled-editable",
            requireText: ["Launch Radar", "Disabled", "Rebuild", "Live sandbox preview"],
            rejectText: ["Artifact unavailable", "Something went wrong"],
          },
        });
      },
    },
  ],
};
