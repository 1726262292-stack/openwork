import { readdir, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { exists, readJsonFile, shortId } from "./utils.js";
import { projectWorkflowsDir, projectWorkflowRunsDir } from "./workspace-files.js";
import { ApiError } from "./errors.js";

/**
 * Workflows: repeatable, multi-step agent runs stored inside the workspace.
 *
 * A workflow is a JSON file under `.opencode/openwork/workflows/<slug>.json`:
 * it declares input files (context), an ordered list of prompt steps, and an
 * output folder under the workspace outbox. Because definitions live in the
 * workspace they are versioned with the project (git) and shared with anyone
 * connected to the same OpenWork server.
 *
 * A run materializes a workflow into a single compiled prompt executed by a
 * real OpenCode agent session. Each run gets a run-scoped output directory in
 * the workspace outbox so results surface as shareable artifacts.
 */

const WORKFLOW_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_STEPS = 25;
const MAX_INPUTS = 100;
const MAX_RUNS_LISTED = 100;

export type WorkflowStep = {
  name: string;
  prompt: string;
  agent?: string;
  model?: string;
};

export interface WorkflowItem {
  slug: string;
  name: string;
  description?: string;
  inputs: string[];
  steps: WorkflowStep[];
  outputDir: string;
  createdAt: number;
  updatedAt: number;
}

export type WorkflowRunStatus = "pending" | "running" | "completed" | "failed";

export interface WorkflowRunRecord {
  id: string;
  workflowSlug: string;
  workflowName: string;
  status: WorkflowRunStatus;
  sessionId?: string;
  outputDir: string;
  createdAt: number;
  updatedAt: number;
}

export type UpsertWorkflowPayload = {
  name: string;
  slug?: string;
  description?: string;
  inputs?: unknown[];
  steps: unknown;
  /**
   * Optimistic-concurrency token for co-editing: the `updatedAt` the editor
   * was opened with. When provided and the stored workflow has changed since,
   * the write is rejected with 409 `workflow_conflict` so a collaborator's
   * edits are never silently overwritten.
   */
  baseUpdatedAt?: number | null;
};

export function slugifyWorkflowName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function validateWorkflowSlug(slug: string): void {
  if (!slug || slug.length > 64 || !WORKFLOW_SLUG_REGEX.test(slug)) {
    throw new ApiError(400, "invalid_workflow_slug", "Workflow slug must be kebab-case (1-64 chars)");
  }
}

export function defaultWorkflowOutputDir(slug: string): string {
  return `.opencode/openwork/outbox/workflows/${slug}`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeInputPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^@+/, "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!trimmed) return null;
  if (trimmed.startsWith("/") || trimmed.includes("..")) {
    throw new ApiError(400, "invalid_workflow_input", `Workflow inputs must be workspace-relative paths: ${trimmed}`);
  }
  return trimmed;
}

function normalizeSteps(steps: unknown): WorkflowStep[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new ApiError(400, "invalid_workflow_steps", "Workflow requires at least one step");
  }
  if (steps.length > MAX_STEPS) {
    throw new ApiError(400, "invalid_workflow_steps", `Workflow supports at most ${MAX_STEPS} steps`);
  }
  return steps.map((raw, index) => {
    const step = readRecord(raw) ?? {};
    const prompt = typeof step.prompt === "string" ? step.prompt.trim() : "";
    if (!prompt) {
      throw new ApiError(400, "invalid_workflow_steps", `Step ${index + 1} requires a prompt`);
    }
    const name = typeof step.name === "string" && step.name.trim() ? step.name.trim() : `Step ${index + 1}`;
    const agent = typeof step.agent === "string" && step.agent.trim() ? step.agent.trim() : undefined;
    const model = typeof step.model === "string" && step.model.trim() ? step.model.trim() : undefined;
    return { name, prompt, ...(agent ? { agent } : {}), ...(model ? { model } : {}) };
  });
}

