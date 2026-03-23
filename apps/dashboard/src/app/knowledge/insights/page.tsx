"use client";

import { useState } from "react";
import { useInsightsList } from "@/hooks/use-knowledge";
import { EmptyState } from "@/components/ui/empty-state";
import type { KnowledgeEntry } from "@/types";

const filters = [
  { label: "All", value: undefined },
  { label: "Pattern", value: "pattern" },
  { label: "Decision", value: "decision" },
  { label: "Risk", value: "risk" },
] as const;

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function getInsightAccent(entry: KnowledgeEntry) {
  if (entry.topic.toLowerCase().startsWith("decision:")) return "border-blue-500";
  if (entry.topic.toLowerCase().startsWith("risk:")) return "border-red-500";
  return "border-purple-500";
}

export default function KnowledgeInsightsPage() {
  const [type, setType] = useState<string | undefined>(undefined);
  const { insights, loading } = useInsightsList(type);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Insights</h1>
          <p className="mt-1 text-sm text-neutral-500">Extracted patterns, decisions, and risks from prior work.</p>
        </div>
        <span className="text-sm text-neutral-500">{insights?.total ?? 0} items</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => {
          const active = filter.value === type || (!filter.value && !type);
          return (
            <button
              key={filter.label}
              type="button"
              onClick={() => setType(filter.value)}
              className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
                active
                  ? "border-white/[0.1] bg-white/[0.06] text-white"
                  : "border-white/[0.06] bg-neutral-950 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-lg border border-white/[0.06] bg-neutral-950" />
          ))}
        </div>
      ) : !insights || insights.insights.length === 0 ? (
        <EmptyState
          title="No insights found"
          description="No insights match this filter. Insights are automatically extracted from completed missions — run more missions to generate patterns, decisions, and risks."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <p className="text-sm text-neutral-500 md:col-span-2 lg:col-span-3">
            Use these extracted insights to spot repeat patterns, durable decisions, and emerging risks across missions.
          </p>
          {insights.insights.map((entry) => (
            <article
              key={entry.id}
              className={`rounded-lg border border-white/[0.06] border-l-4 ${getInsightAccent(entry)} bg-neutral-950 p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base font-semibold text-white">{entry.topic}</h2>
                <span className="shrink-0 text-xs text-neutral-500">{formatDate(entry.created_at)}</span>
              </div>
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-neutral-400">{entry.content}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(entry.tags ?? []).map((tag) => (
                  <span key={tag} className="rounded bg-white/[0.06] px-2 py-1 text-xs text-neutral-400">
                    {tag}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
