"use client";
import type { HealthData } from "@/types";
import { CardSkeleton } from "@/components/ui/skeleton";

interface StatCardProps {
  label: string;
  value: number | string;
  color?: string;
}

function StatCard({ label, value, color = "text-white" }: StatCardProps) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export function StatCards({ data }: { data: HealthData | null }) {
  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      <StatCard label="Threads" value={data.threads} color="text-blue-400" />
      <StatCard label="Runs" value={data.runs} color="text-indigo-400" />
      <StatCard label="Checkpoints" value={data.checkpoints} color="text-purple-400" />
      <StatCard label="Workers" value={data.workers} color="text-green-400" />
      <StatCard label="Interrupts" value={data.pending_interrupts} color={data.pending_interrupts > 0 ? "text-amber-400" : "text-neutral-400"} />
      <StatCard label="Status" value={data.status} color="text-green-400" />
    </div>
  );
}
