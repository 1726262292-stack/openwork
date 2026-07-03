/**
 * Search + Execute: the OpenWork capability pattern.
 *
 * Instead of shipping one bespoke agent tool per feature (each schema riding
 * in every request), OpenWork exposes two primitives — search and execute —
 * over an index of capability cards. A card binds an id, intent-level
 * description ("when to reach for this"), an args schema, an effects class,
 * and where it runs. The agent discovers capabilities by intent and invokes
 * them through one gateway, which is the single choke point for approvals,
 * scope checks, and audit.
 *
 * A capability executes wherever its data lives. This module holds the
 * server-origin registry (runtime-DB MCPs, workspace skills — things only
 * the OpenWork server can read). UI-origin and cloud-origin capabilities
 * federate into the same search surface in follow-ups.
 *
 * Effects contract enforced by the execute route in server.ts:
 * - "read"            -> no approval, viewer scope
 * - "write:workspace" -> writable server, collaborator scope, approval
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReloadReason, ReloadTrigger, ServerConfig } from "./types.js";
import { ApiError } from "./errors.js";
import { exportExtensions, redactMcpConfig, type ExportedMcp, type ExportedSkill } from "./extensions-export.js";
import { listMcp } from "./mcp.js";
import { listSkills, upsertSkill } from "./skills.js";

export type CapabilityEffects = "read" | "write:workspace";

export type CapabilityCard = {
  id: string;
  title: string;
  description: string;
  /** When the agent should reach for this — the search snippet is the teaching. */
  when: string;
  origin: "server";
  effects: CapabilityEffects;
  /** Documentation-grade JSON schema for execute args. */
  argsSchema: Record<string, unknown>;
  /** Composes-with hints: capability ids that typically follow this one. */
  related: string[];
};

export type CapabilityContext = {
  serverConfig: ServerConfig;
  workspaceId: string;
  workspaceRoot: string;
};

export type CapabilityApproval = {
  summary: string;
  paths: string[];
};

export type CapabilityReload = {
  reason: ReloadReason;
  detail: ReloadTrigger;
};

export type CapabilityResult = {
  output: unknown;
  reload?: CapabilityReload;
};

