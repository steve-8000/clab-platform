import type { DashboardStats } from "@/types";

export function StatusCards({ stats }: { stats: DashboardStats }) {
  const cards = [
    { label: "Active Missions", value: stats.activeMissions, color: "text-blue-400", icon: "\u25B6" },
    { label: "Completed", value: stats.completedMissions, color: "text-green-400", icon: "\u2713" },
    { label: "Failed", value: stats.failedMissions, color: "text-red-400", icon: "\u2717" },
    { label: "Running Sessions", value: stats.runningSessions, color: "text-cyan-400", icon: "\u25C9" },
    { label: "Knowledge Entries", value: stats.knowledgeEntries, color: "text-purple-400", icon: "\u25C6" },
    { label: "Knowledge Topics", value: stats.knowledgeTopics, color: "text-indigo-400", icon: "\u25C7" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="bg-gray-900 rounded-lg p-4 border border-gray-800 hover:border-gray-700 transition-colors">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs ${card.color}`}>{card.icon}</span>
            <p className="text-xs text-gray-500 uppercase tracking-wide">{card.label}</p>
          </div>
          <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}
