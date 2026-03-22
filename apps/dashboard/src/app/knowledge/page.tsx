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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Knowledge Base</h1>
        {status && (
          <span className="text-xs text-gray-500">
            {status.total_entries || 0} entries
          </span>
        )}
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search knowledge..."
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-600 focus:outline-none"
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-800" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <EmptyState
          title={query ? "No results" : "Search knowledge base"}
          description={query ? `No entries matching "${query}"` : "Type a query to search stored knowledge, decisions, and patterns"}
        />
      ) : (
        <div className="space-y-3">
          {results.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-gray-800 bg-gray-900 p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-gray-200">{entry.topic}</h3>
                <span className="rounded bg-purple-900 px-2 py-0.5 text-xs text-purple-300">
                  {entry.source}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-400 line-clamp-3">{entry.content}</p>
              <div className="mt-2 flex gap-1">
                {(entry.tags || []).map((tag) => (
                  <span key={tag} className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
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
