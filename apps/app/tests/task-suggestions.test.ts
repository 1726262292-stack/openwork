import { describe, expect, test } from "bun:test";

import { resolveOrganizationPromptCardContent } from "../src/components/chat/task-suggestions";
import type { OnboardingPromptConnectSkillReference } from "@openwork/types/den/desktop-policies";

const connectSkill: OnboardingPromptConnectSkillReference = {
  source: "connect",
  slug: "attention-review",
  name: "Attention Review",
  marketplaceId: "marketplace_attention",
  marketplaceName: "Workflow Library",
  pluginId: "plugin_attention",
  pluginName: "Attention Workflows",
  configObjectId: "skill_attention_review",
  capabilityName: "plugin:plugin_attention:skill_attention_review",
};

describe("organization task suggestions", () => {
  test("uses the saved description as the card title and selects the full prompt", () => {
    const prompt = "Analyze the latest project notes and summarize the top three risks.";

    expect(resolveOrganizationPromptCardContent({
      prompt,
      description: "Review project notes",
      index: 0,
    })).toEqual({
      title: "Review project notes",
      description: prompt,
      selectionPrompt: prompt,
      skill: undefined,
      skillLabel: undefined,
      readiness: "ready",
      readinessLabel: undefined,
      action: "fill",
    });
  });

  test("keeps a prompt-only fallback title for older policy data", () => {
    expect(resolveOrganizationPromptCardContent({
      prompt: "Draft a status update.",
      index: 1,
    }).title).toBe("Organization prompt 2");
  });

  test("adds the bound skill token when a skill-backed card fills the composer", () => {
    const prompt = "Find what needs attention today.";

    expect(resolveOrganizationPromptCardContent({
      prompt: { prompt, skill: connectSkill },
      description: "Find attention items",
      index: 0,
      readiness: "ready",
    })).toMatchObject({
      action: "fill",
      readinessLabel: "Ready to use",
      selectionPrompt: `[connect-skill attention-review|Attention Review|Workflow Library|plugin:plugin_attention:skill_attention_review] ${prompt}`,
      skillLabel: "/attention-review",
    });
  });

  test("maps readiness states to the card affordance", () => {
    const prompt = { prompt: "Find what needs attention today.", skill: connectSkill };

    expect(resolveOrganizationPromptCardContent({ prompt, index: 0, readiness: "ready" }).action).toBe("fill");
    expect(resolveOrganizationPromptCardContent({ prompt, index: 0, readiness: "needs_signin" })).toMatchObject({
      action: "open_connect",
      readinessLabel: "Needs your sign-in",
    });
    expect(resolveOrganizationPromptCardContent({ prompt, index: 0, readiness: "needs_admin_setup" })).toMatchObject({
      action: "blocked",
      readinessLabel: "Needs admin setup",
    });
  });

  test("leaves unbound cards as composer-fill only", () => {
    const prompt = "Summarize today's notes.";
    expect(resolveOrganizationPromptCardContent({ prompt, index: 0 })).toMatchObject({
      action: "fill",
      selectionPrompt: prompt,
    });
  });
});
