import type { Session } from "@/types";
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

export function ActiveSessions({ sessions }: { sessions: Session[] }) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Sessions</h2>
        <Link href="/sessions" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
          View all &rarr;
        </Link>
      </div>
      {sessions.length === 0 ? (
        <p className="text-gray-500">No active sessions</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
              <div>
                <p className="text-sm font-medium">{s.role} <span className="text-gray-500">/ {s.engine}</span></p>
                <p className="text-xs text-gray-400">
                  {s.lastHeartbeat ? `Heartbeat: ${timeAgo(s.lastHeartbeat)}` : "No heartbeat"}
                </p>
              </div>
              <StatusBadge status={s.state} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
