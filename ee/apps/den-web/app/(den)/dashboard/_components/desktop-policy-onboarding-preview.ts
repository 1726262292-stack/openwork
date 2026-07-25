const ORGANIZATION_PROMPT_TITLES = ["Organization prompt 1", "Organization prompt 2", "Organization prompt 3"];

// Keep copied behavior in sync with apps/app/src/components/chat/task-suggestions.tsx
// resolveOrganizationPromptCardContent, which is the desktop member source of truth.
export function resolveOrganizationPromptPreviewCardContent(input: {
  prompt: string;
  description?: string;
  index: number;
}) {
  const title = input.description?.trim();
  return {
    title: title || ORGANIZATION_PROMPT_TITLES[input.index] || "Organization prompt",
    description: input.prompt,
    selectionPrompt: input.prompt,
  };
}
