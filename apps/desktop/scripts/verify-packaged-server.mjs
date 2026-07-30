import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const appBundle = path.resolve(
  desktopRoot,
  process.argv[2] ?? path.join("dist-electron", "mac-arm64", "OpenWork.app"),
);
const appExecutable = path.join(appBundle, "Contents", "MacOS", "OpenWork");
const serverEntry = path.join(
  appBundle,
  "Contents",
  "Resources",
  "app.asar",
  "server",
  "dist",
  "server.js",
);

if (!existsSync(appExecutable)) {
  throw new Error(`Packaged OpenWork executable not found: ${appExecutable}`);
}

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
const result = spawnSync(appExecutable, ["-e", importProbe, pathToFileURL(serverEntry).href], {
  encoding: "utf8",
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
  },
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0 || !result.stdout.includes(marker)) {
  throw new Error(`Packaged server import failed with exit code ${result.status ?? "unknown"}.`);
}
