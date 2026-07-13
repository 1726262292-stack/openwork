import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { DenExternalMcpConnection, DenOrgSummary } from "../src/app/lib/den";
import type { DenOrgSkillCard } from "../src/app/types";
import {
  INACTIVE_ACCOUNT_CHECK_PROMPT,
  isMcpConnectionReady,
  resolveFirstWorkflow,
  resolveSuggestedPromptForSkill,
  shouldAutoSelectOnlyOrganization,
} from "../src/react-app/domains/cloud/org-onboarding-page";
import {
  consumePendingSessionPrompt,
  savePendingSessionPrompt,
} from "../src/react-app/domains/session/sync/draft-store";

const originalWindow = globalThis.window;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

const org: DenOrgSummary = {
  id: "org_1",
  name: "Acme Robotics",
  slug: "acme",
  role: "member",
};

const inactiveSkill: DenOrgSkillCard = {
  id: "skill_1",
  title: "Inactive Account Check",
  description: "Find employee accounts with no recent activity using the Employee Directory.",
  skillText: "Check for employee accounts inactive for 30 days.",
  shared: "org",
  updatedAt: null,
};

const employeeDirectoryConnection: DenExternalMcpConnection = {
  id: "conn_1",
  name: "Employee Directory",
  url: "https://directory.example.test/mcp",
  authType: "oauth",
  credentialMode: "shared",
  connected: true,
  connectedAt: null,
  connectedForMe: true,
};

describe("org onboarding helpers", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { sessionStorage: memoryStorage() },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  test("auto-selects exactly one organization but leaves multi-org users on the picker", () => {
    expect(shouldAutoSelectOnlyOrganization([org], false)).toEqual(org);
    expect(shouldAutoSelectOnlyOrganization([org], true)).toBeNull();
    expect(shouldAutoSelectOnlyOrganization([
      org,
      { ...org, id: "org_2", slug: "other", name: "Other Org" },
    ], false)).toBeNull();
  });

  test("uses the inactive-account suggested prompt for the exact skill", () => {
    expect(resolveSuggestedPromptForSkill(inactiveSkill)).toBe(INACTIVE_ACCOUNT_CHECK_PROMPT);
  });

  test("prefers explicit skill metadata prompts when present", () => {
    expect(resolveSuggestedPromptForSkill({
      title: "Quarterly Access Review",
      description: "Suggested prompt: Review access for contractors this quarter.",
      skillText: "",
    })).toBe("Review access for contractors this quarter.");
  });

  test("combines the featured org skill with its ready secure connection", () => {
    const workflow = resolveFirstWorkflow([inactiveSkill], [employeeDirectoryConnection]);
    expect(workflow?.skill.title).toBe("Inactive Account Check");
    expect(workflow?.connection?.name).toBe("Employee Directory");
    expect(workflow?.suggestedPrompt).toBe(INACTIVE_ACCOUNT_CHECK_PROMPT);
  });

  test("recognizes connection readiness", () => {
    expect(isMcpConnectionReady(employeeDirectoryConnection)).toBe(true);
    expect(isMcpConnectionReady({
      ...employeeDirectoryConnection,
      needsReconnect: true,
    })).toBe(false);
  });

  test("hands a first-task prompt to the next real composer mount once", () => {
    savePendingSessionPrompt(`  ${INACTIVE_ACCOUNT_CHECK_PROMPT}  `);

    expect(consumePendingSessionPrompt()).toBe(INACTIVE_ACCOUNT_CHECK_PROMPT);
    expect(consumePendingSessionPrompt()).toBeNull();
  });
});