function readWorkflowRecord(value: unknown): WorkflowItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const slug = typeof record.slug === "string" ? record.slug.trim() : "";
  if (!slug || !WORKFLOW_SLUG_REGEX.test(slug)) return null;
  const rawSteps = Array.isArray(record.steps) ? record.steps : [];
  const steps: WorkflowStep[] = [];
  for (const raw of rawSteps) {
    if (!raw || typeof raw !== "object") continue;
    const step = raw as Record<string, unknown>;
    const prompt = typeof step.prompt === "string" ? step.prompt.trim() : "";
    if (!prompt) continue;
    steps.push({
      name: typeof step.name === "string" && step.name.trim() ? step.name.trim() : `Step ${steps.length + 1}`,
      prompt,
      ...(typeof step.agent === "string" && step.agent.trim() ? { agent: step.agent.trim() } : {}),
      ...(typeof step.model === "string" && step.model.trim() ? { model: step.model.trim() } : {}),
    });
  }
  if (steps.length === 0) return null;
  const inputs = Array.isArray(record.inputs)
    ? record.inputs.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return {
    slug,
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : slug,
    ...(typeof record.description === "string" && record.description.trim()
      ? { description: record.description.trim() }
      : {}),
    inputs,
    steps,
    outputDir:
      typeof record.outputDir === "string" && record.outputDir.trim()
        ? record.outputDir.trim()
        : defaultWorkflowOutputDir(slug),
    createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

function workflowPath(workspaceRoot: string, slug: string): string {
  return join(projectWorkflowsDir(workspaceRoot), `${slug}.json`);
}

function runPath(workspaceRoot: string, runId: string): string {
  return join(projectWorkflowRunsDir(workspaceRoot), `${runId}.json`);
}

export async function listWorkflows(workspaceRoot: string): Promise<WorkflowItem[]> {
  const dir = projectWorkflowsDir(workspaceRoot);
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const items: WorkflowItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const parsed = readWorkflowRecord(await readJsonFile<unknown>(join(dir, entry.name)));
    if (parsed) items.push(parsed);
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

export async function readWorkflow(workspaceRoot: string, slug: string): Promise<WorkflowItem> {
  validateWorkflowSlug(slug);
  const parsed = readWorkflowRecord(await readJsonFile<unknown>(workflowPath(workspaceRoot, slug)));
  if (!parsed) {
    throw new ApiError(404, "workflow_not_found", `Workflow not found: ${slug}`);
  }
  return parsed;
}

export async function upsertWorkflow(
  workspaceRoot: string,
  payload: UpsertWorkflowPayload,
): Promise<WorkflowItem> {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    throw new ApiError(400, "invalid_workflow_name", "Workflow name is required");
  }
  const slug = (payload.slug?.trim() || slugifyWorkflowName(name));
  validateWorkflowSlug(slug);

  const rawInputs = Array.isArray(payload.inputs) ? payload.inputs : [];
  if (rawInputs.length > MAX_INPUTS) {
    throw new ApiError(400, "invalid_workflow_input", `Workflow supports at most ${MAX_INPUTS} inputs`);
  }
  const inputs: string[] = [];
  for (const raw of rawInputs) {
    const normalized = normalizeInputPath(raw);
    if (normalized && !inputs.includes(normalized)) inputs.push(normalized);
  }

  const steps = normalizeSteps(payload.steps);
  const description = typeof payload.description === "string" && payload.description.trim()
    ? payload.description.trim()
    : undefined;

  const existing = readWorkflowRecord(await readJsonFile<unknown>(workflowPath(workspaceRoot, slug)));
  if (
    existing &&
    typeof payload.baseUpdatedAt === "number" &&
    existing.updatedAt > payload.baseUpdatedAt
  ) {
    throw new ApiError(
      409,
      "workflow_conflict",
      "This workflow was updated by someone else since you opened it",
      { slug, updatedAt: existing.updatedAt },
    );
  }
  const now = Date.now();
  const item: WorkflowItem = {
    slug,
    name,
    ...(description ? { description } : {}),
    inputs,
    steps,
    outputDir: defaultWorkflowOutputDir(slug),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await mkdir(projectWorkflowsDir(workspaceRoot), { recursive: true });
  await writeFile(workflowPath(workspaceRoot, slug), JSON.stringify(item, null, 2) + "\n", "utf8");
  return item;
}

export async function deleteWorkflow(workspaceRoot: string, slug: string): Promise<string> {
  validateWorkflowSlug(slug);
  const path = workflowPath(workspaceRoot, slug);
  await rm(path, { force: true });
  return path;
}

/**
 * Compile a workflow into a single agent prompt.
 *
 * The compiled prompt is the "build script" for a run: it lists context
 * inputs, the ordered steps, and where to write outputs so they show up as
 * workspace artifacts.
 */
export function compileWorkflowRunPrompt(workflow: WorkflowItem, runId: string): string {
  const outputDir = `${workflow.outputDir}/${runId}`;
  const lines: string[] = [];
  lines.push(`You are executing the workflow "${workflow.name}" (run ${runId}).`);
  if (workflow.description) {
    lines.push("", workflow.description.trim());
  }

  if (workflow.inputs.length > 0) {
    lines.push("", "## Context inputs", "", "Read these workspace files before starting:");
    for (const input of workflow.inputs) {
      lines.push(`- ${input}`);
    }
  }

  lines.push("", "## Steps", "", "Complete each step fully, in order, before moving to the next.");
  workflow.steps.forEach((step, index) => {
    lines.push("", `### Step ${index + 1}: ${step.name}`);
    if (step.agent || step.model) {
      const hints: string[] = [];
      if (step.agent) hints.push(`preferred agent: ${step.agent}`);
      if (step.model) hints.push(`preferred model: ${step.model}`);
      lines.push(`_(${hints.join(", ")})_`);
    }
    lines.push("", step.prompt.trim());
  });

  lines.push(
    "",
    "## Outputs",
    "",
    `Write every build artifact for this run into \`${outputDir}/\`.`,
    `- Save the result of each step as \`${outputDir}/step-<number>-<short-name>.md\` (or an appropriate file type).`,
    `- Finish by writing \`${outputDir}/run-summary.md\` describing what was produced, decisions made, and any follow-ups.`,
    "- Do not skip writing outputs: they are the compiled results of this workflow and will be shared.",
  );

  return lines.join("\n");
}

function readRunRecord(value: unknown): WorkflowRunRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const workflowSlug = typeof record.workflowSlug === "string" ? record.workflowSlug.trim() : "";
  if (!id || !workflowSlug) return null;
  const status = record.status;
  const normalizedStatus: WorkflowRunStatus =
    status === "running" || status === "completed" || status === "failed" ? status : "pending";
  return {
    id,
    workflowSlug,
    workflowName: typeof record.workflowName === "string" && record.workflowName.trim() ? record.workflowName.trim() : workflowSlug,
    status: normalizedStatus,
    ...(typeof record.sessionId === "string" && record.sessionId.trim() ? { sessionId: record.sessionId.trim() } : {}),
    outputDir: typeof record.outputDir === "string" && record.outputDir.trim() ? record.outputDir.trim() : "",
    createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

export async function createWorkflowRun(
  workspaceRoot: string,
  slug: string,
): Promise<{ run: WorkflowRunRecord; prompt: string }> {
  const workflow = await readWorkflow(workspaceRoot, slug);
  const now = Date.now();
  const run: WorkflowRunRecord = {
    id: shortId(),
    workflowSlug: workflow.slug,
    workflowName: workflow.name,
    status: "pending",
    outputDir: `${workflow.outputDir}/${shortRunLabel(now)}`,
    createdAt: now,
    updatedAt: now,
  };
  // The compiled prompt and the run record must agree on the output folder.
  const prompt = compileWorkflowRunPrompt({ ...workflow, outputDir: workflow.outputDir }, runLabelFromOutputDir(run.outputDir));
  await mkdir(projectWorkflowRunsDir(workspaceRoot), { recursive: true });
  await writeFile(runPath(workspaceRoot, run.id), JSON.stringify(run, null, 2) + "\n", "utf8");
  return { run, prompt };
}

function shortRunLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  const suffix = shortId().slice(0, 6);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${suffix}`;
}

function runLabelFromOutputDir(outputDir: string): string {
  const segments = outputDir.split("/");
  return segments[segments.length - 1] ?? outputDir;
}

export type UpdateWorkflowRunPayload = {
  status?: WorkflowRunStatus;
  sessionId?: string;
};

export async function updateWorkflowRun(
  workspaceRoot: string,
  runId: string,
  payload: UpdateWorkflowRunPayload,
): Promise<WorkflowRunRecord> {
  const id = runId.trim();
  if (!id) {
    throw new ApiError(400, "invalid_workflow_run", "Workflow run id is required");
  }
  const existing = readRunRecord(await readJsonFile<unknown>(runPath(workspaceRoot, id)));
  if (!existing) {
    throw new ApiError(404, "workflow_run_not_found", `Workflow run not found: ${id}`);
  }
  const status = payload.status;
  if (status !== undefined && status !== "pending" && status !== "running" && status !== "completed" && status !== "failed") {
    throw new ApiError(400, "invalid_workflow_run", "Invalid workflow run status");
  }
  const sessionId = typeof payload.sessionId === "string" && payload.sessionId.trim() ? payload.sessionId.trim() : undefined;
  const next: WorkflowRunRecord = {
    ...existing,
    ...(status ? { status } : {}),
    ...(sessionId ? { sessionId } : {}),
    updatedAt: Date.now(),
  };
  await writeFile(runPath(workspaceRoot, id), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export async function listWorkflowRuns(
  workspaceRoot: string,
  slug?: string,
): Promise<WorkflowRunRecord[]> {
  if (slug) validateWorkflowSlug(slug);
  const dir = projectWorkflowRunsDir(workspaceRoot);
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const items: WorkflowRunRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const parsed = readRunRecord(await readJsonFile<unknown>(join(dir, entry.name)));
    if (!parsed) continue;
    if (slug && parsed.workflowSlug !== slug) continue;
    items.push(parsed);
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  return items.slice(0, MAX_RUNS_LISTED);
}

export async function readWorkflowFileContent(workspaceRoot: string, slug: string): Promise<string> {
  validateWorkflowSlug(slug);
  const path = workflowPath(workspaceRoot, slug);
  if (!(await exists(path))) {
    throw new ApiError(404, "workflow_not_found", `Workflow not found: ${slug}`);
  }
  return readFile(path, "utf8");
}
