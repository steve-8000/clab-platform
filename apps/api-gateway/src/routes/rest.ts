import { Hono } from "hono";

const MISSION_SERVICE_URL = process.env.MISSION_SERVICE_URL || "http://mission-service:4001";

const rest = new Hono();

// Proxy all /missions/* to mission-service
rest.all("/missions/*", async (c) => {
  const path = c.req.path.replace("/v1", "");  // /v1/missions/xxx -> /v1/missions/xxx
  const url = `${MISSION_SERVICE_URL}/v1${path.startsWith("/missions") ? path : "/missions" + path}`;

  const init: RequestInit = {
    method: c.req.method,
    headers: { "Content-Type": "application/json" },
  };

  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.text();
  }

  try {
    const res = await fetch(url, init);
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return c.json({ error: "Mission service unavailable", detail: String(err) }, 502);
  }
});

// Dashboard aggregate endpoint
rest.get("/dashboard", async (c) => {
  const RUNTIME_URL = process.env.RUNTIME_MANAGER_URL || "http://runtime-manager:4002";

  try {
    // Fetch missions
    const missionsRes = await fetch(`${MISSION_SERVICE_URL}/v1/missions`);
    const allMissions = missionsRes.ok ? await missionsRes.json() as Array<Record<string, unknown>> : [];

    // Fetch sessions
    const sessionsRes = await fetch(`${RUNTIME_URL}/sessions`);
    const allSessions = sessionsRes.ok ? await sessionsRes.json() as Array<Record<string, unknown>> : [];

    const activeMissions = allMissions.filter((m) => m.status === "RUNNING").length;
    const completedMissions = allMissions.filter((m) => m.status === "COMPLETED").length;
    const failedMissions = allMissions.filter((m) => m.status === "FAILED").length;
    const runningSessions = allSessions.filter((s) => s.state === "RUNNING").length;
    const staleSessions = allSessions.filter((s) => s.state === "STALE").length;

    return c.json({
      stats: {
        activeMissions,
        completedMissions,
        failedMissions,
        totalMissions: allMissions.length,
        runningSessions,
        staleSessions,
        totalSessions: allSessions.length,
      },
      recentMissions: allMissions.slice(-10).reverse(),
      activeSessions: allSessions.filter((s) => s.state !== "CLOSED"),
    });
  } catch (err) {
    return c.json({ error: "Dashboard data unavailable", detail: String(err) }, 502);
  }
});

// Proxy /sessions/* to runtime-manager
rest.all("/sessions/*", async (c) => {
  const RUNTIME_URL = process.env.RUNTIME_MANAGER_URL || "http://runtime-manager:4002";
  const path = c.req.path.replace("/v1", "");
  try {
    const res = await fetch(`${RUNTIME_URL}${path}`);
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return c.json({ error: "Runtime manager unavailable" }, 502);
  }
});

// Health aggregation
rest.get("/health/all", async (c) => {
  const services = [
    { name: "mission-service", url: MISSION_SERVICE_URL },
    { name: "runtime-manager", url: process.env.RUNTIME_MANAGER_URL || "http://runtime-manager:4002" },
    { name: "review-service", url: process.env.REVIEW_SERVICE_URL || "http://review-service:4006" },
    { name: "knowledge-service", url: process.env.KNOWLEDGE_SERVICE_URL || "http://knowledge-service:4007" },
  ];

  const results: Record<string, string> = {};
  for (const svc of services) {
    try {
      const res = await fetch(`${svc.url}/health`, { signal: AbortSignal.timeout(3000) });
      results[svc.name] = res.ok ? "ok" : "error";
    } catch {
      results[svc.name] = "unreachable";
    }
  }

  return c.json(results);
});

export { rest as restRoutes };
