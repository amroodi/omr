/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Production hardening: no «X-Powered-By: Next.js», no browser source maps (only minified code is
  // served), and every console.* call stripped from the bundles.
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  compiler: { removeConsole: process.env.NODE_ENV === 'production' },
  // A separate build folder lets a production build be checked while the dev server uses .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The repository root (npm workspaces) — so Next doesn't guess from stray lockfiles elsewhere.
  outputFileTracingRoot: require('path').join(__dirname, '../..'),
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000/api/v1',
  },
};
module.exports = nextConfig;