type CapabilityDefinition = CapabilityCard & {
  run(context: CapabilityContext, args: Record<string, unknown>): Promise<CapabilityResult>;
  approval?(context: CapabilityContext, args: Record<string, unknown>): CapabilityApproval;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

const DEFINITIONS: CapabilityDefinition[] = [
  {
    id: "skills.list",
    title: "List installed skills",
    description: "Lists every skill installed for this workspace (project and global), with name, description, and trigger.",
    when: "Use when the user asks what skills exist, or before exporting, sharing, or editing a skill by name.",
    origin: "server",
    effects: "read",
    argsSchema: {
      type: "object",
      properties: {
        includeGlobal: { type: "boolean", description: "Include user-global skills (default true)." },
      },
    },
    related: ["extensions.export", "skills.upsert"],
    async run(context, args) {
      const includeGlobal = args.includeGlobal !== false;
      const items = await listSkills(context.workspaceRoot, includeGlobal);
      return { output: { items } };
    },
  },
  {
    id: "skills.read",
    title: "Read a skill's full SKILL.md",
    description: "Returns the full markdown content of one installed skill by name.",
    when: "Use when you need the exact instructions inside a skill, e.g. before improving it or packaging it.",
    origin: "server",
    effects: "read",
    argsSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "Skill name as shown by skills.list." },
      },
    },
    related: ["skills.upsert", "extensions.export"],
    async run(context, args) {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) throw new ApiError(400, "invalid_args", "name is required");
      const items = await listSkills(context.workspaceRoot, true);
      const item = items.find((skill) => skill.name === name);
      if (!item) throw new ApiError(404, "skill_not_found", `Skill not found: ${name}`);
      const content = await readFile(item.path, "utf8");
      return { output: { item, content } };
    },
  },
  {
    id: "mcp.list",
    title: "List connected MCP servers (secrets redacted)",
    description: "Lists every MCP server configured for this workspace — including OpenWork-managed runtime MCPs that are not visible as files. Secret header/environment/OAuth values are redacted.",
    when: "Use when the user asks what connections or MCPs exist, or to find an MCP's name before exporting or sharing it.",
    origin: "server",
    effects: "read",
    argsSchema: { type: "object", properties: {} },
    related: ["extensions.export"],
    async run(context) {
      const items = await listMcp(context.serverConfig, context.workspaceId, context.workspaceRoot);
      const redacted = items.map((item) => {
        const { config, redactedKeys } = redactMcpConfig(item.config);
        return { ...item, config, redactedKeys };
      });
      return { output: { items: redacted } };
    },
  },
  {
    id: "extensions.export",
    title: "Export skills and MCPs as a portable bundle",
    description: "Returns portable definitions of installed skills (full SKILL.md) and MCP servers — including OpenWork-managed runtime MCPs. Secret values (headers, environment, OAuth secrets) are always redacted and listed in redactedKeys.",
    when: "Use when packaging skills or MCP connections into a plugin, publishing to a marketplace, or moving them to another machine. Declare redacted keys as required inputs; never inline secret values.",
    origin: "server",
    effects: "read",
    argsSchema: {
      type: "object",
      properties: {
        skills: { type: "array", items: { type: "string" }, description: "Skill names to export." },
        mcps: { type: "array", items: { type: "string" }, description: "MCP server names to export." },
      },
    },
    related: ["skills.list", "mcp.list"],
    async run(context, args) {
      const skills = stringList(args.skills);
      const mcps = stringList(args.mcps);
      if (skills.length === 0 && mcps.length === 0) {
        throw new ApiError(400, "invalid_args", "At least one skill or mcp name is required");
      }
      const result = await exportExtensions({
        serverConfig: context.serverConfig,
        workspaceId: context.workspaceId,
        workspaceRoot: context.workspaceRoot,
        skills,
        mcps,
      });
      return { output: result };
    },
  },
  {
    id: "skills.upsert",
    title: "Create or update a skill",
    description: "Writes a skill's SKILL.md into the workspace (.opencode/skills/<name>/SKILL.md). Creates the skill when missing, updates it otherwise.",
    when: "Use when the user asks to save repeatable work as a skill, or to edit an existing skill's instructions.",
    origin: "server",
    effects: "write:workspace",
    argsSchema: {
      type: "object",
      required: ["name", "content"],
      properties: {
        name: { type: "string", description: "Kebab-case skill name." },
        content: { type: "string", description: "Full SKILL.md content (frontmatter optional; name/description are normalized)." },
        description: { type: "string", description: "Skill description when the content has no frontmatter." },
      },
    },
    related: ["skills.read", "extensions.export"],
    approval(context, args) {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      return {
        summary: `Upsert skill ${name}`,
        paths: [join(context.workspaceRoot, ".opencode", "skills", name, "SKILL.md")],
      };
    },
    async run(context, args) {
      const name = typeof args.name === "string" ? args.name : "";
      const content = typeof args.content === "string" ? args.content : "";
      const description = typeof args.description === "string" ? args.description : undefined;
      const result = await upsertSkill(context.workspaceRoot, { name, content, description });
      return {
        output: { name, ...result },
        reload: { reason: "skills", detail: { type: "skill", name, action: result.action, path: result.path } },
      };
    },
  },
];

const REDACTED_VALUE = "<redacted>";

type SharePlanStep = {
  note: string;
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  /** Reuse an existing resource instead of creating a duplicate. */
  findOrCreate?: { matchField: string; matchValue: string };
};

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "shared-plugin";
}

/**
 * Build the publish-ready MCP payload from a REDACTED export: every redacted
 * value is dropped (never published, even as a placeholder) and reported as
 * a required input the installer must provide — or, for OAuth, obtain by
 * signing in as themselves.
 */
function publishableMcpConfig(mcp: ExportedMcp): { config: Record<string, unknown>; requiredInputs: string[] } {
  const requiredInputs = [...mcp.redactedKeys];
  const source = mcp.config;
  const config: Record<string, unknown> = {};
  if (typeof source.url === "string") {
    config.type = "remote";
    config.url = source.url;
  } else {
    config.type = "local";
    if (Array.isArray(source.command)) config.command = source.command;
  }
  const oauth = source.oauth;
  if (oauth && typeof oauth === "object" && !Array.isArray(oauth)) {
    const kept = Object.fromEntries(Object.entries(oauth).filter(([, value]) => value !== REDACTED_VALUE));
    config.oauth = kept;
  } else if (oauth !== undefined) {
    config.oauth = oauth;
  }
  return { config, requiredInputs };
}

