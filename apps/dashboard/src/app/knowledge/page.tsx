"use client";
import { useState } from "react";
import { useKnowledgeSearch, useKnowledgeStatus } from "@/hooks/use-knowledge";
import { EmptyState } from "@/components/ui/empty-state";

export default function KnowledgePage() {
  const [query, setQuery] = useState("");
  const { results, loading } = useKnowledgeSearch(query);
  const status = useKnowledgeStatus();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Knowledge Search</h1>
          <p className="mt-1 text-sm text-neutral-500">Search stored decisions, patterns, and insights from past missions.</p>
        </div>
        {status && <span className="text-xs text-neutral-500">{status.total_entries || 0} entries</span>}
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search knowledge..."
        className="w-full rounded-lg border border-white/[0.1] bg-neutral-950 px-4 py-2 text-sm text-white placeholder-neutral-600 focus:border-blue-500/50 focus:outline-none"
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-white/[0.06]" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <EmptyState
          title={query ? "No results" : "Search knowledge base"}
          description={
            query
              ? `No entries matching "${query}"`
              : "Enter a search query above to find stored knowledge entries — decisions, patterns, risks, and learnings extracted from prior work."
          }
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-500">Search results include saved mission learnings, operator decisions, and extracted patterns.</p>
          {results.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-neutral-200">{entry.topic}</h3>
                <span className="rounded bg-purple-900 px-2 py-0.5 text-xs text-purple-300">
                  {entry.source}
                </span>
              </div>
              <p className="mt-2 text-sm text-neutral-400 line-clamp-3">{entry.content}</p>
              <div className="mt-2 flex gap-1">
                {(entry.tags || []).map((tag) => (
                  <span key={tag} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-neutral-400">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
