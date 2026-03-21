import { fetchDashboard } from "@/lib/api";

export async function StatusCards() {
  let stats = { activeMissions: 0, completedMissions: 0, totalMissions: 0, runningSessions: 0, staleSessions: 0, totalSessions: 0, failedMissions: 0 };

  try {
    const data = await fetchDashboard();
    stats = data.stats;
  } catch {}

  const cards = [
    { label: "Active Missions", value: stats.activeMissions, color: "text-blue-400" },
    { label: "Completed", value: stats.completedMissions, color: "text-green-400" },
    { label: "Total Missions", value: stats.totalMissions, color: "text-white" },
    { label: "Running Sessions", value: stats.runningSessions, color: "text-cyan-400" },
    { label: "Stale Sessions", value: stats.staleSessions, color: "text-yellow-400" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <p className="text-sm text-gray-400">{card.label}</p>
          <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}
