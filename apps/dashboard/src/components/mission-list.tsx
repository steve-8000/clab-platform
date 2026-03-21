import { fetchDashboard } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-700",
  PLANNED: "bg-blue-700",
  RUNNING: "bg-cyan-700",
  COMPLETED: "bg-green-700",
  FAILED: "bg-red-700",
  CANCELLED: "bg-gray-600",
};

export async function MissionList() {
  let missions: Array<{ id: string; title: string; status: string; priority: string; createdAt: string; completedAt: string | null }> = [];

  try {
    const data = await fetchDashboard();
    missions = data.recentMissions;
  } catch {}

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <h2 className="text-lg font-semibold mb-4">Recent Missions</h2>
      {missions.length === 0 ? (
        <p className="text-gray-500">No missions yet</p>
      ) : (
        <div className="space-y-2">
          {missions.map((m) => (
            <div key={m.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{m.title}</p>
                <p className="text-xs text-gray-400">
                  {new Date(m.createdAt).toLocaleString()}
                  {m.completedAt && ` — completed ${new Date(m.completedAt).toLocaleString()}`}
                </p>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-mono ${STATUS_COLORS[m.status] || "bg-gray-700"}`}>
                {m.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
