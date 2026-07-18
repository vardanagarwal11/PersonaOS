/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // Root launcher adds a lockfile at the repo root; pin the workspace root to
  // this app so Next doesn't warn or guess wrong.
  turbopack: { root: __dirname },
  env: {
    NEXT_PUBLIC_API: process.env.NEXT_PUBLIC_API || "http://localhost:4000",
  },
};
