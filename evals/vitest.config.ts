import { defineConfig } from "vitest/config";
import { shouldPrepareSuite, suiteWorkerCount } from "./runner/stack-suite.ts";

const common = {
  environment: "node",
  testTimeout: 120_000,
};

const prepareSuite = shouldPrepareSuite(process.argv);
const attachedDen = Boolean(process.env.OPENWORK_EVAL_DEN_API_URL?.trim());
const managedStack = prepareSuite && !attachedDen;
const stackWorkers = managedStack ? suiteWorkerCount(process.argv, process.env) : 1;

export default defineConfig({
  test: {
    ...common,
    fileParallelism: managedStack,
    maxWorkers: stackWorkers,
    projects: [
      {
        test: {
          ...common,
          name: "pr",
          // Naming convention: *.slow.test.ts drives Electron/Den (the stack lane, run on demand); every other spec must be app-less.
          include: ["specs/**/*.test.ts"],
          exclude: ["**/*.slow.test.ts"],
        },
      },
      {
        test: {
          ...common,
          name: "stack",
          testTimeout: 600_000,
          hookTimeout: 600_000,
          globalSetup: ["./runner/prepare-stack.ts"],
          setupFiles: ["./runner/stack-env.ts"],
          include: ["specs/**/*.test.ts"],
        },
      },
    ],
  },
});
