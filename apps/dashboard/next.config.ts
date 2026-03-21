import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@clab/domain", "@clab/sdk"],
};
export default config;
