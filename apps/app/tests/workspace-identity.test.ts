import { describe, expect, test } from "bun:test";

import {
  WORKSPACE_IDENTITY_PALETTE,
  workspaceIdentityColor,
  workspaceIdentityIndex,
} from "../src/react-app/design-system/workspace-identity";

describe("workspace identity colors", () => {
  test("uses the approved palette exactly", () => {
    expect([...WORKSPACE_IDENTITY_PALETTE]).toEqual([
      "#499D81",
      "#3F7F96",
      "#4F6FAE",
      "#685DA8",
      "#855AA0",
      "#A25482",
      "#B65365",
      "#B9634D",
      "#B57935",
      "#96833B",
      "#708541",
      "#4F8557",
      "#556F82",
      "#8A6255",
    ]);
  });

  test("assigns the same workspace id to the same palette entry", () => {
    expect(workspaceIdentityColor("workspace_alpha")).toBe(workspaceIdentityColor("workspace_alpha"));
    expect(workspaceIdentityIndex("workspace_alpha")).toBe(workspaceIdentityIndex("workspace_alpha"));
    expect(workspaceIdentityColor("workspace_alpha")).toBe("#8A6255");
  });

  test("spreads common workspace ids across different colors", () => {
    const colors = [
      "workspace_alpha",
      "workspace_beta",
      "workspace_gamma",
      "workspace_delta",
      "workspace_epsilon",
      "workspace_zeta",
    ].map((workspaceId) => workspaceIdentityColor(workspaceId));

    expect(new Set(colors).size).toBeGreaterThan(3);
    expect(workspaceIdentityColor("workspace_alpha")).not.toBe(workspaceIdentityColor("workspace_beta"));
  });
});
