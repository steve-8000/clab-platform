"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { useHotspots, useRepositories } from "@/hooks/use-code-intel";

const METRICS = ["complexity", "fan_in", "fan_out", "symbol_count"] as const;

function getMetricValue(
  hotspot: {
    complexity?: number;
    fan_in?: number;
    fan_out?: number;
    symbol_count?: number;
    metric_value?: number;
  },
  metric: (typeof METRICS)[number],
) {
  if (typeof hotspot.metric_value === "number") return hotspot.metric_value;
  if (metric === "complexity") return hotspot.complexity ?? 0;
  if (metric === "fan_in") return hotspot.fan_in ?? 0;
  if (metric === "fan_out") return hotspot.fan_out ?? 0;
  return hotspot.symbol_count ?? 0;
}

export default function HotspotsPage() {
  const [selectedRepo, setSelectedRepo] = useState("");
  const [metric, setMetric] = useState<(typeof METRICS)[number]>("complexity");
  const { data: repositories, isLoading: repositoriesLoading } = useRepositories();
  const { data: hotspots, isLoading: hotspotsLoading } = useHotspots(selectedRepo, metric);

  const loading = repositoriesLoading || hotspotsLoading;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Hotspots</h1>
        <p className="text-sm text-gray-400">
          Identify complexity hotspots and high-coupling areas
        </p>
      </div>

      <div className="flex gap-4">
        <select
          value={selectedRepo}
          onChange={(event) => setSelectedRepo(event.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        >
          <option value="" disabled>
            Select repository
          </option>
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>
              {repository.name}
            </option>
          ))}
        </select>

        <select
          value={metric}
          onChange={(event) => setMetric(event.target.value as (typeof METRICS)[number])}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        >
          {METRICS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="rounded-lg border border-gray-800 overflow-hidden">
          <div className="space-y-0">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse border-b border-gray-800 bg-gray-900 last:border-0" />
            ))}
          </div>
        </div>
      ) : !selectedRepo ? (
        <EmptyState
          title="Select a repository"
          description="Choose a repository to view its hotspots"
        />
      ) : hotspots.length === 0 ? (
        <EmptyState
          title="No hotspots"
          description="No hotspots detected for this repository"
        />
      ) : (
        <div className="rounded-lg border border-gray-800 overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1.6fr)_100px_110px_100px_100px_120px] bg-gray-900 border-b border-gray-800">
            <div className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">File Path</div>
            <div className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">Symbols</div>
            <div className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">Complexity</div>
            <div className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">Fan-in</div>
            <div className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">Fan-out</div>
            <div className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Metric Value</div>
          </div>

          {hotspots.map((hotspot, index) => {
            const metricValue = getMetricValue(hotspot, metric);
            return (
              <div
                key={`${hotspot.file_path || hotspot.file || "hotspot"}-${index}`}
                className="grid grid-cols-[minmax(0,1.6fr)_100px_110px_100px_100px_120px] border-b border-gray-800 last:border-0"
              >
                <div className="max-w-xs truncate px-4 py-2 font-mono text-sm text-gray-300">
                  {hotspot.file_path || hotspot.file || "—"}
                </div>
                <div className="px-4 py-2 text-center text-sm text-gray-400">
                  {hotspot.symbol_count ?? 0}
                </div>
                <div
                  className={`px-4 py-2 text-center text-sm ${
                    (hotspot.complexity ?? 0) > 10 ? "text-red-400" : "text-gray-400"
                  }`}
                >
                  {hotspot.complexity ?? "—"}
                </div>
                <div className="px-4 py-2 text-center text-sm text-gray-400">
                  {hotspot.fan_in ?? "—"}
                </div>
                <div className="px-4 py-2 text-center text-sm text-gray-400">
                  {hotspot.fan_out ?? "—"}
                </div>
                <div
                  className={`px-4 py-2 text-right text-sm font-medium ${
                    index < 3 ? "text-red-400" : "text-gray-400"
                  }`}
                >
                  {metricValue}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
