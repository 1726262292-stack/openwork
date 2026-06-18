import { LandingCloud } from "../../components/landing-cloud";
import { getGithubData } from "../../lib/github";
import { baseOpenGraph } from "../../lib/seo";

export const metadata = {
  title: "OpenWork Cloud — Control your team's AI workspace from a conversation",
  description:
    "OpenWork Cloud is the control plane for shared skills, plugins, members, and providers — runnable from plain English. Local-first by default, cloud-ready when your team needs it.",
  alternates: {
    canonical: "/cloud"
  },
  openGraph: {
    ...baseOpenGraph,
    url: "https://openworklabs.com/cloud"
  }
};

export default async function CloudPage() {
  const github = await getGithubData();
  const cal = process.env.NEXT_PUBLIC_CAL_URL ?? "";

  return (
    <LandingCloud
      stars={github.stars}
      downloadHref={github.downloads.macos}
      callHref={cal}
    />
  );
}
