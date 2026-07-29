import { defineConfig } from "vitest/config";

const common = {
  environment: "node",
  testTimeout: 120_000,
};

export default defineConfig({
  test: {
    ...common,
    projects: [
      {
        test: {
          ...common,
          name: "pr",
          include: ["evals/specs/**/*.test.ts"],
          exclude: ["**/*.slow.test.ts"],
        },
      },
      {
        test: {
          ...common,
          name: "nightly",
          include: ["evals/specs/**/*.test.ts"],
        },
      },
    ],
  },
});
