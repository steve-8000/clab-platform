import type { Wave } from "@/types";
import { StatusBadge } from "@/components/ui/status-badge";

const WAVE_STATUS_COLORS: Record<string, string> = {
  PENDING: "border-blue-700 bg-blue-900/20",
  RUNNING: "border-green-700 bg-green-900/20",
  COMPLETED: "border-emerald-700 bg-emerald-900/20",
  FAILED: "border-red-700 bg-red-900/20",
  CANCELLED: "border-gray-700 bg-gray-900/20",
};

const CONNECTOR_COLORS: Record<string, string> = {
  COMPLETED: "bg-emerald-600",
  RUNNING: "bg-green-600",
  FAILED: "bg-red-600",
  PENDING: "bg-gray-700",
  CANCELLED: "bg-gray-700",
};

export function WaveTimeline({ waves }: { waves: Wave[] }) {
  if (waves.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">No waves defined</p>
    );
  }

  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-2">
      {waves.map((wave, i) => (
        <div key={wave.id} className="flex items-start shrink-0">
          {/* Wave node */}
          <div className={`rounded-lg border-2 p-4 min-w-[140px] text-center ${WAVE_STATUS_COLORS[wave.status] || WAVE_STATUS_COLORS.PENDING}`}>
            <p className="text-xs text-gray-400 mb-1">Wave {wave.index + 1}</p>
            <StatusBadge status={wave.status} />
            <p className="text-xs text-gray-500 mt-2">
              {wave.tasks.length} task{wave.tasks.length !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Connector arrow */}
          {i < waves.length - 1 && (
            <div className="flex items-center self-center pt-2 px-1">
              <div className={`w-8 h-0.5 ${CONNECTOR_COLORS[wave.status] || "bg-gray-700"}`} />
              <div className={`w-0 h-0 border-t-[5px] border-b-[5px] border-l-[6px] border-transparent ${wave.status === "COMPLETED" ? "border-l-emerald-600" : wave.status === "RUNNING" ? "border-l-green-600" : "border-l-gray-700"}`} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
