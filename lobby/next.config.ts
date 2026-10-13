import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // the repo root has no package.json; point Turbopack at this app explicitly
  turbopack: {
    root: path.join(__dirname),
    // Tailwind v4 runs as a Turbopack loader (restored from the create-next-app template)
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  async headers() {
    return [
      {
        // the game build is replaced wholesale on each update, let the CDN revalidate per file
        source: "/game/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
