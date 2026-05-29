import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    typeid: "src/typeid.ts",
    client: "src/client.ts",
    drizzle: "src/drizzle.ts",
    "schema/index": "src/schema/index.ts",
    "import/index": "src/import/index.ts",
    preferences: "src/preferences.ts",
    "env-store": "src/env-store.ts",
    bootstrap: "src/bootstrap.ts",
  },
  tsconfig: "./tsconfig.json",
  format: ["esm"],
  dts: {
    tsconfig: "./tsconfig.json",
  },
  clean: true,
  target: "es2022",
  platform: "node",
  sourcemap: false,
  splitting: false,
  treeshake: true,
  external: ["zod", "drizzle-orm", "better-sqlite3", "bun:sqlite"],
});