function buildSharePlan(input: {
  marketplace: string;
  pluginName: string;
  description: string;
  skills: ExportedSkill[];
  mcps: ExportedMcp[];
}): { steps: SharePlanStep[]; requiredInputs: string[]; planFingerprint: string } {
  const steps: SharePlanStep[] = [];
  const requiredInputs: string[] = [];

  steps.push({
    note: `Find the marketplace named ${JSON.stringify(input.marketplace)}; reuse its id as {marketplaceId} if it exists.`,
    method: "GET",
    path: "/v1/marketplaces?status=active&limit=100",
    findOrCreate: { matchField: "name", matchValue: input.marketplace },
  });
  steps.push({
    note: "Create the marketplace only when the lookup found none; then grant org-wide viewer access so members can see it.",
    method: "POST",
    path: "/v1/marketplaces",
    body: { name: input.marketplace },
  });
  steps.push({
    note: "Org-wide viewer grant on the marketplace (only needed when it was just created).",
    method: "POST",
    path: "/v1/marketplaces/{marketplaceId}/access",
    body: { orgWide: true, role: "viewer" },
  });
  steps.push({
    note: "Create the plugin; use the returned id as {pluginId}.",
    method: "POST",
    path: "/v1/plugins",
    body: { name: input.pluginName, description: input.description },
  });
  steps.push({
    note: "Org-wide viewer grant on the plugin.",
    method: "POST",
    path: "/v1/plugins/{pluginId}/access",
    body: { orgWide: true, role: "viewer" },
  });

  for (const skill of input.skills) {
    steps.push({
      note: `Skill config object for ${skill.name} (exported SKILL.md verbatim).`,
      method: "POST",
      path: "/v1/config-objects",
      body: {
        type: "skill",
        sourceMode: "cloud",
        pluginIds: ["{pluginId}"],
        input: {
          rawSourceText: skill.content,
          metadata: { name: skill.name, description: skill.description },
        },
      },
    });
  }

  for (const mcp of input.mcps) {
    const publishable = publishableMcpConfig(mcp);
    requiredInputs.push(...publishable.requiredInputs);
    steps.push({
      note: `MCP config object for ${mcp.name}. Secret values were removed at the source; installers provide required inputs or sign in as themselves.`,
      method: "POST",
      path: "/v1/config-objects",
      body: {
        type: "mcp",
        sourceMode: "cloud",
        pluginIds: ["{pluginId}"],
        input: {
          normalizedPayloadJson: { mcpServers: { [mcp.name]: publishable.config } },
          metadata: { name: mcp.name, description: `Shared MCP connection ${mcp.name}` },
        },
      },
    });
  }

  steps.push({
    note: "Org-wide viewer grant on each created config object ({configObjectId} per creation response).",
    method: "POST",
    path: "/v1/config-objects/{configObjectId}/access",
    body: { orgWide: true, role: "viewer" },
  });
  steps.push({
    note: "Publish the plugin into the marketplace.",
    method: "POST",
    path: "/v1/marketplaces/{marketplaceId}/plugins",
    body: { pluginId: "{pluginId}" },
  });

  const planFingerprint = createHash("sha256").update(JSON.stringify(steps)).digest("hex").slice(0, 16);
  return { steps, requiredInputs, planFingerprint };
}

