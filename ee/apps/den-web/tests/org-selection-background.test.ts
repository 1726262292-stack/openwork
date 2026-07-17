import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const orgSelectionPath = fileURLToPath(
  new URL("../app/(den)/dashboard/_components/org-selection-screen.tsx", import.meta.url),
);

function readOrgSelectionSource() {
  return readFileSync(orgSelectionPath, "utf8");
}

describe("org selection paper contract", () => {
  test("uses the same paper page and frame surfaces as the join flow", () => {
    const source = readOrgSelectionSource();

    expect(source).toContain('className="den-page flex min-h-[calc(100vh-2.5rem)] w-full items-center py-6"');
    expect(source).toContain('className="den-frame mx-auto w-full max-w-md p-6 md:p-8"');
    expect(source).toContain('className="den-frame-inset grid gap-2 rounded-[1.5rem] p-2"');
    expect(source).not.toContain("bg-[#0f1d31]");
    expect(source).not.toContain("Dithering");
    expect(source).not.toContain("PaperMeshGradient");
  });

  test("keeps the organization list readable and interactive", () => {
    const source = readOrgSelectionSource();

    expect(source).toContain('data-testid="org-chooser-foreground"');
    expect(source).toContain('data-testid="org-chooser-list"');
    expect(source).toContain("hover:bg-white");
    expect(source).not.toContain("disabled:opacity");
  });

  test("keeps the shell and actions stable on small screens", () => {
    const source = readOrgSelectionSource();

    expect(source).toContain('data-testid="org-chooser-root"');
    expect(source).toContain('data-testid="org-chooser-actions"');
    expect(source).toContain("Create or join");
    expect(source).toContain("Sign out");
  });
});
