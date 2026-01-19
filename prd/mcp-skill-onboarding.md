# PRD: Notion MCP Demo + Skill-Guided Workflow

## Summary
We need a demo-ready flow that connects Notion via MCP and then makes it usable for
non-technical users by pairing the MCP with a curated skill. The demo should reuse
existing OpenWork surfaces (skills install, config writes, engine reload) and only add
the minimum new pieces required for a clean Notion story.

## Motivation
- MCPs are powerful but their tool surfaces are unclear to most users.
- Skills are the UX bridge that make MCPs approachable and repeatable.
- The demo must map to OpenCode primitives (opencode.json, skills) and stay mobile-first.

## Goals
- Demo Notion MCP connection using the existing workspace config flow (`opencode.json`).
- Use the existing Skills UI to install a curated "Manage CRM in Notion" skill.
- Ensure engine reload is triggered so MCP tools + skills are live.
- Provide a "setup my CRM" prompt that clearly uses the Notion MCP + skill.

## Non-Goals
- Building a custom MCP protocol or bespoke auth flow.
- Auto-generating skills from MCP schemas.
- Bypassing OpenCode config/permissions or inventing new storage.

## User Story
As a non-technical user, I want to connect Notion and then run a "Manage CRM" workflow
without having to understand MCP tools or write prompts from scratch.

## Existing Building Blocks (from code)
- Skills UI supports:
  - Install via OpenPackage (`opkg install`) into `.opencode/skill`.
  - Import local skill folders into `.opencode/skill/<name>`.
  - Curated package list with search + install.
- Skills are discovered by listing `.opencode/skill/*` and reading `SKILL.md`.
- Engine reload banner exists and is triggered by skill/plugin changes.
- OpenCode config read/write is already used for plugins in `opencode.json`.
- Provider list is fetched from OpenCode (`client.provider.list()` or `client.config.providers()`).

## Demo Scope
- Add a Notion MCP entry to `opencode.json` in the workspace (project scope).
- Trigger engine reload after MCP config write.
- Add a curated skill entry ("manage-crm-notion") so it can be installed from Skills.
- Use the existing reload banner to guide the user after install.

## User Flow
1. User navigates to MCPs (or settings) and selects Notion.
2. User completes OAuth flow.
3. OpenWork writes an MCP entry into workspace `opencode.json`.
4. OpenWork marks "Reload required" and the user reloads the engine.
5. User opens Skills and searches for "Manage CRM in Notion".
6. User clicks "Install" (OpenPackage or curated source).
7. Skill is written to `.opencode/skill/manage-crm-notion/SKILL.md`.
8. OpenWork marks "Reload required" and the user reloads the engine.
9. User types "setup my crm" and the skill guides Notion actions.

## UX Requirements
- Clear, non-technical copy that explains what MCPs and Skills do.
- Always show status for OAuth, config writes, and engine reload.
- Use the existing reload banner and prevent reload during active runs.
- Mobile-first touch targets and clear progress states.

## Technical Requirements
### MCP Install (Demo)
- Use existing `opencode.json` read/write utilities (project scope).
- Add/merge a `mcp` entry for Notion without breaking existing config.
- Mark reload required so the reload banner is shown.

### Skill Install
- Skills live in `.opencode/skill/<name>/SKILL.md` (current OpenWork path).
- Skill name must be kebab-case and match the folder name.
- Install can be via OpenPackage or curated local source.
- Mark reload required after install.

### Engine Reload
- Use existing "Reload required" banner copy and behavior.
- Reload is only available in Host mode and must be blocked during active runs.

## Data and Artifacts
- `opencode.json` updated with Notion MCP config.
- `.opencode/skill/manage-crm-notion/SKILL.md` created on install.
- Audit log records: OAuth completion, config write, skill install, reloads.

## Permissions and Safety
- Follow least-privilege principles for OAuth scopes.
- Ensure users understand what access they are granting.
- Avoid automatic re-use across workspaces without explicit user action.

## Edge Cases
- OAuth completes but config write fails.
- Config write succeeds but engine reload fails.
- Skill install fails (OpenPackage error or filesystem permissions).
- User removes MCP or skill but doesn’t reload.

## Success Metrics
- % of users who complete Notion OAuth without abandoning.
- Time from "Add MCP" to first successful Notion action.
- % of users who install the Notion CRM skill after MCP setup.
- Reduction in failed Notion prompts after skill install.

## Open Questions
- What is the minimal Notion OAuth scope for the CRM demo?
- Should MCP reload be automatic or user-initiated?
- Where should curated Notion skill live (OpenPackage vs local curated list)?
