import { fetchDashboard } from "@/lib/api";
import { StatusCards } from "@/components/status-cards";
import { WorkflowPipeline } from "@/components/workflow-pipeline";
import { KnowledgePanel } from "@/components/knowledge-panel";
import { MissionList } from "@/components/mission-list";
import { ActiveSessions } from "@/components/active-sessions";

export default async function DashboardPage() {
  let data;
  try {
    data = await fetchDashboard();
  } catch {
    data = null;
  }

  const stats = data?.stats ?? {
    activeMissions: 0, completedMissions: 0, failedMissions: 0,
    totalMissions: 0, runningSessions: 0, staleSessions: 0,
    totalSessions: 0, knowledgeEntries: 0, knowledgeTopics: 0,
    knowledgeLastUpdated: null,
  };

  const pipeline = data?.pipelineStats ?? {
    preK: 0, dispatched: 0, executing: 0, postK: 0,
    review: 0, completed: 0, failed: 0,
  };

  return (
    <div className="space-y-6">
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
        <MissionList />
        <ActiveSessions />
      </div>
    </div>
  );
}
