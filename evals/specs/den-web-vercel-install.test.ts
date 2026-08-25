import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { briefTest, claim, testBrief } from "@openwork/testkit";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

briefTest(testBrief({
  behavior: "The Den Web Vercel deployment installs only its workspace dependency closure.",
  claims: {
    scopedInstall: claim("the Vercel install includes Den Web and its workspace dependencies", {
      never: "install unrelated native desktop or server packages",
    }),
  },
}), async ({ prove }) => {
  const config = await readFile(join(repoRoot, "ee", "apps", "den-web", "vercel.json"), "utf8");

  expect(config).toContain(
    '"installCommand": "cd ../../.. && pnpm install --frozen-lockfile --filter @openwork-ee/den-web..."',
  );
  expect(config).not.toContain('"installCommand": "cd ../../.. && pnpm install --frozen-lockfile"');

  prove.scopedInstall(
    true,
    "Vercel filters installation to @openwork-ee/den-web and its workspace dependency closure",
  );
});
