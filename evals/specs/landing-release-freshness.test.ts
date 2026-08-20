import { expect, onTestFinished } from "vitest";
import { test } from "@openwork/testkit";
import { getGithubData } from "../../ee/apps/landing/lib/github";

const repoUrl = "https://api.github.com/repos/different-ai/openwork";
const latestReleaseUrl = "https://api.github.com/repos/different-ai/openwork/releases/latest";
const releasesUrl = "https://api.github.com/repos/different-ai/openwork/releases?per_page=50";
const releaseTag = "v9.9.9";
const downloadUrl = `https://github.com/different-ai/openwork/releases/download/${releaseTag}/openwork-mac-arm64-9.9.9.dmg`;

test("the public download page refreshes a newly published stable release", async ({ evidence }) => {
  const originalFetch = globalThis.fetch;
  const revalidateByUrl = new Map<string, number | undefined>();
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
      const next = (init as { next?: { revalidate?: number } } | undefined)?.next;
      revalidateByUrl.set(url, next?.revalidate);
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
  evidence.recordAssertionEvidence(
    "A newly published stable release replaces stale public download metadata",
    "The landing resolver selected the new stable tag and installer while limiting the latest-release cache to 90 seconds instead of one hour.",
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
