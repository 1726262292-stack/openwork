import assert from "node:assert/strict";
import test from "node:test";
import { shouldPrepareSuite, suiteWorkerCount, workerSlot } from "./stack-suite.ts";

test("single explicit specs keep their one-off setup", () => {
  assert.equal(shouldPrepareSuite(["vitest", "specs/example.slow.test.ts"]), false);
});

test("multi-file, glob, and whole-project runs prepare shared stack resources", () => {
  assert.equal(shouldPrepareSuite(["vitest", "specs/a.slow.test.ts", "specs/b.slow.test.ts"]), true);
  assert.equal(shouldPrepareSuite(["vitest", "specs/*.slow.test.ts"]), true);
  assert.equal(shouldPrepareSuite(["vitest"]), true);
});

test("Daytona defaults to two workers and never prepares more slots than explicit files", () => {
  assert.equal(suiteWorkerCount(["vitest", "specs/a.test.ts", "specs/b.test.ts"], { OPENWORK_EVAL_DAYTONA: "1" }), 2);
  assert.equal(suiteWorkerCount(["vitest", "specs/a.test.ts"], { OPENWORK_EVAL_DAYTONA: "1", OPENWORK_EVAL_MAX_WORKERS: "8" }), 1);
  assert.equal(suiteWorkerCount(["vitest", "specs/*.test.ts"], { OPENWORK_EVAL_DAYTONA: "1", OPENWORK_EVAL_MAX_WORKERS: "4" }), 4);
});

test("worker ids wrap onto the prepared slot pool", () => {
  assert.equal(workerSlot("1", 2), 0);
  assert.equal(workerSlot("2", 2), 1);
  assert.equal(workerSlot("3", 2), 0);
  assert.equal(workerSlot(undefined, 2), 0);
});
