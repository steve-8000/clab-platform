// In K8s, the browser calls /api/cp/* and /api/ks/* which Next.js rewrites proxy to the backend services.
// In local dev, set NEXT_PUBLIC_CONTROL_URL and NEXT_PUBLIC_KNOWLEDGE_URL to bypass the proxy.
export const CONTROL_PLANE_URL =
  process.env.NEXT_PUBLIC_CONTROL_URL || "/api/cp";

export const KNOWLEDGE_URL =
  process.env.NEXT_PUBLIC_KNOWLEDGE_URL || "/api/ks";
