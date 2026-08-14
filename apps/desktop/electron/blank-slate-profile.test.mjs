import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveBlankSlateLaunch } from "./blank-slate-profile.mjs";

const execFileAsync = promisify(execFile);

test("normal launches remain unchanged", () => {
  assert.deepEqual(resolveBlankSlateLaunch({ argv: [], appName: "OpenWork" }), {
    enabled: false,
    appName: "OpenWork",
    userDataPath: null,
  });
});

test("cleanup worker removes a profile after its parent exits", async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), "openwork-cleanup-test-"));
  await writeFile(path.join(userDataPath, "Preferences"), "test");

  await execFileAsync(process.execPath, [
    fileURLToPath(new URL("./blank-slate-cleanup.mjs", import.meta.url)),
    "2147483647",
    userDataPath,
  ]);

  await assert.rejects(() => rm(userDataPath));
});

test("blank-slate launches receive unique temporary profiles and a visible name", async () => {
  const first = resolveBlankSlateLaunch({ argv: ["--blank-slate"], appName: "OpenWork" });
  const second = resolveBlankSlateLaunch({ argv: ["--blank-slate"], appName: "OpenWork" });

  try {
    assert.equal(first.appName, "OpenWork - Test profile");
    assert.equal(first.enabled, true);
    assert.ok(first.userDataPath.startsWith(tmpdir()));
    assert.notEqual(first.userDataPath, second.userDataPath);
    assert.ok(!first.userDataPath.includes("com.differentai.openwork"));
  } finally {
    await Promise.all([
      rm(first.userDataPath, { recursive: true, force: true }),
      rm(second.userDataPath, { recursive: true, force: true }),
    ]);
  }
});
