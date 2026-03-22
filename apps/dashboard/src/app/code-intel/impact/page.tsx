"use client";

import { useState } from "react";
import { useRepositories, useImpact } from "@/hooks/use-code-intel";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

function CountBadge({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
      {count}
    </span>
  );
}

export default function ImpactAnalysisPage() {
  const [selectedRepo, setSelectedRepo] = useState("");
  const [target, setTarget] = useState("");
  const { repositories, loading: repositoriesLoading } = useRepositories();
  const { impact, loading, analyze } = useImpact(selectedRepo || null, target);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Impact Analysis</h1>
        <p className="text-sm text-gray-500">
          Analyze the impact of changes to symbols and files
        </p>
      </div>

      <div className="flex gap-4 max-md:flex-col">
        <select
          value={selectedRepo}
          onChange={(event) => setSelectedRepo(event.target.value)}
          className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-2"
          disabled={repositoriesLoading}
        >
          <option value="">Select repository</option>
          {repositories.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.name}
            </option>
          ))}
        </select>

        <input
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="Enter symbol or file path"
          className="min-w-0 flex-1 rounded-lg border border-gray-800 bg-gray-900 px-4 py-2"
        />

        <button
          type="button"
          onClick={() => analyze()}
          className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-2 text-sm font-medium"
          disabled={!selectedRepo || !target.trim() || loading}
        >
          {loading ? "Running..." : "Run Analysis"}
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="h-28 animate-pulse rounded-lg bg-gray-900" />
          <div className="h-48 animate-pulse rounded-lg bg-gray-900" />
          <div className="h-40 animate-pulse rounded-lg bg-gray-900" />
        </div>
      ) : !impact ? (
        <EmptyState
          title="Run impact analysis"
          description="Select a repository and enter a target symbol or file to analyze"
        />
      ) : (
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">Overview</h2>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-gray-500">Target</p>
                  <p className="font-mono text-sm text-gray-200">{impact.target}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">Risk Score</p>
                  <p className="text-3xl font-bold text-gray-100">{impact.risk_score}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold">Direct Impacts</h2>
                <CountBadge count={impact.direct.length} />
              </div>
            </div>
            <div className="space-y-2">
              {impact.direct.length === 0 ? (
                <EmptyState title="No direct impacts" />
              ) : (
                impact.direct.map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-2"
                  >
                    <p className="font-mono text-sm text-gray-200">{item}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">Transitive Impacts</h2>
              <CountBadge count={impact.transitive.length} />
            </div>
            <div className="space-y-2">
              {impact.transitive.length === 0 ? (
                <EmptyState title="No transitive impacts" />
              ) : (
                impact.transitive.map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-2"
                  >
                    <p className="font-mono text-sm text-gray-200">{item}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">Related Tests</h2>
              <CountBadge count={impact.related_tests.length} />
            </div>
            <div className="space-y-2">
              {impact.related_tests.length === 0 ? (
                <EmptyState title="No related tests" />
              ) : (
                impact.related_tests.map((test, index) => (
                  <div
                    key={`${test}-${index}`}
                    className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-2"
                  >
                    <p className="text-sm text-gray-200">{test}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
