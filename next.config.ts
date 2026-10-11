import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imports upload spreadsheets and statements through Server Actions; the default limit is 1MB.
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
