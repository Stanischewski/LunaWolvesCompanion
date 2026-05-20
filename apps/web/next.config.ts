import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:3001";

const config: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "render.worldofwarcraft.com",
      },
    ],
  },
  async rewrites() {
    return {
      // afterFiles: Next.js-eigene Routen (z.B. /auth/callback, /auth/logout)
      // haben Vorrang — erst danach greift der Rewrite.
      afterFiles: [
        {
          source: "/auth/:path*",
          destination: `${apiUrl}/auth/:path*`,
        },
        {
          source: "/api/v1/:path*",
          destination: `${apiUrl}/api/v1/:path*`,
        },
      ],
    };
  },
};

export default config;
