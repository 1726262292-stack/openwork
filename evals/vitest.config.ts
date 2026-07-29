import { defineConfig } from "vitest/config";

const common = {
  environment: "node",
  testTimeout: 120_000,
};

export default defineConfig({
  test: {
    ...common,
    fileParallelism: false,
    projects: [
      {
        test: {
          ...common,
          name: "pr",
          // Naming convention: *.slow.test.ts drives Electron/Den and is nightly-only; every other spec must be app-less.
          include: ["specs/**/*.test.ts"],
          exclude: ["**/*.slow.test.ts"],
        },
      },
      {
        test: {
          ...common,
          name: "nightly",
          include: ["specs/**/*.test.ts"],
        },
      },
    ],
  },
});
