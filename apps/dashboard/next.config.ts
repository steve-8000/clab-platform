import type { NextConfig } from "next";

const CONTROL_PLANE = process.env.CONTROL_PLANE_URL || "http://control-plane.clab.svc.cluster.local:8000";
const KNOWLEDGE_SVC = process.env.KNOWLEDGE_URL || "http://knowledge-service.clab.svc.cluster.local:4007";
const CODE_INTEL_SVC = process.env.CODE_INTEL_URL || "http://code-intel.clab.svc.cluster.local:4010";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/cp/:path*", destination: `${CONTROL_PLANE}/:path*` },
      { source: "/api/ks/:path*", destination: `${KNOWLEDGE_SVC}/:path*` },
      { source: "/api/ci/:path*", destination: `${CODE_INTEL_SVC}/:path*` },
    ];
  },
};

export default nextConfig;
