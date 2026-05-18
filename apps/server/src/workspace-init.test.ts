import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorkspaceFiles } from "./workspace-init.js";

async function withWorkspace(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "openwork-workspace-init-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("ensureWorkspaceFiles", () => {
  test("creates default agent with artifact guidance for new workspaces", async () => {
    await withWorkspace(async (root) => {
      await ensureWorkspaceFiles(root, "starter");
      const agent = await readFile(join(root, ".opencode", "agents", "openwork.md"), "utf8");
      expect(agent).toContain("OpenWork Artifacts");
      expect(agent).toContain("reports/artifact-eval.xlsx");
    });
  });

  test("adds artifact guidance to existing OpenWork agents", async () => {
    await withWorkspace(async (root) => {
      await mkdir(join(root, ".opencode", "agents"), { recursive: true });
      await writeFile(join(root, ".opencode", "agents", "openwork.md"), "---\ndescription: Old\n---\n\nOld instructions\n", "utf8");
      await ensureWorkspaceFiles(root, "starter");
      const agent = await readFile(join(root, ".opencode", "agents", "openwork.md"), "utf8");
      expect(agent).toContain("Old instructions");
      expect(agent).toContain("OpenWork Artifacts");
    });
  });

  test("does not rewrite an existing valid opencode config", async () => {
    await withWorkspace(async (root) => {
      const configPath = join(root, "opencode.jsonc");
      const config = `{
  // User formatting should survive routine workspace resolution.
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "custom"
}
`;
      await writeFile(configPath, config, "utf8");

      await ensureWorkspaceFiles(root, "starter");

      expect(await readFile(configPath, "utf8")).toBe(config);
    });
  });
});
