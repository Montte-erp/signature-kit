import { createMDX } from "fumadocs-mdx/next";
import { fileURLToPath } from "node:url";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  turbopack: {
    // Pin the workspace root to this monorepo (stray parent lockfiles exist).
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
};

export default withMDX(config);
