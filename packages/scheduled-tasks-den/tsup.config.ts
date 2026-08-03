import { defineConfig } from "tsup"

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    index: "src/index.ts",
  },
  external: ["@openwork/scheduled-tasks", "zod"],
  format: ["esm"],
  target: "es2022",
})
