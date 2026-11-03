import type { NextConfig } from "next";
import { BASE_PATH } from "./lib/api";

const nextConfig: NextConfig = {
  // Served at yoshik.xyz/attenly via a rewrite on the main site — all routes
  // and assets live under the subpath. Client API calls use api() from lib/api.
  basePath: BASE_PATH,
  experimental: {
    // Icons are imported by name from the package entry; keep only the ones used.
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  async redirects() {
    return [
      // With a basePath nothing answers at "/", so the bare deployment URL
      // (attenly-pi.vercel.app) used to 404. Send it to the app instead.
      { source: "/", destination: BASE_PATH, basePath: false, permanent: false },
    ];
  },
};

export default nextConfig;
