import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@clab/domain", "@clab/sdk"],
};
export default config;
