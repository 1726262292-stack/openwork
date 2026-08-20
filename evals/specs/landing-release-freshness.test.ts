import { expect, onTestFinished } from "vitest";
import { test } from "@openwork/testkit";
import { readFile } from "node:fs/promises";
import {
  getGithubData,
  LATEST_RELEASE_CACHE_TAG,
} from "../../ee/apps/landing/lib/github";

const repoUrl = "https://api.github.com/repos/different-ai/openwork";
const latestReleaseUrl = "https://api.github.com/repos/different-ai/openwork/releases/latest";
const releasesUrl = "https://api.github.com/repos/different-ai/openwork/releases?per_page=50";
const releaseTag = "v9.9.9";
const downloadUrl = `https://github.com/different-ai/openwork/releases/download/${releaseTag}/openwork-mac-arm64-9.9.9.dmg`;

test("the public download page refreshes a newly published stable release", async ({ evidence }) => {
  const originalFetch = globalThis.fetch;
  const revalidateByUrl = new Map<string, number | undefined>();
  const tagsByUrl = new Map<string, string[] | undefined>();
  const release = {
    draft: false,
    prerelease: false,
    html_url: `https://github.com/different-ai/openwork/releases/tag/${releaseTag}`,
    tag_name: releaseTag,
    assets: [{
      name: "openwork-mac-arm64-9.9.9.dmg",
      browser_download_url: downloadUrl,
    }],
  };
  const fixtures: Record<string, unknown> = {
    [repoUrl]: { stargazers_count: 22_800 },
    [latestReleaseUrl]: release,
    [releasesUrl]: [release],
  };
  const fetchStub = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      const next = (init as {
        next?: { revalidate?: number; tags?: string[] };
      } | undefined)?.next;
      revalidateByUrl.set(url, next?.revalidate);
      tagsByUrl.set(url, next?.tags);
      const fixture = fixtures[url];
      return fixture === undefined
        ? new Response("Not found", { status: 404 })
        : Response.json(fixture);
    },
    { preconnect: originalFetch.preconnect },
  ) satisfies typeof fetch;
  globalThis.fetch = fetchStub;
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await getGithubData();

  expect(result.releaseTag).toBe(releaseTag);
  expect(result.installers.macos.appleSilicon).toBe(downloadUrl);
  expect(revalidateByUrl.get(latestReleaseUrl)).toBe(90);
  expect(tagsByUrl.get(latestReleaseUrl)).toEqual([LATEST_RELEASE_CACHE_TAG]);
  expect(tagsByUrl.get(releasesUrl)).toEqual([LATEST_RELEASE_CACHE_TAG]);

  const releaseWorkflow = await readFile(
    new URL("../../.github/workflows/release-macos-aarch64.yml", import.meta.url),
    "utf8",
  );
  expect(releaseWorkflow).toContain("needs: [resolve-release, publish-release]");
  expect(releaseWorkflow).toContain("needs.publish-release.result == 'success'");
  expect(releaseWorkflow).toContain("needs.resolve-release.outputs.prerelease != 'true'");
  expect(releaseWorkflow).toContain("cache dangerously-delete");
  expect(releaseWorkflow).toContain(`--tag ${LATEST_RELEASE_CACHE_TAG}`);
  evidence.recordAssertionEvidence(
    "A stable release publication deletes the exact landing cache entry",
    "The landing resolver tags both stable-release lookups, and the successful non-prerelease workflow deletes that Vercel cache tag so the next download request blocks on fresh GitHub metadata.",
    true,
  );

  expect(revalidateByUrl.get(repoUrl)).toBe(60 * 60);
  expect(revalidateByUrl.get(releasesUrl)).toBe(10 * 60);
  const maximumRequestsPerHour = (60 * 60) / (60 * 60)
    + (60 * 60) / 90
    + (60 * 60) / (10 * 60);
  expect(maximumRequestsPerHour).toBe(47);
  expect(maximumRequestsPerHour).toBeLessThan(60);
  evidence.recordAssertionEvidence(
    "Release freshness stays within the unauthenticated GitHub API budget",
    "The repo, latest-release, and fallback-list cache intervals cap one deployment at 47 GitHub API requests per hour rather than exhausting the 60-request public allowance.",
    true,
  );
});
