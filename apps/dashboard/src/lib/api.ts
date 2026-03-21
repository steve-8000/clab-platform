const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://api-gateway:4000";

export interface DashboardData {
  stats: {
    activeMissions: number;
    completedMissions: number;
    failedMissions: number;
    totalMissions: number;
    runningSessions: number;
    staleSessions: number;
    totalSessions: number;
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
}

export async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch(`${API_URL}/v1/dashboard`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
