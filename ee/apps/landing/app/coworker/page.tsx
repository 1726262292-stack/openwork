import { LandingCoworker } from "../../components/landing-coworker";
import { getGithubData } from "../../lib/github";
import { baseOpenGraph } from "../../lib/seo";

export const metadata = {
  title: "OpenWork Coworker — Design and deploy AI coworkers from chat",
  description:
    "Design a full AI coworker right from the OpenWork desktop chat, connect the tools that matter, and deploy to Slack, email, and beyond. Available in private beta.",
  alternates: {
    canonical: "/coworker"
  },
  openGraph: {
    ...baseOpenGraph,
    url: "https://openworklabs.com/coworker"
  }
};

export default async function CoworkerPage() {
  const github = await getGithubData();
  const cal = process.env.NEXT_PUBLIC_CAL_URL ?? "";

  return (
    <LandingCoworker
      stars={github.stars}
      downloadHref={github.downloads.macos}
      callHref={cal}
    />
  );
}
