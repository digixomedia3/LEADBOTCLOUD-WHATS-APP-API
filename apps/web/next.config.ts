import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A 20,000-row contact import is sent as one action (about 2 MB, up to ~12 MB with long names, emails and tags). The 1 MB default made it crash the page.
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
  transpilePackages: ['@lbc/shared', '@lbc/meta', '@lbc/razorpay', '@lbc/connectors', '@lbc/db'],
  // Quick-tunnel / named-tunnel hosts used for Meta testing in dev.
  allowedDevOrigins: ['*.trycloudflare.com', 'dev-app.leadbotcloud.com'],
};

export default config;
