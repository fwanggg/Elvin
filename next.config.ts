import type { NextConfig } from "next";

/**
 * The app is one page and every byte of it runs in the browser, so it is built as static files:
 * `next build` writes `out/`, and a host serves them. There is no server to run.
 *
 * Pages serves a project site from `/<repo>`, so that build needs the prefix. It is read from the
 * environment rather than written down because the same source also builds for a domain root,
 * where a base path would point every asset at a path nobody serves.
 */
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  ...(basePath ? { basePath } : {}),
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
