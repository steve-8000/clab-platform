import { Hono, type Context } from "hono";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://orchestrator:4001";
const RUNTIME_URL = process.env.RUNTIME_MANAGER_URL || "http://runtime-manager:4002";
const REVIEW_URL = process.env.REVIEW_SERVICE_URL || "http://review-service:4006";
const KNOWLEDGE_URL = process.env.KNOWLEDGE_SERVICE_URL || "http://knowledge-service:4007";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function safeError(message: string, err?: unknown): Record<string, string> {
  if (IS_PRODUCTION || !err) return { error: message };
  return { error: message, detail: String(err) };
}

const rest = new Hono();

async function proxyJson(c: Context, targetUrl: string): Promise<Response> {
  const init: RequestInit = {
    method: c.req.method,
    headers: { "Content-Type": "application/json" },
  };

  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.text();
  }

  const res = await fetch(targetUrl, init);
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

// Proxy all /missions/* to orchestrator
rest.all("/missions", async (c) => {
  try {
    return await proxyJson(c, `${ORCHESTRATOR_URL}/v1/missions`);
  } catch (err) {
    return c.json(safeError("Orchestrator unavailable", err), 502);
  }
});

rest.all("/missions/*", async (c) => {
  const path = c.req.path.replace("/v1", "");  // /v1/missions/xxx -> /v1/missions/xxx
  const url = `${ORCHESTRATOR_URL}/v1${path.startsWith("/missions") ? path : "/missions" + path}`;

  try {
    return await proxyJson(c, url);
  } catch (err) {
    return c.json(safeError("Orchestrator unavailable", err), 502);
  }
});

// Proxy /workspaces/* to orchestrator
rest.all("/workspaces", async (c) => {
  const url = `${ORCHESTRATOR_URL}/v1/workspaces`;
  try {
    return await proxyJson(c, url);
  } catch (err) {
    return c.json(safeError("Orchestrator unavailable", err), 502);
  }
});

rest.all("/workspaces/*", async (c) => {
  const path = c.req.path.replace("/v1", "");
  const url = `${ORCHESTRATOR_URL}/v1${path}`;
  try {
    return await proxyJson(c, url);
  } catch (err) {
    return c.json(safeError("Orchestrator unavailable", err), 502);
  }
});

// Proxy /sessions/* to runtime-manager
rest.all("/sessions", async (c) => {
  try {
    return await proxyJson(c, `${RUNTIME_URL}/sessions`);
  } catch (err) {
    return c.json(safeError("Runtime manager unavailable", err), 502);
  }
});

rest.all("/sessions/*", async (c) => {
  const path = c.req.path.replace("/v1", "");
  try {
    return await proxyJson(c, `${RUNTIME_URL}${path}`);
  } catch (err) {
    return c.json(safeError("Runtime manager unavailable", err), 502);
  }
});

// Proxy approval operations to review-service.
rest.get("/approvals", async (c) => {
  try {
    const res = await fetch(`${REVIEW_URL}/approvals`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return new Response(await res.text(), { headers: { "Content-Type": "application/json" } });
    return c.json(safeError("Review service unavailable"), 502);
  } catch (err) {
    return c.json(safeError("Service unavailable", err), 502);
  }
});

rest.post("/approvals/:id/resolve", async (c) => {
  const id = c.req.param("id");

  try {
    const res = await fetch(`${REVIEW_URL}/approvals/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await c.req.text(),
      signal: AbortSignal.timeout(5000),
    });

    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return c.json(safeError("Review service unavailable", err), 502);
  }
});

// Proxy /knowledge/* to knowledge-service
rest.all("/knowledge", async (c) => {
  try {
    return await proxyJson(c, `${KNOWLEDGE_URL}/v1/knowledge`);
  } catch (err) {
    return c.json(safeError("Knowledge service unavailable", err), 502);
  }
});

rest.all("/knowledge/*", async (c) => {
  const path = c.req.path.replace("/v1", "");
  const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";
  const url = `${KNOWLEDGE_URL}/v1${path}${qs}`;
  try {
    return await proxyJson(c, url);
  } catch (err) {
    return c.json(safeError("Knowledge service unavailable", err), 502);
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

  const results = await Promise.all(
    services.map(async (svc) => {
      try {
        const res = await fetch(`${svc.url}/health`, { signal: AbortSignal.timeout(3000) });
        return { name: svc.name, status: res.ok ? "ok" as const : "error" as const };
      } catch {
        return { name: svc.name, status: "unreachable" as const };
      }
    }),
  );

  const serviceStatuses: Record<string, string> = {};
  for (const r of results) serviceStatuses[r.name] = r.status;

  const allOk = results.every((r) => r.status === "ok");
  const allDown = results.every((r) => r.status !== "ok");
  const overall = allOk ? "ok" : allDown ? "down" : "degraded";

  return c.json({ status: overall, services: serviceStatuses });
});

export { rest as restRoutes };
