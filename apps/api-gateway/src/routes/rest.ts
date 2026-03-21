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

// Proxy /workspaces/* to mission-service
rest.all("/workspaces/*", async (c) => {
  const path = c.req.path.replace("/v1", "");
  const url = `${MISSION_SERVICE_URL}/v1${path}`;
  const init: RequestInit = {
    method: c.req.method,
    headers: { "Content-Type": "application/json" },
  };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.text();
  }
  try {
    const res = await fetch(url, init);
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return c.json({ error: "Mission service unavailable" }, 502);
  }
});

// Dashboard aggregate endpoint
rest.get("/dashboard", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const RUNTIME_URL = process.env.RUNTIME_MANAGER_URL || "http://runtime-manager:4002";

  try {
    // Fetch missions
    const missionsRes = await fetch(`${MISSION_SERVICE_URL}/v1/missions`);
    const allMissions = missionsRes.ok ? await missionsRes.json() as Array<Record<string, unknown>> : [];

    // Filter by workspaceId if provided
    const filtered = workspaceId
      ? allMissions.filter((m) => m.workspaceId === workspaceId)
      : allMissions;

    // Fetch sessions
    const sessionsRes = await fetch(`${RUNTIME_URL}/sessions`);
    const allSessions = sessionsRes.ok ? await sessionsRes.json() as Array<Record<string, unknown>> : [];

    const activeMissions = filtered.filter((m) => m.status === "RUNNING").length;
    const completedMissions = filtered.filter((m) => m.status === "COMPLETED").length;
    const failedMissions = filtered.filter((m) => m.status === "FAILED").length;
    const runningSessions = allSessions.filter((s) => s.state === "RUNNING").length;
    const staleSessions = allSessions.filter((s) => s.state === "STALE").length;

    // Fetch knowledge stats + recent entries + insights
    const KNOWLEDGE_SVC = process.env.KNOWLEDGE_SERVICE_URL || "http://knowledge-service:4007";
    let knowledgeStats = { totalEntries: 0, topics: 0, lastUpdated: null as string | null };
    let recentKnowledge: Array<Record<string, unknown>> = [];
    let recentInsights: Array<Record<string, unknown>> = [];
    try {
      const [kbStatusRes, kbSearchRes, insightsRes] = await Promise.all([
        fetch(`${KNOWLEDGE_SVC}/v1/knowledge/status`, { signal: AbortSignal.timeout(3000) }),
        fetch(`${KNOWLEDGE_SVC}/v1/knowledge/search?q=*&limit=10`, { signal: AbortSignal.timeout(3000) }),
        fetch(`${KNOWLEDGE_SVC}/v1/insights`, { signal: AbortSignal.timeout(3000) }),
      ]);
      if (kbStatusRes.ok) {
        const kbData = await kbStatusRes.json() as Record<string, unknown>;
        knowledgeStats = {
          totalEntries: kbData.totalEntries as number ?? 0,
          topics: kbData.topics as number ?? 0,
          lastUpdated: kbData.lastUpdated as string ?? null,
        };
      }
      if (kbSearchRes.ok) {
        recentKnowledge = (await kbSearchRes.json() as Array<Record<string, unknown>>).slice(0, 10);
      }
      if (insightsRes.ok) {
        recentInsights = (await insightsRes.json() as Array<Record<string, unknown>>).slice(0, 10);
      }
    } catch {}

    // Derive workflow pipeline stats from missions
    const pipelineStats = {
      preK: filtered.filter((m) => m.status === "PLANNED").length,
      dispatched: filtered.filter((m) => m.status === "RUNNING" && !(m as Record<string, unknown>).startedAt).length,
      executing: filtered.filter((m) => m.status === "RUNNING").length,
      postK: 0,
      review: filtered.filter((m) => m.status === "REVIEW" || m.status === "PENDING_REVIEW").length,
      completed: completedMissions,
      failed: failedMissions,
    };

    return c.json({
      stats: {
        activeMissions,
        completedMissions,
        failedMissions,
        totalMissions: filtered.length,
        runningSessions,
        staleSessions,
        totalSessions: allSessions.length,
        knowledgeEntries: knowledgeStats.totalEntries,
        knowledgeTopics: knowledgeStats.topics,
        knowledgeLastUpdated: knowledgeStats.lastUpdated,
      },
      recentMissions: filtered.slice(-10).reverse(),
      activeSessions: allSessions.filter((s) => s.state !== "CLOSED"),
      recentKnowledge,
      recentInsights,
      pipelineStats,
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

// Proxy /approvals to review-service directly via DB
rest.get("/approvals", async (c) => {
  const REVIEW_URL = process.env.REVIEW_SERVICE_URL || "http://review-service:4006";
  // For now, query the mission-service DB (approvals table is shared)
  const MISSION_URL = process.env.MISSION_SERVICE_URL || "http://mission-service:4001";
  try {
    // Use a direct DB query via a new review-service endpoint
    const res = await fetch(`${REVIEW_URL}/approvals`);
    if (res.ok) return new Response(await res.text(), { headers: { "Content-Type": "application/json" } });
    return c.json([]);
  } catch {
    return c.json([]);
  }
});

// Proxy /knowledge/* to knowledge-service
const KNOWLEDGE_URL = process.env.KNOWLEDGE_SERVICE_URL || "http://knowledge-service:4007";
rest.all("/knowledge/*", async (c) => {
  const path = c.req.path.replace("/v1", "");
  const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";
  const url = `${KNOWLEDGE_URL}/v1${path}${qs}`;
  const init: RequestInit = {
    method: c.req.method,
    headers: { "Content-Type": "application/json" },
  };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.text();
  }
  try {
    const res = await fetch(url, init);
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return c.json({ error: "Knowledge service unavailable", detail: String(err) }, 502);
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
