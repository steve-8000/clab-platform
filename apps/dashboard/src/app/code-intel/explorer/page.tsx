"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { useGraphExplorer, useRepositories } from "@/hooks/use-code-intel";

const KIND_OPTIONS = ["all", "function", "class", "interface", "variable", "type"] as const;
const RELATION_OPTIONS = [
  "ALL",
  "IMPORTS",
  "CALLS",
  "EXTENDS",
  "IMPLEMENTS",
  "USES_TYPE",
  "PUBLISHES_EVENT",
  "CONSUMES_EVENT",
  "OWNS_TEST",
  "TRANSITIVE",
] as const;
const DEPTH_OPTIONS = [1, 2, 3] as const;

export default function GraphExplorerPage() {
  const { data: repositories, isLoading: repositoriesLoading } = useRepositories();
  const [selectedRepo, setSelectedRepo] = useState("");
  const [query, setQuery] = useState("");
  const [symbolType, setSymbolType] = useState<(typeof KIND_OPTIONS)[number]>("all");
  const [relationType, setRelationType] = useState<(typeof RELATION_OPTIONS)[number]>("ALL");
  const [depth, setDepth] = useState<(typeof DEPTH_OPTIONS)[number]>(2);
  const [changedOnly, setChangedOnly] = useState(false);
  const [packageFilter, setPackageFilter] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedRepo && repositories.length > 0) {
      setSelectedRepo(repositories[0].id);
    }
  }, [repositories, selectedRepo]);

  const explorer = useGraphExplorer(selectedRepo, {
    query,
    symbolType,
    relationType,
    depth,
    changedOnly,
  });

  useEffect(() => {
    if (packageFilter && !explorer.packages.some((item) => item.name === packageFilter)) {
      setPackageFilter(null);
    }
  }, [explorer.packages, packageFilter]);

  useEffect(() => {
    if (fileFilter && !explorer.files.some((item) => item.path === fileFilter)) {
      setFileFilter(null);
    }
  }, [explorer.files, fileFilter]);

  const visibleFiles = useMemo(
    () =>
      explorer.files.filter((item) => !packageFilter || item.packageName === packageFilter),
    [explorer.files, packageFilter],
  );

  const visibleSymbols = useMemo(
    () =>
      explorer.symbols.filter((item) => {
        if (packageFilter && item.packageName !== packageFilter) return false;
        if (fileFilter && item.file_path !== fileFilter) return false;
        return true;
      }),
    [explorer.symbols, fileFilter, packageFilter],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Graph Explorer</h1>
        <p className="text-sm text-neutral-500">
          Explore packages, files, and symbols progressively without rendering the full graph.
        </p>
      </div>

      <section className="rounded-xl border border-white/[0.06] bg-black p-4">
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_180px_180px_140px_auto]">
          <select
            value={selectedRepo}
            onChange={(event) => {
              setSelectedRepo(event.target.value);
              setPackageFilter(null);
              setFileFilter(null);
              explorer.clearSelection();
            }}
            className="rounded-lg border border-white/[0.06] bg-neutral-950 px-3 py-2 text-sm text-white"
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
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPackageFilter(null);
              setFileFilter(null);
              explorer.clearSelection();
            }}
            placeholder="Search symbol name or qualified name"
            className="rounded-lg border border-white/[0.06] bg-neutral-950 px-4 py-2 text-sm text-white"
          />

          <select
            value={symbolType}
            onChange={(event) => setSymbolType(event.target.value as (typeof KIND_OPTIONS)[number])}
            className="rounded-lg border border-white/[0.06] bg-neutral-950 px-3 py-2 text-sm text-white"
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select
            value={relationType}
            onChange={(event) =>
              setRelationType(event.target.value as (typeof RELATION_OPTIONS)[number])
            }
            className="rounded-lg border border-white/[0.06] bg-neutral-950 px-3 py-2 text-sm text-white"
          >
            {RELATION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select
            value={depth}
            onChange={(event) => setDepth(Number(event.target.value) as (typeof DEPTH_OPTIONS)[number])}
            className="rounded-lg border border-white/[0.06] bg-neutral-950 px-3 py-2 text-sm text-white"
          >
            {DEPTH_OPTIONS.map((option) => (
              <option key={option} value={option}>
                Depth {option}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-neutral-950 px-3 py-2 text-sm text-neutral-200">
            <input
              type="checkbox"
              checked={changedOnly}
              onChange={(event) => setChangedOnly(event.target.checked)}
            />
            Changed only
          </label>
        </div>
      </section>

      {!selectedRepo ? (
        <EmptyState
          title="Select a repository"
          description="Choose a repository to start drilling into its package and symbol graph."
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-xl border border-white/[0.06] bg-neutral-950">
              <div className="border-b border-white/[0.06] px-4 py-3">
                <p className="text-sm font-medium text-neutral-200">1. Packages</p>
                <p className="text-xs text-neutral-500">Top-level drill-down</p>
              </div>
              <div className="max-h-[520px] space-y-2 overflow-auto p-3">
                {explorer.searchLoading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-16 animate-pulse rounded-lg bg-white/[0.06]" />
                  ))
                ) : explorer.packages.length === 0 ? (
                  <EmptyState
                    title="No packages"
                    description="Enter a symbol query to load matching packages."
                  />
                ) : (
                  explorer.packages.map((pkg) => {
                    const active = packageFilter === pkg.name;
                    return (
                      <button
                        key={pkg.name}
                        type="button"
                        onClick={() => {
                          setPackageFilter(active ? null : pkg.name);
                          setFileFilter(null);
                        }}
                        className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                          active
                            ? "border-blue-700 bg-blue-950 text-blue-100"
                            : "border-white/[0.06] bg-black text-neutral-200 hover:border-white/[0.1]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate font-mono text-sm">{pkg.name}</p>
                          <span className="text-xs text-neutral-400">{pkg.files.size} files</span>
                        </div>
                        <p className="mt-2 text-xs text-neutral-500">
                          {pkg.symbolCount} symbols
                          {changedOnly ? `, ${pkg.changedCount} changed` : ""}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-xl border border-white/[0.06] bg-neutral-950">
              <div className="border-b border-white/[0.06] px-4 py-3">
                <p className="text-sm font-medium text-neutral-200">2. Files</p>
                <p className="text-xs text-neutral-500">Scoped to the selected package</p>
              </div>
              <div className="max-h-[520px] space-y-2 overflow-auto p-3">
                {visibleFiles.length === 0 ? (
                  <EmptyState
                    title="No files"
                    description={
                      packageFilter
                        ? "No files match the current package selection."
                        : "Select a package to narrow the file list."
                    }
                  />
                ) : (
                  visibleFiles.map((file) => {
                    const active = fileFilter === file.path;
                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => setFileFilter(active ? null : file.path)}
                        className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                          active
                            ? "border-emerald-700 bg-emerald-950 text-emerald-100"
                            : "border-white/[0.06] bg-black text-neutral-200 hover:border-white/[0.1]"
                        }`}
                      >
                        <p className="truncate font-mono text-sm">{file.path}</p>
                        <p className="mt-2 text-xs text-neutral-500">
                          {file.symbolCount} symbols
                          {changedOnly ? `, ${file.changedCount} changed` : ""}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-xl border border-white/[0.06] bg-neutral-950">
              <div className="border-b border-white/[0.06] px-4 py-3">
                <p className="text-sm font-medium text-neutral-200">3. Symbols</p>
                <p className="text-xs text-neutral-500">Select a symbol to inspect related nodes</p>
              </div>
              <div className="max-h-[520px] space-y-2 overflow-auto p-3">
                {visibleSymbols.length === 0 ? (
                  <EmptyState
                    title="No symbols"
                    description="Adjust the query or filters to load matching symbols."
                  />
                ) : (
                  visibleSymbols.map((symbol) => {
                    const active = explorer.selectedSymbol?.id === symbol.id;
                    return (
                      <button
                        key={`${symbol.id}-${symbol.file_path}-${symbol.line_number}`}
                        type="button"
                        onClick={() => explorer.setSelectedSymbol(symbol)}
                        className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                          active
                            ? "border-amber-700 bg-amber-950 text-amber-100"
                            : "border-white/[0.06] bg-black text-neutral-200 hover:border-white/[0.1]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate font-medium">{symbol.name}</p>
                          <StatusBadge status={symbol.kind} />
                        </div>
                        <p className="mt-2 truncate font-mono text-xs text-neutral-500">
                          {symbol.file_path}:{symbol.line_number}
                        </p>
                        {symbol.changed && (
                          <p className="mt-2 text-xs uppercase tracking-wide text-amber-300">
                            Changed
                          </p>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          </div>

          <aside className="rounded-xl border border-white/[0.06] bg-black">
            <div className="border-b border-white/[0.06] px-4 py-3">
              <p className="text-sm font-medium text-neutral-200">Inspector</p>
              <p className="text-xs text-neutral-500">Symbol details and filtered relations</p>
            </div>

            <div className="space-y-4 p-4">
              {!explorer.selectedSymbol ? (
                <EmptyState
                  title="No symbol selected"
                  description="Choose a symbol from the drill-down column to inspect it."
                />
              ) : explorer.inspectorLoading ? (
                <div className="space-y-3">
                  <div className="h-20 animate-pulse rounded-lg bg-white/[0.06]" />
                  <div className="h-40 animate-pulse rounded-lg bg-white/[0.06]" />
                </div>
              ) : (
                <>
                  <div className="space-y-2 rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-white">{explorer.selectedSymbol.name}</p>
                      <StatusBadge status={explorer.selectedSymbol.kind} />
                    </div>
                    <p className="font-mono text-xs text-neutral-500">
                      {explorer.selectedSymbol.fq_name || explorer.selectedSymbol.name}
                    </p>
                    <p className="font-mono text-xs text-neutral-500">
                      {explorer.selectedSymbol.file_path}:{explorer.selectedSymbol.line_number}
                    </p>
                    <p className="text-sm text-neutral-400">
                      Risk score: {explorer.inspector?.risk_score ?? 0}
                    </p>
                  </div>

                  <div className="space-y-3">
                    {explorer.related.length === 0 ? (
                      <EmptyState
                        title="No relations"
                        description="No related nodes matched the current relation and depth filters."
                      />
                    ) : (
                      explorer.related.map((group) => (
                        <section
                          key={group.relation}
                          className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-white">{group.relation}</p>
                            <span className="text-xs text-neutral-500">depth {group.depth}</span>
                          </div>
                          <div className="mt-3 space-y-2">
                            {group.items.map((item, index) => (
                              <div
                                key={`${group.relation}-${item}-${index}`}
                                className="rounded-md border border-white/[0.06] bg-black px-3 py-2 font-mono text-xs text-neutral-300"
                              >
                                {item}
                              </div>
                            ))}
                          </div>
                        </section>
                      ))
                    )}
                  </div>

                  {explorer.contextBundle && (
                    <section className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
                      <p className="text-sm font-medium text-white">Context Bundle</p>
                      <p className="mt-2 text-sm text-neutral-400">
                        {explorer.contextBundle.summary || "No summary available."}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-500">
                        <div className="rounded-md border border-white/[0.06] bg-black px-3 py-2">
                          Targets: {explorer.contextBundle.primary_targets.length}
                        </div>
                        <div className="rounded-md border border-white/[0.06] bg-black px-3 py-2">
                          Files: {explorer.contextBundle.related_files.length}
                        </div>
                        <div className="rounded-md border border-white/[0.06] bg-black px-3 py-2">
                          Tests: {explorer.contextBundle.related_tests.length}
                        </div>
                        <div className="rounded-md border border-white/[0.06] bg-black px-3 py-2">
                          Warnings: {explorer.contextBundle.warnings.length}
                        </div>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
