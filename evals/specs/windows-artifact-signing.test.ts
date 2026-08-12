import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { expect, onTestFinished } from "vitest";
import { test } from "@openwork/testkit";

const repoRoot = resolve(import.meta.dirname, "../..");
const workflowPath = join(repoRoot, ".github", "workflows", "release-macos-aarch64.yml");
const refreshScriptPath = join(repoRoot, "scripts", "release", "refresh-signed-windows-artifacts.mjs");

const installers = [
  ["openwork-win-x64-1.2.3.exe", "latest.yml"],
  ["openwork-win-arm64-1.2.3.exe", "latest.yml"],
  ["openwork-cloud-win-x64-1.2.3.exe", "cloud.yml"],
  ["openwork-cloud-win-arm64-1.2.3.exe", "cloud.yml"],
  ["openwork-enterprise-win-x64-1.2.3.exe", "enterprise.yml"],
  ["openwork-enterprise-win-arm64-1.2.3.exe", "enterprise.yml"],
] as const;

test("one Azure OIDC job signs and publishes every Windows installer", async ({ evidence }) => {
  const workflow = await readFile(workflowPath, "utf8");

  expect(workflow.match(/uses: azure\/artifact-signing-action@v2/g)).toHaveLength(1);
  expect(workflow).toContain("sign-and-publish-windows:");
  expect(workflow).toContain("runs-on: windows-2022");
  expect(workflow).toContain("environment: windows-signing");
  expect(workflow).toContain("id-token: write");
  expect(workflow).toContain("files-folder-recurse: true");
  expect(workflow).toContain("Expected 6 signed Windows installers");
  expect(workflow).toContain("needs.sign-and-publish-windows.result == 'success'");

  evidence.fact(
    "A single protected Azure OIDC job gates publication of all Windows installers",
    "The release workflow has one Artifact Signing action on windows-2022, recursively signs six installers, verifies every signature, and blocks merged-manifest publication until that job succeeds.",
    true,
  );
});

test("signed Windows metadata is regenerated for every distribution and architecture", async ({ evidence }) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openwork-windows-signing-"));
  onTestFinished(() => rm(fixtureRoot, { recursive: true, force: true }));

  for (const [index, [installerName, manifestName]] of installers.entries()) {
    const artifactDir = join(fixtureRoot, `artifact-${index}`);
    await mkdir(artifactDir, { recursive: true });
    const installerPath = join(artifactDir, installerName);
    await writeFile(installerPath, `signed-installer-${installerName}`);
    await writeFile(
      join(artifactDir, manifestName),
      `version: 1.2.3\nfiles:\n  - url: ${installerName}\n    sha512: unsigned\n    size: 1\npath: ${installerName}\nsha512: unsigned\n`,
    );
  }

  const result = spawnSync(process.execPath, [refreshScriptPath, fixtureRoot, "6"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);

  for (const [index, [installerName, manifestName]] of installers.entries()) {
    const artifactDir = join(fixtureRoot, `artifact-${index}`);
    const installerPath = join(artifactDir, installerName);
    const expectedSha512 = createHash("sha512").update(await readFile(installerPath)).digest("base64");
    const manifest = await readFile(join(artifactDir, manifestName), "utf8");
    expect(manifest).toContain(expectedSha512);
    expect((await stat(`${installerPath}.blockmap`)).size).toBeGreaterThan(0);
  }

  evidence.fact(
    "All six signed installers receive byte-accurate updater metadata",
    `The refresh helper regenerated blockmaps and SHA-512 manifest entries for ${installers.map(([name]) => basename(name)).join(", ")}.`,
    true,
  );
});
