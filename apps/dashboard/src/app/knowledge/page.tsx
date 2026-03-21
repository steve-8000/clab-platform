"use client";

import { useState, useEffect, useCallback } from "react";
import type { KnowledgeEntry, Insight, KnowledgeSource } from "@/types";
import { ListSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

const SOURCES: (KnowledgeSource | "ALL")[] = ["ALL", "MANUAL", "EXTRACTED", "DISTILLED"];

const SOURCE_COLORS: Record<string, string> = {
  MANUAL: "bg-blue-900 text-blue-300",
  EXTRACTED: "bg-purple-900 text-purple-300",
  DISTILLED: "bg-emerald-900 text-emerald-300",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function KnowledgePage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<KnowledgeSource | "ALL">("ALL");

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (sourceFilter !== "ALL") params.set("source", sourceFilter);
      const qs = params.toString();

      const [kRes, iRes] = await Promise.all([
        fetch(`/api/knowledge${qs ? `?${qs}` : ""}`),
        fetch("/api/insights"),
      ]);

      if (kRes.ok) {
        const data = await kRes.json();
        setEntries(Array.isArray(data) ? data : []);
      }
      if (iRes.ok) {
        const data = await iRes.json();
        setInsights(Array.isArray(data) ? data : []);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load knowledge");
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, sourceFilter]);

  useEffect(() => {
    setIsLoading(true);
    const debounce = setTimeout(fetchData, 300);
    return () => clearTimeout(debounce);
  }, [fetchData]);

  // Client-side filtering as fallback
  const filtered = entries.filter((e) => {
    if (sourceFilter !== "ALL" && e.source !== sourceFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!e.topic.toLowerCase().includes(q) && !e.content.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-100">Knowledge Base</h2>
        <span className="text-xs text-gray-500">{filtered.length} entries</span>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search knowledge..."
          className="flex-1 min-w-[200px] max-w-md bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Source:</span>
          <div className="flex gap-1">
            {SOURCES.map((s) => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  sourceFilter === s
                    ? "bg-blue-600/30 text-blue-300 border border-blue-600/40"
                    : "bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-300"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg p-3">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Knowledge entries */}
        <div className="lg:col-span-2">
          <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
            <span className="text-purple-400">{"\u25C6"}</span> Knowledge Entries
          </h3>
          {isLoading ? (
            <ListSkeleton rows={5} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={"\u25C6"}
              title="No knowledge entries"
              description={searchQuery ? "Try a different search term." : "No knowledge has been captured yet."}
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((entry) => (
                <div key={entry.id} className="bg-gray-900 rounded-lg border border-gray-800 p-4 hover:border-gray-700 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-semibold text-gray-100">{entry.topic}</p>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono shrink-0 ${SOURCE_COLORS[entry.source] || "bg-gray-700 text-gray-300"}`}>
                      {entry.source}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">{entry.content}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1.5 flex-wrap">
                      {entry.tags.map((tag) => (
                        <span key={tag} className="px-2 py-0.5 bg-gray-800 rounded text-[10px] text-gray-400 border border-gray-700">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-gray-500 shrink-0 ml-3">
                      <span>{Math.round(entry.confidence * 100)}% confidence</span>
                      <span>{timeAgo(entry.createdAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Insights sidebar */}
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
            <span className="text-amber-400">{"\u25C7"}</span> Insights
          </h3>
          {insights.length === 0 ? (
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <p className="text-sm text-gray-500">No insights extracted yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {insights.map((insight) => (
                <div key={insight.id} className="bg-gray-900 rounded-lg border border-gray-800 p-4 border-l-2 border-l-amber-600">
                  <p className="text-sm font-medium text-amber-300 mb-1">{insight.topic}</p>
                  <p className="text-xs text-gray-400 mb-2">{insight.content}</p>
                  <div className="flex items-center gap-2">
                    {insight.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 bg-gray-800 rounded text-[10px] text-gray-400">
                        {tag}
                      </span>
                    ))}
                    <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(insight.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
