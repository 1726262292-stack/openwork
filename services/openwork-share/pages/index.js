import Head from "next/head";

import ShareHomeClient from "../components/share-home-client";
import ShareNav from "../components/share-nav";
import { ResponsiveGrain } from "../components/responsive-grain";
import { DEFAULT_PUBLIC_BASE_URL } from "../server/_lib/share-utils.js";

const rootOgImageUrl = `${DEFAULT_PUBLIC_BASE_URL}/og/root`;

function formatCompact(value) {
  try {
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1
    }).format(value);
  } catch {
    return String(value);
  }
}

export default function ShareHomePage({ stars = "—" }) {
  return (
    <>
      <Head>
        <title>Package Your Worker - OpenWork Share</title>
        <meta
          name="description"
          content="Drag and drop OpenWork skills, agents, commands, or MCP config to publish a shareable worker package."
        />
        <link rel="canonical" href={DEFAULT_PUBLIC_BASE_URL} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Package Your Worker" />
        <meta
          property="og:description"
          content="Drop skills, agents, or MCPs into OpenWork Share and publish a worker package in one move."
        />
        <meta property="og:url" content={DEFAULT_PUBLIC_BASE_URL} />
        <meta property="og:image" content={rootOgImageUrl} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Package Your Worker" />
        <meta
          name="twitter:description"
          content="Drop skills, agents, or MCPs into OpenWork Share and publish a worker package in one move."
        />
        <meta name="twitter:image" content={rootOgImageUrl} />
      </Head>

      <div className="grain-background">
        <ResponsiveGrain
          colors={["#f6f9fc", "#f6f9fc", "#1e293b", "#334155"]}
          colorBack="#f6f9fc"
          softness={1}
          intensity={0.03}
          noise={0.14}
          shape="corners"
          speed={0.2}
        />
      </div>

      <main className="shell">
        <ShareNav stars={stars} />
        <ShareHomeClient />
      </main>
    </>
  );
}

export async function getStaticProps() {
  let stars = "—";

  try {
    const response = await fetch("https://api.github.com/repos/different-ai/openwork", {
      headers: {
        Accept: "application/vnd.github+json"
      }
    });

    if (response.ok) {
      const repo = await response.json();
      if (typeof repo?.stargazers_count === "number") {
        stars = formatCompact(repo.stargazers_count);
      }
    }
  } catch {
    stars = "—";
  }

  return {
    props: {
      stars
    },
    revalidate: 3600
  };
}
