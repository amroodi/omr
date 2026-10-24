/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A separate build folder lets a production build be checked while the dev server uses .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000/api/v1',
  },
};
module.exports = nextConfig;
