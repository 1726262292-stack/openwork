import { expect } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "@openwork/testkit";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("the packaged Desktop runtime can load MCP JSON Schema validation", async () => {
  const root = mkdtempSync(join(tmpdir(), "openwork-mcp-validation-"));
  try {
    const nodeModules = join(root, "node_modules");
    const prepare = spawnSync(process.execPath, [
      resolve(repoRoot, "apps/desktop/scripts/prepare-runtime-node-modules.mjs"),
      "--outdir",
      nodeModules,
    ], { encoding: "utf8" });
    expect(prepare.status, prepare.stderr).toBe(0);

    const requireFromDesktop = createRequire(pathToFileURL(resolve(repoRoot, "apps/desktop/package.json")));
    const providerSource = requireFromDesktop.resolve("@modelcontextprotocol/sdk/validation/ajv");
    const providerDestination = join(nodeModules, "@modelcontextprotocol", "sdk", "validation", "ajv-provider.js");
    mkdirSync(dirname(providerDestination), { recursive: true });
    cpSync(providerSource, providerDestination);
    if (existsSync(`${providerSource}.map`)) cpSync(`${providerSource}.map`, `${providerDestination}.map`);
    writeFileSync(join(nodeModules, "@modelcontextprotocol", "sdk", "package.json"), JSON.stringify({ type: "module" }));

    const provider = await import(`${pathToFileURL(providerDestination).href}?test=${Date.now()}`);
    const validator = new provider.AjvJsonSchemaValidator().getValidator({
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    });
    expect(validator({ title: "Artifact" })).toMatchObject({ valid: true });
    expect(validator({ title: 42 })).toMatchObject({ valid: false });

    for (const packageName of ["ajv", "ajv-formats", "fast-deep-equal", "fast-uri", "json-schema-traverse", "require-from-string"]) {
      const staged = JSON.parse(readFileSync(join(nodeModules, packageName, "package.json"), "utf8"));
      expect(staged.name).toBe(packageName);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
