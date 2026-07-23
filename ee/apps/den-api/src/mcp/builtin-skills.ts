import type { RemoteSkillDescriptor } from "./marketplace-capabilities.js"
import { scoreText, tokenize, type CapabilityMatch } from "./search.js"

export type BuiltinSkillDefinition = {
  descriptor: RemoteSkillDescriptor
  source: string
  searchExtraTokens: string
}

export const BUILTIN_CREATE_SKILL_CAPABILITY = "skill:create-skill"
export const BUILTIN_ADD_TO_MARKETPLACE_CAPABILITY = "skill:add-to-marketplace"
export const BUILTIN_ADD_USER_TO_MARKETPLACE_CAPABILITY = "skill:add-user-to-marketplace"

const CREATE_SKILL_SOURCE = `---
name: create-skill
description: |
  Create a new OpenWork Cloud skill as a plugin with one skill component.

  Triggers when user mentions:
  - "create a skill"
  - "make a skill"
  - "new skill"
---

# Create Skill

Create exactly one new Cloud skill. Do not publish it to a marketplace and do not grant org-wide access in this flow.

## Required skill format

Produce one complete \`SKILL.md\` with:

- opening and closing \`---\` frontmatter delimiters
- lowercase kebab-case \`name\` matching the intended skill name
- non-empty trigger-oriented \`description\`
- non-empty Markdown instruction body
- no secrets

## Workflow

1. Search OpenWork Cloud with 2-4 keyword variants for plugin create and any existing skill with the same name. Use only exact capability names returned by search.
2. If an exact skill already exists, stop and ask whether to update it instead. Do not create a duplicate.
3. Draft the complete \`SKILL.md\`.
4. Execute the plugin-create capability with:
   - a clear plugin \`name\` (usually the skill title)
   - one component: \`{"type":"skill","input":{"rawSourceText":"<complete SKILL.md>"}}\`
   - no \`marketplaceId\`
   - no \`orgWide\`
5. Read back the created plugin detail. Report plugin id, skill/config-object id, and that it is private to the creator until published or shared.
6. On authorization or validation errors, report them. Do not fall back to a workspace-local skill unless the user explicitly asks for one.
`

const ADD_TO_MARKETPLACE_SOURCE = `---
name: add-to-marketplace
description: |
  Add an existing Cloud plugin (or the plugin that owns a skill) to a marketplace.

  Triggers when user mentions:
  - "add this to marketplace"
  - "publish to marketplace"
  - "put this skill on the marketplace"
---

# Add To Marketplace

Attach one existing plugin to one marketplace. Do not create a new skill or plugin in this flow.

## Interpret the target

Treat "this" / "this skill" / "this plugin" as:

1. the plugin or skill just created in the conversation, otherwise
2. the plugin/skill the user names, otherwise
3. ask which plugin and marketplace to use

A skill always lives inside a plugin. Marketplace membership is on the plugin id.

## Workflow

1. Search OpenWork Cloud for marketplaces, the target plugin, and the add-marketplace-plugin capability. Use only exact names returned by search.
2. Confirm the marketplace and plugin with the user when more than one match exists.
3. Execute the add-marketplace-plugin capability with \`marketplaceId\` in path and \`{"pluginId":"<plugin id>"}\` in body.
4. Read back the marketplace detail and confirm the plugin is listed.
5. Stop. Do not grant user access unless the user asks for that separately.
`

const ADD_USER_TO_MARKETPLACE_SOURCE = `---
name: add-user-to-marketplace
description: |
  Grant a person access to a marketplace.

  Triggers when user mentions:
  - "add this user to the marketplace"
  - "give them marketplace access"
  - "share the marketplace with"
---

# Add User To Marketplace

Grant marketplace access to one member. Do not create plugins or attach plugins in this flow.

## Interpret the target

Treat "this user" / "them" as:

1. the person just named in the conversation, otherwise
2. the person the user identifies by name/email, otherwise
3. ask who to grant and which marketplace

## Workflow

1. Search OpenWork Cloud for organization members, marketplaces, and marketplace access-grant create. Use only exact capability names returned by search.
2. Resolve the member's \`orgMembershipId\` and the target \`marketplaceId\`. Ask when ambiguous.
3. Execute the marketplace access-grant capability with \`marketplaceId\` in path and body:
   \`{"orgMembershipId":"<member id>","role":"viewer"}\`
   Use \`manager\` only when the user explicitly asks for manage access.
4. Read back marketplace access grants and confirm the member is listed.
5. Stop. Do not change plugin membership unless asked.
`

