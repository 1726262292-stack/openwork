import Head from "next/head";

import ShareHomeClient from "../components/share-home-client";
import ShareNav from "../components/share-nav";
import { DEFAULT_PUBLIC_BASE_URL } from "../api/_lib/share-utils.js";

const rootOgImageUrl = `${DEFAULT_PUBLIC_BASE_URL}/og/root`;

export default function ShareHomePage() {
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

      <main className="shell">
        <ShareNav />
        <ShareHomeClient />
      </main>
    </>
  );
}
