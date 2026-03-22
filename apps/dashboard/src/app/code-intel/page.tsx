"use client";

import Link from "next/link";
import { useRepositories } from "@/hooks/use-code-intel";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { Repository } from "@/types";

export default function CodeIntelPage() {
  const { data: repositories = [], isLoading: loading } = useRepositories();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Code Intelligence</h1>
      <p className="text-sm text-gray-500">
        Repository analysis, symbol graphs, and code insights
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-800" />
          ))}
        </div>
      ) : repositories.length === 0 ? (
        <EmptyState
          title="No repositories"
          description="Register a repository to start code analysis"
        />
      ) : (
        <div className="space-y-2">
          {repositories.map((repo: Repository) => (
            <Link
              key={repo.id}
              href={`/code-intel/${repo.id}`}
              className="block rounded-lg border border-gray-800 bg-gray-900 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-gray-200">{repo.name}</p>
                <StatusBadge status={repo.status} />
              </div>

              <p className="mt-2 truncate text-xs text-gray-500">{repo.url}</p>

              <div className="mt-4 flex gap-4 text-xs text-gray-500">
                <span>🔤 {repo.symbol_count ?? 0} symbols</span>
                <span>🔗 {repo.relation_count ?? 0} relations</span>
                <span>
                  📅 Last indexed:{" "}
                  {repo.last_indexed_at
                    ? new Date(repo.last_indexed_at).toLocaleDateString()
                    : "Never"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
