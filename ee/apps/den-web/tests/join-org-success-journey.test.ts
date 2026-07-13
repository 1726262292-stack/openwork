import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";

function readJoinOrgSuccess() {
  return readFileSync(
    fileURLToPath(new URL("../app/(den)/_components/join-org-success.tsx", import.meta.url)),
    "utf8",
  );
}

test("join organization success keeps one journey map with the organization install page as the primary download", () => {
  const source = readJoinOrgSuccess();

  expect(source).toContain('data-testid="join-org-journey-map"');
  expect(source).toContain('title="Join team"');
  expect(source).toContain('title="Download app"');
  expect(source).toContain('title="Connect and try your first workflow"');
  expect(source).toContain("href={installPageUrl}");
  // The installer must open in a new tab so the journey map (and its
  // remaining "connect" step) survives the download navigation.
  expect(source).toContain('href={installPageUrl} target="_blank" rel="noreferrer"');
  expect(source).not.toContain("https://openworklabs.com/download");
  expect(source).not.toContain("capabilities.map");
});