const SHARE_PLAN_DEFINITION: CapabilityDefinition = {
  id: "marketplace.share_plan",
  title: "Plan sharing skills + MCPs to a marketplace",
  description: "Compiles a complete, secret-free publish plan: exports the requested skills and MCP connections (secrets removed at the source), wraps them as one plugin, and emits the exact ordered cloud requests (find-or-create marketplace, grants, config objects, publish) plus a plan fingerprint. Nothing is written by this capability.",
  when: "Use when the user wants to share, publish, or distribute skills or MCP connections to their team or a marketplace. Execute this first, show the user the plan summary, then run the plan's steps with your OpenWork Cloud access after they approve.",
  origin: "server",
  effects: "read",
  argsSchema: {
    type: "object",
    required: ["marketplace"],
    properties: {
      skills: { type: "array", items: { type: "string" }, description: "Skill names to include." },
      mcps: { type: "array", items: { type: "string" }, description: "MCP server names to include." },
      marketplace: { type: "string", description: "Target marketplace name, e.g. 'BY IT Marketplace'. Reused when it already exists." },
      pluginName: { type: "string", description: "Plugin name; derived from the first component when omitted." },
    },
  },
  related: ["extensions.export", "skills.list", "mcp.list"],
  async run(context, args) {
    const skills = stringList(args.skills);
    const mcps = stringList(args.mcps);
    const marketplace = typeof args.marketplace === "string" ? args.marketplace.trim() : "";
    if (!marketplace) throw new ApiError(400, "invalid_args", "marketplace is required");
    if (skills.length === 0 && mcps.length === 0) {
      throw new ApiError(400, "invalid_args", "At least one skill or mcp name is required");
    }
    const exported = await exportExtensions({
      serverConfig: context.serverConfig,
      workspaceId: context.workspaceId,
      workspaceRoot: context.workspaceRoot,
      skills,
      mcps,
    });
    if (exported.missing.skills.length > 0 || exported.missing.mcps.length > 0) {
      throw new ApiError(
        404,
        "components_not_found",
        `Not installed — skills: [${exported.missing.skills.join(", ")}], mcps: [${exported.missing.mcps.join(", ")}]`,
      );
    }
    const exportedSkills = exported.components.filter((item): item is ExportedSkill => item.kind === "skill");
    const exportedMcps = exported.components.filter((item): item is ExportedMcp => item.kind === "mcp");
    const firstName = exportedSkills.at(0)?.name ?? exportedMcps.at(0)?.name ?? "shared";
    const pluginName = typeof args.pluginName === "string" && args.pluginName.trim()
      ? args.pluginName.trim()
      : firstName.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    const description = exportedSkills.at(0)?.description ?? `Shared bundle: ${slugify(pluginName)}`;
    const plan = buildSharePlan({ marketplace, pluginName, description, skills: exportedSkills, mcps: exportedMcps });
    return {
      output: {
        plan: {
          pluginName,
          marketplace,
          components: {
            skills: exportedSkills.map((item) => item.name),
            mcps: exportedMcps.map((item) => item.name),
          },
          secretsExcluded: plan.requiredInputs,
          installerNote: "Secret values never leave this machine. Installers provide the listed required inputs or sign in to OAuth connections as themselves.",
          steps: plan.steps,
          stepCount: plan.steps.length,
          planFingerprint: plan.planFingerprint,
        },
      },
    };
  },
};

DEFINITIONS.push(SHARE_PLAN_DEFINITION);

const definitionById = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));

function toCard(definition: CapabilityDefinition): CapabilityCard {
  const { id, title, description, when, origin, effects, argsSchema, related } = definition;
  return { id, title, description, when, origin, effects, argsSchema, related };
}

export function listCapabilities(): CapabilityCard[] {
  return DEFINITIONS.map(toCard);
}

function scoreCapability(definition: CapabilityDefinition, terms: string[]): number {
  const id = definition.id.toLowerCase();
  const title = definition.title.toLowerCase();
  const description = definition.description.toLowerCase();
  const when = definition.when.toLowerCase();
  return terms.reduce((score, term) => {
    if (id.includes(term)) score += 8;
    if (title.includes(term)) score += 6;
    if (when.includes(term)) score += 4;
    if (description.includes(term)) score += 2;
    return score;
  }, 0);
}

/**
 * Intent-based capability search. An empty query lists everything so the
 * agent can browse; otherwise cards are ranked by term matches across
 * id/title/when/description.
 */
export function searchCapabilities(query: string, limit = 8): CapabilityCard[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return listCapabilities().slice(0, limit);
  return DEFINITIONS
    .map((definition) => ({ definition, score: scoreCapability(definition, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.definition.id.localeCompare(right.definition.id))
    .slice(0, limit)
    .map((entry) => toCard(entry.definition));
}

export function getCapability(id: string): (CapabilityCard & {
  run(context: CapabilityContext, args: Record<string, unknown>): Promise<CapabilityResult>;
  approval?(context: CapabilityContext, args: Record<string, unknown>): CapabilityApproval;
}) | null {
  return definitionById.get(id) ?? null;
}

export function readExecuteArgs(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
