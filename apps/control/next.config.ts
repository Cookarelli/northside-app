import type { NextConfig } from 'next';
const config:NextConfig={transpilePackages:['@northside/data','@northside/domain','@northside/shopify','@northside/agent-runtime'],serverExternalPackages:['postgres'],devIndicators:false};
export default config;
