"use client";

import { useState } from "react";
import { KNOWLEDGE_URL } from "@/lib/config";
import { EmptyState } from "@/components/ui/empty-state";
import type { DebtCheckResponse } from "@/types";

const summaryCards: Array<keyof DebtCheckResponse["summary"]> = [
  "total",
  "missing_crosslinks",
  "missing_hub",
  "orphan_docs",
  "broken_links",
  "stale_docs",
];

const debtStyles: Record<string, string> = {
  missing_crosslink: "text-yellow-300 bg-yellow-900/30",
  missing_hub: "text-blue-300 bg-blue-900/30",
  orphan_doc: "text-purple-300 bg-purple-900/30",
  broken_link: "text-red-300 bg-red-900/30",
  stale_doc: "text-orange-300 bg-orange-900/30",
};

const debtIcons: Record<string, string> = {
  missing_crosslink: "↔",
  missing_hub: "⌘",
  orphan_doc: "◌",
  broken_link: "✕",
  stale_doc: "◷",
};

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function KnowledgeDebtPage() {
  const [basePath, setBasePath] = useState(".");
  const [result, setResult] = useState<DebtCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const seedDoc = basePath.endsWith(".md") ? basePath : "README.md";
      const response = await fetch(`${KNOWLEDGE_URL}/v1/post-k/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basePath, modifiedDocs: [seedDoc] }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as DebtCheckResponse;
      setResult(payload);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Failed to run debt check");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border border-white/[0.06] bg-neutral-950 p-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Knowledge Debt</h1>
          <p className="mt-1 text-sm text-neutral-500">Run an integrity check against the knowledge document set.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto">
          <input
            type="text"
            value={basePath}
            onChange={(event) => setBasePath(event.target.value)}
            className="min-w-64 rounded-lg border border-white/[0.1] bg-black px-4 py-2 text-sm text-white outline-none focus:border-blue-500/50"
            placeholder="Base path (e.g., ./docs or .)"
          />
          <button
            type="button"
            onClick={runCheck}
            disabled={loading}
            className="rounded-lg border border-white/[0.1] bg-white/[0.06] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Running..." : "Run Check"}
          </button>
        </div>
      </div>
      <p className="text-xs text-neutral-500">
        Compatibility note: the current API requires at least one seed document, so directory scans use
        `README.md` when `basePath` is not a markdown file.
      </p>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {result && (
        <>
          <div
            className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold ${
              result.passed
                ? "border-green-800 bg-green-950/40 text-green-300"
                : "border-red-800 bg-red-950/40 text-red-300"
            }`}
          >
            {result.passed ? "✓ Passed" : "✗ Failed"}
          </div>

          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            {summaryCards.map((key) => (
              <div key={key} className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
                <p className="text-xs uppercase tracking-wide text-neutral-500">{formatLabel(key)}</p>
                <p className="mt-2 text-2xl font-semibold text-white">{result.summary[key]}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <p className="text-sm text-neutral-500">Each issue below explains where documentation integrity is breaking and what needs attention.</p>
            {result.debts.map((debt, index) => (
              <article key={`${debt.path}-${index}`} className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex rounded px-2 py-1 text-xs font-medium ${
                          debtStyles[debt.type] ?? "bg-white/[0.06] text-neutral-300"
                        }`}
                      >
                        {debtIcons[debt.type] ?? "•"} {formatLabel(debt.type)}
                      </span>
                      <span className="text-sm text-neutral-400">{debt.path}</span>
                    </div>
                    <p className="text-sm leading-6 text-neutral-300">{debt.description}</p>
                  </div>
                </div>
              </article>
            ))}
            {result.debts.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/[0.06] py-10 text-center text-sm text-neutral-500">
                No knowledge debt items were returned.
              </div>
            )}
          </div>
        </>
      )}

      {!result && !loading && !error && (
        <EmptyState
          title="No debt report yet"
          description="Click 'Run Check' to scan your documentation for missing cross-links, broken references, orphan documents, and stale content."
        />
      )}
    </div>
  );
}
