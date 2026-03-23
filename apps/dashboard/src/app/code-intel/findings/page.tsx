"use client";

import { useState } from "react";
import { useStructuralFindings } from "@/hooks/use-code-intel";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-900 text-red-300",
  high: "bg-orange-900 text-orange-300",
  medium: "bg-yellow-900 text-yellow-300",
  low: "bg-blue-900 text-blue-300",
};

export default function StructuralFindingsPage() {
  const [inputValue, setInputValue] = useState("");
  const [reviewId, setReviewId] = useState("");
  const { data: findings, isLoading: loading } = useStructuralFindings(reviewId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Structural Findings</h1>
        <p className="text-sm text-neutral-500">
          Code review structural analysis results
        </p>
      </div>

      <div className="flex gap-4">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter review ID..."
          className="flex-1 rounded-lg border border-white/[0.1] bg-neutral-950 px-4 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => setReviewId(inputValue.trim())}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Submit
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-white/[0.06]" />
          ))}
        </div>
      ) : findings.length === 0 && reviewId ? (
        <EmptyState
          title="No findings"
          description="No structural findings for this review"
        />
      ) : !reviewId ? (
        <EmptyState
          title="Enter a review ID"
          description="Look up structural findings from code reviews"
        />
      ) : (
        <div className="space-y-3">
          {findings.map((finding) => {
            const severityClass =
              SEVERITY_STYLES[finding.severity.toLowerCase()] ||
              "bg-white/[0.08] text-neutral-300";

            return (
              <div
                key={finding.id}
                className="space-y-2 rounded-lg border border-white/[0.06] bg-neutral-950 p-4"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${severityClass}`}
                  >
                    {finding.severity}
                  </span>
                  <StatusBadge status={finding.finding_type} />
                  <p className="font-medium text-neutral-200">{finding.title}</p>
                </div>

                <p className="text-sm text-neutral-400">{finding.description}</p>

                {finding.affected_symbols?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {finding.affected_symbols.map((symbol) => (
                      <span
                        key={symbol}
                        className="rounded bg-purple-900 px-2 py-0.5 text-xs font-mono text-purple-300"
                      >
                        {symbol}
                      </span>
                    ))}
                  </div>
                )}

                {finding.affected_files?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {finding.affected_files.map((file) => (
                      <span
                        key={file}
                        className="rounded bg-white/[0.06] px-2 py-0.5 text-xs font-mono text-neutral-400"
                      >
                        {file}
                      </span>
                    ))}
                  </div>
                )}

                {finding.recommendation && (
                  <div className="rounded border border-green-900 bg-green-950 p-3 text-sm text-green-300">
                    💡 {finding.recommendation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
