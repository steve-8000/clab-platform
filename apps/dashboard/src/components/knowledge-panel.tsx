import { KnowledgeEntry, InsightEntry } from "@/lib/api";

const SOURCE_COLORS: Record<string, string> = {
  MANUAL: "bg-blue-900 text-blue-300",
  EXTRACTED: "bg-purple-900 text-purple-300",
  DISTILLED: "bg-emerald-900 text-emerald-300",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function KnowledgeEntryCard({ entry }: { entry: KnowledgeEntry }) {
  return (
    <div className="p-3 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-sm font-medium text-gray-100 truncate">{entry.topic}</p>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 ${SOURCE_COLORS[entry.source] || "bg-gray-700 text-gray-300"}`}>
          {entry.source}
        </span>
      </div>
      <p className="text-xs text-gray-400 line-clamp-2 mb-2">{entry.content}</p>
      <div className="flex items-center justify-between">
        <div className="flex gap-1 flex-wrap">
          {entry.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 bg-gray-700 rounded text-[10px] text-gray-400">
              {tag}
            </span>
          ))}
          {entry.tags.length > 3 && (
            <span className="text-[10px] text-gray-500">+{entry.tags.length - 3}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {entry.confidence < 1 && (
            <span className="text-[10px] text-gray-500">{Math.round(entry.confidence * 100)}%</span>
          )}
          <span className="text-[10px] text-gray-600">{timeAgo(entry.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: InsightEntry }) {
  return (
    <div className="p-3 bg-gray-800 rounded-lg border-l-2 border-amber-600">
      <p className="text-sm font-medium text-amber-300 mb-1">{insight.topic}</p>
      <p className="text-xs text-gray-400 line-clamp-2">{insight.content}</p>
      <div className="flex items-center gap-2 mt-2">
        {insight.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="px-1.5 py-0.5 bg-gray-700 rounded text-[10px] text-gray-400">
            {tag}
          </span>
        ))}
        <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(insight.createdAt)}</span>
      </div>
    </div>
  );
}

export function KnowledgePanel({
  entries,
  insights,
  stats,
}: {
  entries: KnowledgeEntry[];
  insights: InsightEntry[];
  stats: { knowledgeEntries: number; knowledgeTopics: number; knowledgeLastUpdated: string | null };
}) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Agentic Knowledge Base</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {stats.knowledgeEntries} entries across {stats.knowledgeTopics} topics
            {stats.knowledgeLastUpdated && ` · updated ${timeAgo(stats.knowledgeLastUpdated)}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          <span className="text-xs text-purple-400">AKB</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Knowledge */}
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
            <span className="text-purple-400">◆</span> Recent Knowledge
          </h3>
          {entries.length === 0 ? (
            <p className="text-gray-600 text-sm p-3 bg-gray-800 rounded-lg">No knowledge entries yet</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {entries.map((entry) => (
                <KnowledgeEntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>

        {/* Insights */}
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
            <span className="text-amber-400">◇</span> Extracted Insights
          </h3>
          {insights.length === 0 ? (
            <p className="text-gray-600 text-sm p-3 bg-gray-800 rounded-lg">No insights extracted yet</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {insights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
