const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://api-gateway:4000";

export interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  tags: string[];
  source: "MANUAL" | "EXTRACTED" | "DISTILLED";
  confidence: number;
  missionId?: string;
  createdAt: string;
}

export interface InsightEntry {
  id: string;
  topic: string;
  content: string;
  tags: string[];
  source: string;
  createdAt: string;
}

export interface PipelineStats {
  preK: number;
  dispatched: number;
  executing: number;
  postK: number;
  review: number;
  completed: number;
  failed: number;
}

export interface DashboardData {
  stats: {
    activeMissions: number;
    completedMissions: number;
    failedMissions: number;
    totalMissions: number;
    runningSessions: number;
    staleSessions: number;
    totalSessions: number;
    knowledgeEntries: number;
    knowledgeTopics: number;
    knowledgeLastUpdated: string | null;
  };
  recentMissions: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    createdAt: string;
    completedAt: string | null;
  }>;
  activeSessions: Array<{
    id: string;
    role: string;
    engine: string;
    state: string;
    lastHeartbeat: string | null;
    createdAt: string;
  }>;
  recentKnowledge: KnowledgeEntry[];
  recentInsights: InsightEntry[];
  pipelineStats: PipelineStats;
}

export async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch(`${API_URL}/v1/dashboard`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
