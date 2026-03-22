"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  useHotspots,
  useRepoSummary,
  useSnapshots,
  useSymbolSearch,
} from "@/hooks/use-code-intel";

const KIND_OPTIONS = ["all", "function", "class", "interface", "variable", "type"] as const;

function getLineRange(lineNumber: number, metadata?: Record<string, unknown> | null) {
  const endLine = typeof metadata?.end_line === "number" ? metadata.end_line : lineNumber;
  return lineNumber > 0 ? `${lineNumber}-${endLine}` : "—";
}

function getSnapshotStatus(metadata?: Record<string, unknown> | null) {
  const status = metadata?.status;
  return typeof status === "string" ? status : "COMPLETED";
}

function getSnapshotMetric(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "number" ? value : 0;
}

export default function RepositoryDetailPage() {
  const params = useParams();
  const repoIdParam = params?.repoId;
  const repoId = typeof repoIdParam === "string" ? decodeURIComponent(repoIdParam) : "";
  const [query, setQuery] = useState("");
  const [symbolType, setSymbolType] = useState<(typeof KIND_OPTIONS)[number]>("all");

  const { data: summary, isLoading: summaryLoading } = useRepoSummary(repoId);
  const { data: symbols, isLoading: symbolsLoading } = useSymbolSearch(repoId, query, symbolType);
  const { data: snapshots } = useSnapshots(repoId);
  const { data: hotspots } = useHotspots(repoId);

  const sortedLanguages = useMemo(() => {
    if (!summary?.languages) return [];
    return Object.entries(summary.languages).sort((a, b) => b[1] - a[1]);
  }, [summary]);

  const totalLanguageCount = useMemo(
    () => sortedLanguages.reduce((sum, [, count]) => sum + count, 0),
    [sortedLanguages],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/code-intel">← Back to repositories</Link>
        <h1 className="text-2xl font-bold">Repository: {repoId}</h1>
      </div>

      <section className="space-y-6">
        {summaryLoading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-lg bg-gray-800" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <p className="text-sm text-gray-400">Files</p>
              <p className="mt-2 text-2xl font-bold">{summary?.total_files ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <p className="text-sm text-gray-400">Symbols</p>
              <p className="mt-2 text-2xl font-bold">{summary?.total_symbols ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <p className="text-sm text-gray-400">Relations</p>
              <p className="mt-2 text-2xl font-bold">{summary?.total_relations ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <p className="text-sm text-gray-400">Languages</p>
              <p className="mt-2 text-2xl font-bold">
                {summary ? Object.keys(summary.languages || {}).length : 0}
              </p>
            </div>
          </div>
        )}
      </section>

      {sortedLanguages.length > 0 && (
        <section className="space-y-6">
          <h2 className="text-2xl font-bold">Languages Distribution</h2>
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <div className="space-y-4">
              {sortedLanguages.map(([language, count]) => {
                const percentage = totalLanguageCount > 0 ? (count / totalLanguageCount) * 100 : 0;
                return (
                  <div key={language} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span>{language}</span>
                      <span className="text-sm text-gray-400">{count}</span>
                    </div>
                    <div className="h-2 rounded bg-gray-800">
                      <div
                        className="h-2 rounded bg-blue-600"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="space-y-6">
        <h2 className="text-2xl font-bold">Symbol Search</h2>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search symbols..."
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2"
          />
          <select
            value={symbolType}
            onChange={(event) => setSymbolType(event.target.value as (typeof KIND_OPTIONS)[number])}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2"
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="grid grid-cols-[minmax(0,1.2fr)_140px_minmax(0,1fr)_120px] gap-4 border-b border-gray-800 pb-2 text-sm text-gray-400">
            <span>name</span>
            <span>kind</span>
            <span>file_path</span>
            <span>line range</span>
          </div>

          {symbolsLoading ? (
            <div className="space-y-2 pt-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-10 animate-pulse rounded-lg bg-gray-800" />
              ))}
            </div>
          ) : symbols.length === 0 ? (
            <div className="pt-4">
              <EmptyState title="Search symbols by name" />
            </div>
          ) : (
            <div>
              {symbols.map((symbol) => (
                <div
                  key={`${symbol.id}-${symbol.file_path}-${symbol.line_number}`}
                  className="grid grid-cols-[minmax(0,1.2fr)_140px_minmax(0,1fr)_120px] items-center gap-4 border-b border-gray-800 py-2 last:border-0"
                >
                  <span className="truncate">{symbol.name}</span>
                  <StatusBadge status={symbol.kind} />
                  <span className="truncate font-mono text-sm text-gray-400">{symbol.file_path}</span>
                  <span className="font-mono text-sm text-gray-400">
                    {getLineRange(symbol.line_number, symbol.metadata)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-2xl font-bold">Snapshots</h2>
        {snapshots.length === 0 ? (
          <EmptyState title="No snapshots yet" />
        ) : (
          <div className="space-y-3">
            {snapshots.map((snapshot) => (
              <div key={snapshot.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <p className="font-mono text-sm">
                      {(snapshot.commit_hash || snapshot.id).slice(0, 8)}
                    </p>
                    <div className="flex flex-wrap gap-4 text-sm text-gray-400">
                      <span>files {getSnapshotMetric(snapshot.metadata, "total_files")}</span>
                      <span>symbols {getSnapshotMetric(snapshot.metadata, "total_symbols")}</span>
                      <span>relations {getSnapshotMetric(snapshot.metadata, "total_relations")}</span>
                    </div>
                  </div>
                  <div className="space-y-2 text-right">
                    <StatusBadge status={getSnapshotStatus(snapshot.metadata)} />
                    <p className="text-sm text-gray-400">
                      {snapshot.snapshot_at ? new Date(snapshot.snapshot_at).toLocaleString() : "—"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-6">
        <h2 className="text-2xl font-bold">Hotspots</h2>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="grid grid-cols-[minmax(0,1.4fr)_110px_110px_90px_90px_110px] gap-4 border-b border-gray-800 pb-2 text-sm text-gray-400">
            <span>file_path</span>
            <span>symbol_count</span>
            <span>complexity</span>
            <span>fan_in</span>
            <span>fan_out</span>
            <span>metric_value</span>
          </div>

          {hotspots.length === 0 ? (
            <div className="pt-4">
              <EmptyState title="No hotspots detected" />
            </div>
          ) : (
            <div>
              {hotspots.map((hotspot, index) => (
                <div
                  key={`${hotspot.file_path || hotspot.file || "hotspot"}-${index}`}
                  className="grid grid-cols-[minmax(0,1.4fr)_110px_110px_90px_90px_110px] items-center gap-4 border-b border-gray-800 py-2 last:border-0"
                >
                  <span className="truncate font-mono text-sm text-gray-400">
                    {hotspot.file_path || hotspot.file || "—"}
                  </span>
                  <span>{hotspot.symbol_count ?? 0}</span>
                  <span>{hotspot.complexity ?? "—"}</span>
                  <span>{hotspot.fan_in ?? "—"}</span>
                  <span>{hotspot.fan_out ?? "—"}</span>
                  <span>{hotspot.metric_value ?? hotspot.symbol_count ?? "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
