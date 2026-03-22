"use client";

import type { FormEvent, MouseEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRepositories } from "@/hooks/use-code-intel";
import { ci } from "@/lib/api";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { Repository } from "@/types";

export default function CodeIntelPage() {
  const { data: repositories = [], isLoading: loading, refresh } = useRepositories();
  const [repoUrl, setRepoUrl] = useState("");
  const [repoName, setRepoName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingRepoId, setDeletingRepoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!repoUrl.trim() || !repoName.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await ci.createRepository({
        url: repoUrl.trim(),
        name: repoName.trim(),
        default_branch: "main",
      });
      const newRepoId = response?.repository?.id;
      if (!newRepoId) {
        throw new Error("Repository registration returned no id");
      }
      await ci.triggerIndex(newRepoId, {});
      await refresh();
      setRepoUrl("");
      setRepoName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register repository");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (event: MouseEvent<HTMLButtonElement>, repoId: string) => {
    event.preventDefault();
    event.stopPropagation();

    setDeletingRepoId(repoId);
    setError(null);
    try {
      await ci.deleteRepository(repoId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete repository");
    } finally {
      setDeletingRepoId((current) => (current === repoId ? null : current));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Code Intelligence</h1>
      <p className="text-sm text-gray-500">
        Repository analysis, symbol graphs, and code insights
      </p>

      <form
        onSubmit={handleRegister}
        className="space-y-4 rounded-lg border border-gray-800 bg-gray-900 p-4"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(220px,1fr)_auto]">
          <input
            type="url"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/org/repo"
            className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-600 focus:outline-none"
          />
          <input
            type="text"
            value={repoName}
            onChange={(event) => setRepoName(event.target.value)}
            placeholder="repo-name"
            className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isSubmitting || !repoUrl.trim() || !repoName.trim()}
            className="rounded-lg border border-gray-800 bg-gray-950 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:border-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Registering..." : "Register & Index"}
          </button>
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </form>

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
            <div
              key={repo.id}
              className="relative rounded-lg border border-gray-800 bg-gray-900 p-4"
            >
              <button
                type="button"
                onClick={(event) => handleDelete(event, repo.id)}
                disabled={deletingRepoId === repo.id}
                className="absolute right-4 top-4 z-10 text-sm font-medium text-red-400 transition-colors hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingRepoId === repo.id ? "Deleting..." : "Delete"}
              </button>

              <Link href={`/code-intel/${repo.id}`} className="block pr-16">
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
