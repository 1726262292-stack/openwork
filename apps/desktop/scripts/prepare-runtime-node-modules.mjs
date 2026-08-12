import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dirnameHere = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(dirnameHere, "..");
const requiredRoots = ["ajv", "ajv-formats"];

function packageRoot(name, fromPackageJson) {
  const requireFromPackage = createRequire(pathToFileURL(fromPackageJson));
  let current = dirname(requireFromPackage.resolve(name));
  while (current !== dirname(current)) {
    try {
      const packageJson = JSON.parse(readFileSync(join(current, "package.json"), "utf8"));
      if (packageJson.name === name) return { root: current, packageJson };
    } catch {
      // Keep walking from the resolved entry to its package root.
    }
    current = dirname(current);
  }
  throw new Error(`Could not resolve runtime package root for ${name}.`);
}

export function stageRuntimeNodeModules(outdir) {
  const output = resolve(outdir);
  const desktopPackageJson = resolve(desktopRoot, "package.json");
  const pending = requiredRoots.map((name) => ({ name, fromPackageJson: desktopPackageJson }));
  const staged = new Set();
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  while (pending.length > 0) {
    const item = pending.shift();
    if (!item || staged.has(item.name)) continue;
    const resolvedPackage = packageRoot(item.name, item.fromPackageJson);
    const destination = resolve(output, item.name);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolvedPackage.root, destination, { recursive: true, dereference: true });
    staged.add(item.name);
    const dependencies = resolvedPackage.packageJson.dependencies ?? {};
    for (const dependencyName of Object.keys(dependencies)) {
      pending.push({ name: dependencyName, fromPackageJson: resolve(resolvedPackage.root, "package.json") });
    }
  }

  return [...staged].sort();
}

const outdirIndex = process.argv.indexOf("--outdir");
if (outdirIndex !== -1) {
  const outdir = process.argv[outdirIndex + 1];
  if (!outdir) throw new Error("--outdir requires a path.");
  process.stdout.write(`${JSON.stringify({ staged: stageRuntimeNodeModules(outdir) })}\n`);
}
