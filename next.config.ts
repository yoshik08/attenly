import type { NextConfig } from "next";
import { BASE_PATH } from "./lib/api";

const nextConfig: NextConfig = {
  // Served at yoshik.xyz/attenly via a rewrite on the main site — all routes
  // and assets live under the subpath. Client API calls use api() from lib/api.
  basePath: BASE_PATH,
};

export default nextConfig;
