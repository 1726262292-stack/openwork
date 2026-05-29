import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./src/schema/workspaces.ts",
    "./src/schema/tokens.ts",
    "./src/schema/server-config.ts",
    "./src/schema/env.ts",
    "./src/schema/audit.ts",
    "./src/schema/sessions.ts",
    "./src/schema/opencode-config.ts",
    "./src/schema/extensions.ts",
    "./src/schema/migration-state.ts",
  ],
  out: "./drizzle",
});
