import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiError } from "./errors.js";
import {
  compileWorkflowRunPrompt,
  createWorkflowRun,
  deleteWorkflow,
  listWorkflowRuns,
  listWorkflows,
  readWorkflow,
  slugifyWorkflowName,
  updateWorkflowRun,
  upsertWorkflow,
} from "./workflows.js";

const makeWorkspace = () => mkdtemp(join(tmpdir(), "openwork-workflows-"));

describe("workflows", () => {
  test("upsertWorkflow creates a workspace-relative JSON definition", async () => {
    const workspace = await makeWorkspace();

    const item = await upsertWorkflow(workspace, {
      name: "Release Notes",
      description: "Compile release notes from the changelog",
      inputs: ["docs/changelog.md", "@docs/style.md", "docs/changelog.md"],
      steps: [
        { name: "Summarize", prompt: "Summarize the changes." },
        { prompt: "Write the final release notes.", agent: "writer", model: "anthropic/claude" },
      ],
    });

    expect(item.slug).toBe("release-notes");
    expect(item.inputs).toEqual(["docs/changelog.md", "docs/style.md"]);
    expect(item.steps).toHaveLength(2);
    expect(item.steps[1]?.name).toBe("Step 2");
    expect(item.steps[1]?.agent).toBe("writer");
    expect(item.outputDir).toBe(".opencode/openwork/outbox/workflows/release-notes");

    const raw = await readFile(
      join(workspace, ".opencode", "openwork", "workflows", "release-notes.json"),
      "utf8",
    );
    expect(JSON.parse(raw).name).toBe("Release Notes");

    const items = await listWorkflows(workspace);
    expect(items).toHaveLength(1);
    expect(items[0]?.slug).toBe("release-notes");
  });

  test("upsertWorkflow preserves createdAt on update", async () => {
    const workspace = await makeWorkspace();
    const first = await upsertWorkflow(workspace, {
      name: "Digest",
      steps: [{ prompt: "Do the digest." }],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await upsertWorkflow(workspace, {
      name: "Digest",
      steps: [{ prompt: "Do the digest, but better." }],
    });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  test("upsertWorkflow rejects missing steps and escaping inputs", async () => {
    const workspace = await makeWorkspace();
    await expect(upsertWorkflow(workspace, { name: "Empty", steps: [] })).rejects.toThrow(ApiError);
    await expect(
      upsertWorkflow(workspace, { name: "Escape", inputs: ["../secrets.txt"], steps: [{ prompt: "x" }] }),
    ).rejects.toThrow(ApiError);
    await expect(
      upsertWorkflow(workspace, { name: "NoPrompt", steps: [{ prompt: "   " }] }),
    ).rejects.toThrow(ApiError);
  });

  test("upsertWorkflow rejects stale co-edit writes with workflow_conflict", async () => {
    const workspace = await makeWorkspace();
    const first = await upsertWorkflow(workspace, {
      name: "Shared Doc",
      steps: [{ prompt: "v1" }],
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    // Collaborator B saves after A opened the editor.
    await upsertWorkflow(workspace, {
      name: "Shared Doc",
      steps: [{ prompt: "v2 from collaborator" }],
      baseUpdatedAt: first.updatedAt,
    });

    // Collaborator A still holds the original updatedAt: write must be rejected.
    let conflict: ApiError | null = null;
    try {
      await upsertWorkflow(workspace, {
        name: "Shared Doc",
        steps: [{ prompt: "v2 from stale editor" }],
        baseUpdatedAt: first.updatedAt,
      });
    } catch (error) {
      conflict = error instanceof ApiError ? error : null;
    }
    expect(conflict?.status).toBe(409);
    expect(conflict?.code).toBe("workflow_conflict");

    // The collaborator's version is preserved.
    const current = await readWorkflow(workspace, "shared-doc");
    expect(current.steps[0]?.prompt).toBe("v2 from collaborator");

    // Saving without a base token (or with the fresh one) still works.
    const fresh = await upsertWorkflow(workspace, {
      name: "Shared Doc",
      steps: [{ prompt: "v3 merged" }],
      baseUpdatedAt: current.updatedAt,
    });
    expect(fresh.steps[0]?.prompt).toBe("v3 merged");
  });

  test("slugifyWorkflowName produces kebab-case", () => {
    expect(slugifyWorkflowName("Weekly Research Digest!")).toBe("weekly-research-digest");
    expect(slugifyWorkflowName("  --Already--Kebab--  ")).toBe("already-kebab");
  });

  test("deleteWorkflow removes the definition", async () => {
    const workspace = await makeWorkspace();
    await upsertWorkflow(workspace, { name: "Temp", steps: [{ prompt: "x" }] });
    await deleteWorkflow(workspace, "temp");
    expect(await listWorkflows(workspace)).toHaveLength(0);
    await expect(readWorkflow(workspace, "temp")).rejects.toThrow(ApiError);
  });

  test("compileWorkflowRunPrompt includes inputs, steps, and outputs", async () => {
    const workspace = await makeWorkspace();
    const workflow = await upsertWorkflow(workspace, {
      name: "Report",
      description: "Build the report",
      inputs: ["notes/a.md"],
      steps: [
        { name: "Outline", prompt: "Draft an outline." },
        { name: "Write", prompt: "Write the report." },
      ],
    });

    const prompt = compileWorkflowRunPrompt(workflow, "run-1");
    expect(prompt).toContain('workflow "Report"');
    expect(prompt).toContain("- notes/a.md");
    expect(prompt).toContain("### Step 1: Outline");
    expect(prompt).toContain("### Step 2: Write");
    expect(prompt).toContain(".opencode/openwork/outbox/workflows/report/run-1/");
    expect(prompt).toContain("run-summary.md");
  });

  test("run lifecycle: create, update, list", async () => {
    const workspace = await makeWorkspace();
    await upsertWorkflow(workspace, { name: "Pipeline", steps: [{ prompt: "Go." }] });

    const { run, prompt } = await createWorkflowRun(workspace, "pipeline");
    expect(run.status).toBe("pending");
    expect(run.workflowSlug).toBe("pipeline");
    expect(run.outputDir.startsWith(".opencode/openwork/outbox/workflows/pipeline/")).toBe(true);
    expect(prompt).toContain(run.outputDir);

    const updated = await updateWorkflowRun(workspace, run.id, {
      status: "running",
      sessionId: "ses_123",
    });
    expect(updated.status).toBe("running");
    expect(updated.sessionId).toBe("ses_123");

    const runs = await listWorkflowRuns(workspace, "pipeline");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe(run.id);
    expect(runs[0]?.status).toBe("running");

    const allRuns = await listWorkflowRuns(workspace);
    expect(allRuns).toHaveLength(1);

    await expect(updateWorkflowRun(workspace, "missing", { status: "failed" })).rejects.toThrow(ApiError);
  });

  test("createWorkflowRun fails for unknown workflow", async () => {
    const workspace = await makeWorkspace();
    await expect(createWorkflowRun(workspace, "ghost")).rejects.toThrow(ApiError);
  });
});
