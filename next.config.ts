import type { NextConfig } from "next";

/** Set by GitHub Actions for project pages (e.g. /my-repo). Leave unset for local file:// or root hosting. */
const basePath = process.env.GITHUB_PAGES_BASE_PATH?.trim() ?? "";

const nextConfig: NextConfig = {
  output: "export",
  ...(basePath ? { basePath } : {}),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