export const BUILTIN_SKILLS: BuiltinSkillDefinition[] = [
  {
    descriptor: {
      name: "create-skill",
      title: "Create Skill",
      description: "Create a new OpenWork Cloud skill as a private plugin with one skill component.",
      capability: BUILTIN_CREATE_SKILL_CAPABILITY,
      location: "skill://create-skill/SKILL.md",
    },
    source: CREATE_SKILL_SOURCE,
    searchExtraTokens: "create make new author authoring build skill skills SKILL.md plugin",
  },
  {
    descriptor: {
      name: "add-to-marketplace",
      title: "Add To Marketplace",
      description: "Add an existing Cloud plugin or skill's plugin to a marketplace.",
      capability: BUILTIN_ADD_TO_MARKETPLACE_CAPABILITY,
      location: "skill://add-to-marketplace/SKILL.md",
    },
    source: ADD_TO_MARKETPLACE_SOURCE,
    searchExtraTokens: "add publish attach marketplace marketplaces plugin skill",
  },
  {
    descriptor: {
      name: "add-user-to-marketplace",
      title: "Add User To Marketplace",
      description: "Grant a member access to a marketplace.",
      capability: BUILTIN_ADD_USER_TO_MARKETPLACE_CAPABILITY,
      location: "skill://add-user-to-marketplace/SKILL.md",
    },
    source: ADD_USER_TO_MARKETPLACE_SOURCE,
    searchExtraTokens: "add grant share user member access marketplace marketplaces",
  },
]

export const BUILTIN_SKILL_DESCRIPTORS: RemoteSkillDescriptor[] = BUILTIN_SKILLS.map((skill) => skill.descriptor)

export type BuiltinSkillCapabilityMatch = CapabilityMatch & {
  kind: "skill"
}

export type BuiltinSkillExecutePayload = {
  kind: "skill"
  name: string
  description: string
  provenance: string
  content: string
}

function findBuiltinSkill(capability: string): BuiltinSkillDefinition | undefined {
  return BUILTIN_SKILLS.find((skill) => skill.descriptor.capability === capability)
}

export function listBuiltinSkillDescriptors(): RemoteSkillDescriptor[] {
  return BUILTIN_SKILL_DESCRIPTORS
}

export function searchBuiltinSkillCapabilities(query: string, limit = 5): BuiltinSkillCapabilityMatch[] {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []

  const matches: BuiltinSkillCapabilityMatch[] = []
  for (const skill of BUILTIN_SKILLS) {
    const score = scoreText(
      tokenize(`${skill.descriptor.name} ${skill.descriptor.title}`),
      tokenize(skill.descriptor.description),
      queryTokens,
      tokenize(skill.searchExtraTokens),
    )
    if (score <= 0) continue
    matches.push({
      name: skill.descriptor.capability,
      method: "SKILL",
      path: skill.descriptor.location,
      score,
      summary: skill.descriptor.description,
      pathParams: [],
      queryParams: [],
      hasBody: false,
      kind: "skill",
    })
  }

  return matches
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(20, Math.trunc(limit) || 5)))
}

export function executeBuiltinSkillCapability(name: string): BuiltinSkillExecutePayload | null {
  const skill = findBuiltinSkill(name)
  if (!skill) return null
  return {
    kind: "skill",
    name: skill.descriptor.title,
    description: skill.descriptor.description,
    provenance: "Built into OpenWork Cloud.",
    content: skill.source,
  }
}
