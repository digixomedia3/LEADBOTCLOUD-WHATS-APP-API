import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@lbc/shared', '@lbc/meta', '@lbc/razorpay', '@lbc/db'],
  // Quick-tunnel / named-tunnel hosts used for Meta testing in dev.
  allowedDevOrigins: ['*.trycloudflare.com', 'dev-app.leadbotcloud.com'],
};

export default config;
