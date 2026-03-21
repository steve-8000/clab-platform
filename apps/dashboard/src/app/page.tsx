"use client";

import { useDashboard } from "@/hooks/use-dashboard";
import { StatusCards } from "@/components/status-cards";
import { WorkflowPipeline } from "@/components/workflow-pipeline";
import { KnowledgePanel } from "@/components/knowledge-panel";
import { MissionList } from "@/components/mission-list";
import { ActiveSessions } from "@/components/active-sessions";
import { DashboardSkeleton } from "@/components/ui/skeleton";

const DEFAULT_STATS = {
  activeMissions: 0, completedMissions: 0, failedMissions: 0,
  totalMissions: 0, runningSessions: 0, staleSessions: 0,
  totalSessions: 0, knowledgeEntries: 0, knowledgeTopics: 0,
  knowledgeLastUpdated: null,
};

const DEFAULT_PIPELINE = {
  preK: 0, dispatched: 0, executing: 0, postK: 0,
  review: 0, completed: 0, failed: 0,
};

function secondsAgo(date: Date | null): string {
  if (!date) return "";
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 1) return "just now";
  return `${secs}s ago`;
}

export default function DashboardPage() {
  const { data, error, isLoading, lastUpdated } = useDashboard();

  if (isLoading && !data) {
    return <DashboardSkeleton />;
  }

  const stats = data?.stats ?? DEFAULT_STATS;
  const pipeline = data?.pipelineStats ?? DEFAULT_PIPELINE;

  return (
    <div className="space-y-6">
      {/* Last updated indicator */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-100">Dashboard</h2>
        <div className="flex items-center gap-3">
          {error && (
            <span className="text-xs text-red-400 bg-red-900/30 px-2 py-1 rounded">
              {error}
            </span>
          )}
          {lastUpdated && (
            <span className="text-xs text-gray-500">
              Last updated: {secondsAgo(lastUpdated)}
            </span>
          )}
        </div>
      </div>

      <StatusCards stats={stats} />
      <WorkflowPipeline pipeline={pipeline} />
      <KnowledgePanel
        entries={data?.recentKnowledge ?? []}
        insights={data?.recentInsights ?? []}
        stats={{
          knowledgeEntries: stats.knowledgeEntries,
          knowledgeTopics: stats.knowledgeTopics,
          knowledgeLastUpdated: stats.knowledgeLastUpdated,
        }}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MissionList missions={data?.recentMissions ?? []} />
        <ActiveSessions sessions={data?.activeSessions ?? []} />
      </div>
    </div>
  );
}
