import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { test } from "@openwork/testkit";

const transferUnitTest = fileURLToPath(
  new URL("../../apps/desktop/electron/binary-transfer.test.mjs", import.meta.url),
);

test("Electron remote binary transfers preserve bytes, workspace boundaries, and cancellation cleanup", async ({ evidence }) => {
  const unit = spawnSync(process.execPath, [
    "--test",
    "--test-reporter=tap",
    transferUnitTest,
  ], { encoding: "utf8" });
  expect(unit.status, unit.stderr || unit.stdout).toBe(0);
  expect(unit.stdout).toContain("uploads exact original multipart bytes with spaces and Unicode in the filename");
  expect(unit.stdout).toContain("downloads high bytes exactly and atomically removes the temporary file");
  expect(unit.stdout).toContain("rejects zero-byte and oversized uploads with clear error codes");
  expect(unit.stdout).toContain("rejects zero-byte and oversized downloads without leaving partial files");
  expect(unit.stdout).toContain("cancellation removes the incomplete download");
  expect(unit.stdout).toContain("rejects unauthorized, traversal, and symlink upload paths");
  expect(unit.stdout).toContain("rejects traversal and symlink download destinations");
  expect(unit.stdout).not.toContain("not ok");
  expect(unit.stdout).toMatch(/# tests 7\b/);
  expect(unit.stdout).toMatch(/# pass 7\b/);
  expect(unit.stdout).toMatch(/# fail 0\b/);
  expect(unit.stdout).toMatch(/# skipped 0\b/);

  evidence.recordAssertionEvidence(
    "Main-process binary transfers are byte-exact, bounded, and workspace-confined",
    "Multipart uploads reproduced the original bytes with Unicode filenames, downloads landed atomically with no partial files after oversize or cancellation, and unauthorized, traversal, and symlink paths were rejected on both directions.",
    true,
  );
});
