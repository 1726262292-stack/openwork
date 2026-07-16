import { describe, expect, test } from "bun:test";

import { sessionIdForLegacyWorkspaceInference } from "../src/react-app/shell/workspace-routes";

describe("workspace route session inference", () => {
  test("modern workspace routes do not contribute a refresh session id", () => {
    expect(sessionIdForLegacyWorkspaceInference("workspace-a", "session-a")).toBeNull();
    expect(sessionIdForLegacyWorkspaceInference("workspace-a", "session-b")).toBeNull();
    expect(sessionIdForLegacyWorkspaceInference(" workspace-a ", " session-c ")).toBeNull();
  });

  test("legacy session routes contribute a trimmed refresh session id", () => {
    expect(sessionIdForLegacyWorkspaceInference(null, " session-a ")).toBe("session-a");
    expect(sessionIdForLegacyWorkspaceInference("", "session-b")).toBe("session-b");
    expect(sessionIdForLegacyWorkspaceInference("   ", "   ")).toBeNull();
  });
});
