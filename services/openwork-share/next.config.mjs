/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: "/health", destination: "/api/health" },
      { source: "/og/:path*", destination: "/api/og/:path*" },
      { source: "/v1/:path*", destination: "/api/v1/:path*" }
    ];
  }
};

export default nextConfig;
