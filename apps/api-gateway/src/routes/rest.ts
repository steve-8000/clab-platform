import { Hono } from "hono";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://orchestrator:4001";
const RUNTIME_URL = process.env.RUNTIME_MANAGER_URL || "http://runtime-manager:4002";
const REVIEW_URL = process.env.REVIEW_SERVICE_URL || "http://review-service:4006";
const KNOWLEDGE_URL = process.env.KNOWLEDGE_SERVICE_URL || "http://knowledge-service:4007";

const rest = new Hono();

// --- Proxy helpers ---

async function proxyRequest(
  c: { req: { method: string; text: () => Promise<string> } },
  url: string,
) {
  const init: RequestInit = {
    method: c.req.method,
    headers: { "Content-Type": "application/json" },
  };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.text();
  }
  const res = await fetch(url, init);
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

// --- Proxy routes ---

// Proxy /missions/* to orchestrator
rest.all("/missions/*", async (c) => {
  const path = c.req.path.replace("/v1", "");
  const url = `${ORCHESTRATOR_URL}/v1${path.startsWith("/missions") ? path : "/missions" + path}`;
  try {
    return await proxyRequest(c, url);
  } catch (err) {
    return c.json({ error: "Orchestrator unavailable", detail: String(err) }, 502);
  }
});

// Proxy /workspaces/* to orchestrator
rest.all("/workspaces/*", async (c) => {
  const path = c.req.path.replace("/v1", "");
  try {
    return await proxyRequest(c, `${ORCHESTRATOR_URL}/v1${path}`);
  } catch (err) {
    return c.json({ error: "Orchestrator unavailable" }, 502);
  }
});

// Proxy /sessions/* to runtime-manager
rest.all("/sessions/*", async (c) => {
  const path = c.req.path.replace("/v1", "");
  try {
    return await proxyRequest(c, `${RUNTIME_URL}${path}`);
  } catch (err) {
    return c.json({ error: "Runtime manager unavailable" }, 502);
  }
});

// Proxy /approvals/* to review-service
rest.all("/approvals/*", async (c) => {
  const path = c.req.path.replace("/v1", "");
  try {
    return await proxyRequest(c, `${REVIEW_URL}${path}`);
  } catch (err) {
    return c.json({ error: "Review service unavailable" }, 502);
  }
});

rest.get("/approvals", async (c) => {
  try {
    const res = await fetch(`${REVIEW_URL}/approvals`);
    if (res.ok) return new Response(await res.text(), { headers: { "Content-Type": "application/json" } });
    return c.json([]);
  } catch {
    return c.json([]);
  }
});

// Proxy /knowledge/* to knowledge-service
rest.all("/knowledge/*", async (c) => {
  const path = c.req.path.replace("/v1", "");
  const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";
  try {
    return await proxyRequest(c, `${KNOWLEDGE_URL}/v1${path}${qs}`);
  } catch (err) {
    return c.json({ error: "Knowledge service unavailable", detail: String(err) }, 502);
  }
});

// Health aggregation
rest.get("/health/all", async (c) => {
  const services = [
    { name: "orchestrator", url: ORCHESTRATOR_URL },
    { name: "runtime-manager", url: RUNTIME_URL },
    { name: "review-service", url: REVIEW_URL },
    { name: "knowledge-service", url: KNOWLEDGE_URL },
  ];

  const results: Record<string, string> = {};
  await Promise.all(
    services.map(async (svc) => {
      try {
        const res = await fetch(`${svc.url}/health`, { signal: AbortSignal.timeout(3000) });
        results[svc.name] = res.ok ? "ok" : "error";
      } catch {
        results[svc.name] = "unreachable";
      }
    }),
  );

  return c.json(results);
});

export { rest as restRoutes };
