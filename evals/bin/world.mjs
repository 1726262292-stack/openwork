#!/usr/bin/env node
/** World CLI bootstrap. */

if (!process.features?.typescript) {
  console.error("Node 24+ with native TypeScript required — run `nvm use`");
  process.exit(1);
}

const { main } = await import("../packages/env/src/cli.ts");

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
