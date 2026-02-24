/** @type {import('next').NextConfig} */
const mintlifyOrigin = "https://differentai.mintlify.app";

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/_mintlify/:path*",
        destination: `${mintlifyOrigin}/_mintlify/:path*`,
      },
      {
        source: "/api/request",
        destination: `${mintlifyOrigin}/_mintlify/api/request`,
      },
      {
        source: "/docs",
        destination: `${mintlifyOrigin}/`,
      },
      {
        source: "/docs/get-started",
        destination: `${mintlifyOrigin}/quickstart`,
      },
      {
        source: "/docs/llms.txt",
        destination: `${mintlifyOrigin}/llms.txt`,
      },
      {
        source: "/docs/llms-full.txt",
        destination: `${mintlifyOrigin}/llms-full.txt`,
      },
      {
        source: "/docs/sitemap.xml",
        destination: `${mintlifyOrigin}/sitemap.xml`,
      },
      {
        source: "/docs/robots.txt",
        destination: `${mintlifyOrigin}/robots.txt`,
      },
      {
        source: "/docs/mcp",
        destination: `${mintlifyOrigin}/mcp`,
      },
      {
        source: "/docs/:path*",
        destination: `${mintlifyOrigin}/:path*`,
      },
      // Mintlify emits root-based links (e.g. /cli) even when embedded under /docs.
      // Mirror key docs routes at the root so in-doc navigation does not break.
      {
        source: "/get-started",
        destination: `${mintlifyOrigin}/quickstart`,
      },
      {
        source: "/quickstart",
        destination: `${mintlifyOrigin}/quickstart`,
      },
      {
        source: "/development",
        destination: `${mintlifyOrigin}/development`,
      },
      {
        source: "/openwork",
        destination: `${mintlifyOrigin}/openwork`,
      },
      {
        source: "/opencode-router",
        destination: `${mintlifyOrigin}/opencode-router`,
      },
      {
        source: "/cli",
        destination: `${mintlifyOrigin}/cli`,
      },
      {
        source: "/create-openwork-instance",
        destination: `${mintlifyOrigin}/create-openwork-instance`,
      },
      {
        source: "/tutorials/:path*",
        destination: `${mintlifyOrigin}/tutorials/:path*`,
      },
      {
        source: "/api-reference/:path*",
        destination: `${mintlifyOrigin}/api-reference/:path*`,
      },
      {
        source: "/mintlify-assets/:path+",
        destination: `${mintlifyOrigin}/mintlify-assets/:path+`,
      },
    ];
  },
};

module.exports = nextConfig;
