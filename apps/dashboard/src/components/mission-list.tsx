import type { Mission } from "@/types";
import { StatusBadge } from "@/components/ui/status-badge";
import Link from "next/link";

export function MissionList({ missions }: { missions: Mission[] }) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Recent Missions</h2>
        <Link href="/missions" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
          View all &rarr;
        </Link>
      </div>
      {missions.length === 0 ? (
        <p className="text-gray-500">No missions yet</p>
      ) : (
        <div className="space-y-2">
          {missions.map((m) => (
            <Link key={m.id} href={`/missions/${m.id}`} className="block">
              <div className="flex items-center justify-between p-3 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.title}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(m.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <StatusBadge status={m.priority} />
                  <StatusBadge status={m.status} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
