import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eventually, test } from "@openwork/testkit";
import { expect, onTestFinished } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function reservePort() {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to reserve a loopback port");
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

test("the Den API production package resolves workspace artifacts and starts listening", { timeout: 300_000 }, async ({ evidence }) => {
  const buildOutput: string[] = [];
  const build = spawn(pnpmCommand, ["--filter", "@openwork-ee/den-api", "run", "build"], {
    cwd: repoRoot,
    env: { ...process.env, DEN_UPLOAD_SENTRY_SOURCEMAPS: "0" },
  });
  build.stdout.on("data", (chunk) => buildOutput.push(String(chunk)));
  build.stderr.on("data", (chunk) => buildOutput.push(String(chunk)));
  onTestFinished(() => {
    if (build.exitCode === null) build.kill("SIGTERM");
  });
  const buildExitCode = await new Promise<number | null>((resolveBuild, rejectBuild) => {
    build.once("error", rejectBuild);
    build.once("close", resolveBuild);
  });
  expect(buildExitCode, `Den API build failed\n${buildOutput.join("")}`).toBe(0);

  const port = await reservePort();
  const output: string[] = [];
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.OPENWORK_DEV_MODE;
  Object.assign(env, {
    PORT: String(port),
    DEN_BIND_HOST: "127.0.0.1",
    DB_MODE: "mysql",
    DATABASE_URL: "mysql://smoke:smoke@127.0.0.1:1/smoke",
    DEN_DB_ENCRYPTION_KEY: "ci-den-db-encryption-key-value-123456",
    BETTER_AUTH_SECRET: "ci-better-auth-secret-value-123456",
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    DEN_OBSERVABILITY_BACKEND: "none",
    PROVISIONER_MODE: "stub",
  });

  const server = spawn(process.execPath, ["dist/main.js"], {
    cwd: resolve(repoRoot, "ee/apps/den-api"),
    env,
  });
  server.stdout.on("data", (chunk) => output.push(String(chunk)));
  server.stderr.on("data", (chunk) => output.push(String(chunk)));
  onTestFinished(() => {
    if (server.exitCode === null) server.kill("SIGTERM");
  });

  await eventually(() => {
    const logs = output.join("");
    if (logs.includes('"message":"server listening"')) return true;
    if (server.exitCode !== null) throw new Error(`Den API exited with ${server.exitCode}\n${logs}`);
    return false;
  }, {
    within: 15_000,
    intervalMs: 50,
    label: `production Den API startup\n${output.join("")}`,
  });

  expect(output.join("")).toContain('"message":"server listening"');
  evidence.recordAssertionEvidence(
    "The production Den API artifact resolves and starts",
    "The spec rebuilt the workspace dependency graph, validated every workspace export target, removed development Node conditions, and started dist/main.js through its server-listening marker. The Docker image smoke separately asserts /health with MySQL.",
    true,
  );
});
