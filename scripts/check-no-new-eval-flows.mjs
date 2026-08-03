#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const [base, head = "HEAD"] = process.argv.slice(2);

if (!base) {
  console.error("Usage: check-no-new-eval-flows.mjs <base-sha> [head-sha]");
  process.exit(2);
}

const output = execFileSync(
  "git",
  ["diff", "--name-status", "-z", "--find-renames", "--find-copies-harder", `${base}...${head}`, "--"],
  { encoding: "utf8" },
);
const fields = output.split("\0");
fields.pop();

const violations = [];
for (let index = 0; index < fields.length;) {
  const status = fields[index++];
  const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
  const paths = fields.slice(index, index + pathCount);
  index += pathCount;

  if (!paths.some((path) => path.startsWith("evals/flows/"))) continue;
  if (status === "D") continue;

  violations.push(`${status}\t${paths.join(" -> ")}`);
}

if (violations.length > 0) {
  console.error("The legacy eval flow corpus is frozen; only deletions under evals/flows/** are allowed.");
  for (const violation of violations) console.error(`  ${violation}`);
  console.error("Put new executable end-to-end coverage in evals/specs/**/*.test.ts and import test from @openwork/testkit.");
  process.exit(1);
}

console.log("Legacy eval flow guard passed: evals/flows/** has no non-deletion changes.");
