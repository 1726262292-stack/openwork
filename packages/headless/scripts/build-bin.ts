import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type VersionInfo = {
  version: string;
  sha256: string;
};

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(root, "..", "..");
const targetDir = resolve(root, "dist");

const serverBin = resolve(root, "..", "server", "dist", "bin", "openwork-server");

const resolveOwpenbotRepo = () => {
  const envPath = process.env.OWPENBOT_REPO?.trim() || process.env.OWPENBOT_DIR?.trim();
  const candidates = [envPath, resolve(repoRoot, "..", "owpenbot"), resolve(repoRoot, "vendor", "owpenbot")].filter(
    Boolean,
  ) as string[];

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "package.json"))) {
      return candidate;
    }
  }

  const cloneTarget = envPath ?? resolve(repoRoot, "..", "owpenbot");
  const repoUrl = process.env.OWPENBOT_REPO_URL?.trim() || "https://github.com/different-ai/owpenbot.git";
  const repoRef = process.env.OWPENBOT_REF?.trim() || "dev";

  if (!cloneTarget) {
    throw new Error("OWPENBOT_REPO not found and no clone target available.");
  }

  const result = spawnSync("git", ["clone", "--depth", "1", "--branch", repoRef, repoUrl, cloneTarget], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Failed to clone owpenbot from ${repoUrl}`);
  }

  if (!existsSync(resolve(cloneTarget, "package.json"))) {
    throw new Error(`Owpenbot package.json not found in ${cloneTarget}`);
  }

  return cloneTarget;
};

const owpenbotRepo = resolveOwpenbotRepo();
const owpenbotBin = resolve(owpenbotRepo, "dist", "bin", "owpenbot");

const serverPkg = JSON.parse(
  await readFile(resolve(root, "..", "server", "package.json"), "utf8"),
) as { version: string };
const owpenbotPkg = JSON.parse(await readFile(resolve(owpenbotRepo, "package.json"), "utf8")) as { version: string };

await mkdir(targetDir, { recursive: true });
await copyFile(serverBin, resolve(targetDir, "openwork-server"));
await copyFile(owpenbotBin, resolve(targetDir, "owpenbot"));

const sha256 = async (path: string) => {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
};

const versions = {
  "openwork-server": {
    version: serverPkg.version,
    sha256: await sha256(resolve(targetDir, "openwork-server")),
  },
  owpenbot: {
    version: owpenbotPkg.version,
    sha256: await sha256(resolve(targetDir, "owpenbot")),
  },
} as Record<string, VersionInfo>;

await writeFile(resolve(targetDir, "versions.json"), `${JSON.stringify(versions, null, 2)}\n`, "utf8");
