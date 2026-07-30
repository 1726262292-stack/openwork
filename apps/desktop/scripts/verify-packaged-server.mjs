import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const appBundleArgument = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
const appBundle = path.resolve(
  desktopRoot,
  appBundleArgument ?? path.join("dist-electron", "mac-arm64", "OpenWork.app"),
);
const sourceExecutable = path.join(appBundle, "Contents", "MacOS", "OpenWork");
if (!existsSync(sourceExecutable)) {
  throw new Error(`Packaged OpenWork executable not found: ${sourceExecutable}`);
}

const isolationRoot = mkdtempSync(path.join(tmpdir(), "openwork-packaged-runtime-"));
const isolatedAppBundle = path.join(isolationRoot, "OpenWork.app");
try {
  // Never probe an app in the repository: Node can otherwise climb out of the
  // bundle and resolve a missing package from the workspace node_modules.
  cpSync(appBundle, isolatedAppBundle, { recursive: true });
  const appExecutable = path.join(isolatedAppBundle, "Contents", "MacOS", "OpenWork");
  const serverEntry = path.join(
    isolatedAppBundle,
    "Contents",
    "Resources",
    "app.asar",
    "server",
    "dist",
    "server.js",
  );
  const marker = "PACKAGED_SERVER_IMPORT_OK";
  const importProbe = `
    import(process.argv[1])
      .then(() => {
        console.log(${JSON.stringify(marker)});
        process.exit(0);
      })
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  `;
  const isolatedEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
  };
  delete isolatedEnv.NODE_PATH;
  const result = spawnSync(appExecutable, ["-e", importProbe, pathToFileURL(serverEntry).href], {
    cwd: isolationRoot,
    encoding: "utf8",
    env: isolatedEnv,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0 || !result.stdout.includes(marker)) {
    throw new Error(`Packaged server import failed with exit code ${result.status ?? "unknown"}.`);
  }
} finally {
  rmSync(isolationRoot, { recursive: true, force: true });
}
