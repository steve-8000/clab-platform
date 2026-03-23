"use client";

import { useProfile } from "@/hooks/use-knowledge";

const statCards = [
  { key: "total_memories", label: "Total Memories", description: "all knowledge entries" },
  { key: "static_count", label: "Static Count", description: "permanent facts" },
  { key: "dynamic_count", label: "Dynamic Count", description: "recent context" },
  { key: "forgotten_count", label: "Forgotten", description: "expired or removed" },
] as const;

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function KnowledgeProfilePage() {
  const { profile, loading } = useProfile();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Knowledge Profile</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Memory profile split into permanent facts (static) and recent context (dynamic).
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <div key={card.key} className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
            <p className="text-sm text-neutral-400">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold text-white">
              {loading ? "…" : profile?.stats[card.key] ?? 0}
            </p>
            <p className="mt-2 text-xs text-neutral-500">{card.description}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-white/[0.06] bg-neutral-950 p-5">
          <h2 className="text-lg font-semibold text-white">Static Profile</h2>
          <p className="mt-1 text-sm text-neutral-500">Static memories define the long-lived facts this system should keep.</p>
          <div className="mt-4 space-y-4">
            {(profile?.static ?? []).map((entry) => (
              <article key={entry.id} className="rounded-lg border border-white/[0.06] bg-black/60 p-4">
                <h3 className="font-semibold text-white">{entry.topic}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-400">{entry.content}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(entry.tags ?? []).map((tag) => (
                    <span key={tag} className="rounded bg-white/[0.06] px-2 py-1 text-xs text-neutral-300">
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
            {!loading && (profile?.static.length ?? 0) === 0 && (
              <div className="rounded-lg border border-dashed border-white/[0.06] py-10 text-center text-sm text-neutral-500">
                No static memories yet. Mark knowledge entries as static (is_static: true) to build a permanent profile.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-white/[0.06] bg-neutral-950 p-5">
          <h2 className="text-lg font-semibold text-white">Dynamic Profile</h2>
          <p className="mt-1 text-sm text-neutral-500">Dynamic memories capture recent mission context and short-term working knowledge.</p>
          <div className="mt-4 space-y-4">
            {(profile?.dynamic ?? []).map((entry) => (
              <article key={entry.id} className="rounded-lg border border-white/[0.06] bg-black/60 p-4">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-semibold text-white">{entry.topic}</h3>
                  <span className="text-xs text-neutral-500">{formatDate(entry.created_at)}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-neutral-400">{entry.content}</p>
              </article>
            ))}
            {!loading && (profile?.dynamic.length ?? 0) === 0 && (
              <div className="rounded-lg border border-dashed border-white/[0.06] py-10 text-center text-sm text-neutral-500">
                No recent dynamic memories. Dynamic entries are created automatically from mission insights.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
