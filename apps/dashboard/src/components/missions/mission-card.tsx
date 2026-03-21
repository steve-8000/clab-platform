import type { Mission } from "@/types";
import { StatusBadge } from "@/components/ui/status-badge";
import Link from "next/link";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function MissionCard({ mission }: { mission: Mission }) {
  const taskCount = mission.plan?.waves.reduce((sum, w) => sum + w.tasks.length, 0) ?? 0;
  const waveCount = mission.plan?.waves.length ?? 0;

  return (
    <Link href={`/missions/${mission.id}`} className="block">
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 hover:border-gray-700 transition-colors">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-100 truncate">{mission.title}</h3>
            {mission.objective && (
              <p className="text-xs text-gray-400 mt-1 line-clamp-2">{mission.objective}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={mission.priority} />
            <StatusBadge status={mission.status} />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-3">
            {waveCount > 0 && (
              <span>{waveCount} wave{waveCount !== 1 ? "s" : ""}</span>
            )}
            {taskCount > 0 && (
              <span>{taskCount} task{taskCount !== 1 ? "s" : ""}</span>
            )}
          </div>
          <span>{timeAgo(mission.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}
