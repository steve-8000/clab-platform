import { fetchDashboard } from "@/lib/api";

const STATE_COLORS: Record<string, string> = {
  IDLE: "text-gray-400",
  RUNNING: "text-green-400",
  STALE: "text-yellow-400",
  CLOSED: "text-gray-600",
};

export async function ActiveSessions() {
  let sessions: Array<{ id: string; role: string; engine: string; state: string; lastHeartbeat: string | null; createdAt: string }> = [];

  try {
    const data = await fetchDashboard();
    sessions = data.activeSessions;
  } catch {}

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <h2 className="text-lg font-semibold mb-4">Sessions</h2>
      {sessions.length === 0 ? (
        <p className="text-gray-500">No active sessions</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
              <div>
                <p className="text-sm font-medium">{s.role} <span className="text-gray-500">/ {s.engine}</span></p>
                <p className="text-xs text-gray-400">
                  {s.lastHeartbeat ? `Last heartbeat: ${new Date(s.lastHeartbeat).toLocaleString()}` : "No heartbeat"}
                </p>
              </div>
              <span className={`text-sm font-mono ${STATE_COLORS[s.state] || "text-gray-400"}`}>
                {s.state}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
