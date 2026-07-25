import { describe, expect, test } from "bun:test";
import { resolveOrganizationPromptPreviewCardContent } from "../app/(den)/dashboard/_components/desktop-policy-onboarding-preview";

describe("desktop policy onboarding prompt preview", () => {
  test("uses the admin description as the member card title", () => {
    const card = resolveOrganizationPromptPreviewCardContent({
      prompt: "Summarize the latest project notes.",
      description: "Project summary",
      index: 0,
    });

    expect(card.title).toBe("Project summary");
  });

  test("falls back to the numbered organization prompt title when description is blank", () => {
    const card = resolveOrganizationPromptPreviewCardContent({
      prompt: "Draft the follow-up message.",
      description: "  ",
      index: 1,
    });

    expect(card.title).toBe("Organization prompt 2");
  });

  test("uses the prompt text as the visible body", () => {
    const card = resolveOrganizationPromptPreviewCardContent({
      prompt: "Create a launch checklist.",
      index: 2,
    });

    expect(card.description).toBe("Create a launch checklist.");
  });
});
