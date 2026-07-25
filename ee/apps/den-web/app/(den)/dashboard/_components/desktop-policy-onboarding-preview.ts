import type { OnboardingPrompt, OnboardingPromptSkillReference } from "@openwork/types/den/desktop-policies";

const ORGANIZATION_PROMPT_TITLES = ["Organization prompt 1", "Organization prompt 2", "Organization prompt 3"];
const FIELD_SEPARATOR = "|";

function promptText(prompt: string | OnboardingPrompt) {
  return typeof prompt === "string" ? prompt : prompt.prompt;
}

function promptSkill(prompt: string | OnboardingPrompt) {
  return typeof prompt === "string" ? undefined : prompt.skill;
}

function encodeField(value: string) {
  return value.replaceAll("%", "%25").replaceAll("|", "%7C").replaceAll("]", "%5D");
}

function promptSkillToken(skill: OnboardingPromptSkillReference) {
  if (skill.source === "local") return `[skill ${skill.slug}]`;
  const fields = [skill.slug, skill.name, skill.marketplaceName, skill.capabilityName].map(encodeField);
  return `[connect-skill ${fields.join(FIELD_SEPARATOR)}]`;
}

function selectionPrompt(prompt: string | OnboardingPrompt) {
  const text = promptText(prompt);
  const skill = promptSkill(prompt);
  return skill ? `${promptSkillToken(skill)} ${text}` : text;
}

function skillLabel(skill: OnboardingPromptSkillReference) {
  return `/${skill.slug}`;
}

// Keep copied behavior in sync with apps/app/src/components/chat/task-suggestions.tsx
// resolveOrganizationPromptCardContent, which is the desktop member source of truth.
export function resolveOrganizationPromptPreviewCardContent(input: {
  prompt: string | OnboardingPrompt;
  description?: string;
  index: number;
}) {
  const prompt = promptText(input.prompt);
  const skill = promptSkill(input.prompt);
  const title = input.description?.trim();
  return {
    title: title || ORGANIZATION_PROMPT_TITLES[input.index] || "Organization prompt",
    description: prompt,
    selectionPrompt: selectionPrompt(input.prompt),
    skillLabel: skill ? skillLabel(skill) : undefined,
  };
}
