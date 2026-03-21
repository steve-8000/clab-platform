export async function StatusCards() {
  // TODO: fetch from API
  const stats = { activeMissions: 0, runningTasks: 0, staleSessions: 0, pendingApprovals: 0, costUsd24h: 0 };

  const cards = [
    { label: "Active Missions", value: stats.activeMissions, color: "text-blue-400" },
    { label: "Running Tasks", value: stats.runningTasks, color: "text-green-400" },
    { label: "Stale Sessions", value: stats.staleSessions, color: "text-yellow-400" },
    { label: "Pending Approvals", value: stats.pendingApprovals, color: "text-red-400" },
    { label: "Cost (24h)", value: `$${stats.costUsd24h.toFixed(2)}`, color: "text-purple-400" },
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
