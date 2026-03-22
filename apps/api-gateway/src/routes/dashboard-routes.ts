import { Hono } from "hono";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://orchestrator:4001";
const RUNTIME_URL = process.env.RUNTIME_MANAGER_URL || "http://runtime-manager:4002";
const KNOWLEDGE_URL = process.env.KNOWLEDGE_SERVICE_URL || "http://knowledge-service:4007";

const dashboard = new Hono();

// Dashboard aggregate endpoint — collects stats from orchestrator, runtime-manager, knowledge-service
dashboard.get("/", async (c) => {
  const workspaceId = c.req.query("workspaceId");

  try {
    // Fetch missions from orchestrator
    const missionsRes = await fetch(`${ORCHESTRATOR_URL}/v1/missions`);
    const allMissions = missionsRes.ok ? await missionsRes.json() as Array<Record<string, unknown>> : [];

    const filtered = workspaceId
      ? allMissions.filter((m) => m.workspaceId === workspaceId)
      : allMissions;

    // Fetch sessions from runtime-manager
    const sessionsRes = await fetch(`${RUNTIME_URL}/sessions`);
    const allSessions = sessionsRes.ok ? await sessionsRes.json() as Array<Record<string, unknown>> : [];

    const activeMissions = filtered.filter((m) => m.status === "RUNNING").length;
    const completedMissions = filtered.filter((m) => m.status === "COMPLETED").length;
    const failedMissions = filtered.filter((m) => m.status === "FAILED").length;
    const runningSessions = allSessions.filter((s) => s.state === "RUNNING").length;
    const staleSessions = allSessions.filter((s) => s.state === "STALE").length;

    // Fetch knowledge stats
    let knowledgeStats = { totalEntries: 0, topics: 0, lastUpdated: null as string | null };
    let recentKnowledge: Array<Record<string, unknown>> = [];
    let recentInsights: Array<Record<string, unknown>> = [];
    try {
      const [kbStatusRes, kbSearchRes, insightsRes] = await Promise.all([
        fetch(`${KNOWLEDGE_URL}/v1/knowledge/status`, { signal: AbortSignal.timeout(3000) }),
        fetch(`${KNOWLEDGE_URL}/v1/knowledge/search?q=*&limit=10`, { signal: AbortSignal.timeout(3000) }),
        fetch(`${KNOWLEDGE_URL}/v1/insights`, { signal: AbortSignal.timeout(3000) }),
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
    } catch (err) {
      console.warn("Failed to fetch knowledge stats:", String(err));
    }

    // Pipeline stats
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

export { dashboard as dashboardRoutes };
