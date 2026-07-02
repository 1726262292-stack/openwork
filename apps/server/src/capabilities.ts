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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReloadReason, ReloadTrigger, ServerConfig } from "./types.js";
import { ApiError } from "./errors.js";
import { exportExtensions, redactMcpConfig } from "./extensions-export.js";
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
