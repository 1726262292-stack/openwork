declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
};

import { getEffectiveWorkspaceLeftSidebarWidth } from "./workspace-shell-layout";

describe("workspace shell sidebar width", () => {
  test("uses the preferred width when the viewport has room", () => {
    expect(getEffectiveWorkspaceLeftSidebarWidth(360, 1200)).toBe(360);
  });

  test("clamps the displayed width for tight desktop viewports", () => {
    expect(getEffectiveWorkspaceLeftSidebarWidth(420, 900)).toBe(260);
  });

  test("never displays below the narrowest supported sidebar width", () => {
    expect(getEffectiveWorkspaceLeftSidebarWidth(420, 800)).toBe(220);
  });

  test("keeps the persisted-width clamp when viewport width is unavailable", () => {
    expect(getEffectiveWorkspaceLeftSidebarWidth(900, null)).toBe(420);
  });
});
