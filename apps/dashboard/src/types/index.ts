// -- Mission & Plan types --

export type MissionStatus =
  | "DRAFT"
  | "PLANNED"
  | "RUNNING"
  | "REVIEWING"
  | "COMPLETED"
  | "FAILED"
  | "ABORTED";

export type MissionPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export type TaskStatus =
  | "QUEUED"
  | "ASSIGNED"
  | "RUNNING"
  | "NEEDS_REVIEW"
  | "SUCCEEDED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED";

export type WaveStatus =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED";

export type SessionState =
  | "IDLE"
  | "BOUND"
  | "RUNNING"
  | "AWAITING_INPUT"
  | "STALE"
  | "LOST"
  | "CLOSED";

export type KnowledgeSource = "MANUAL" | "EXTRACTED" | "DISTILLED" | "IMPORTED";

export interface Task {
  id: string;
  description: string;
  role: string;
  engine: string;
  status: TaskStatus;
  result?: string;
  createdAt: string;
  completedAt?: string | null;
}

export interface Wave {
  id: string;
  index: number;
  status: WaveStatus;
  tasks: Task[];
  createdAt: string;
  completedAt?: string | null;
}

export interface Plan {
  id: string;
  waves: Wave[];
  createdAt: string;
}

export interface Mission {
  id: string;
  title: string;
  objective?: string;
  status: MissionStatus;
  priority: MissionPriority;
  workspaceId?: string;
  plan?: Plan;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface Session {
  id: string;
  role: string;
  engine: string;
  state: SessionState;
  missionId?: string;
  taskId?: string;
  lastHeartbeat: string | null;
  createdAt: string;
}

export interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  tags: string[];
  source: KnowledgeSource;
  confidence: number;
  missionId?: string;
  createdAt: string;
}

export interface Insight {
  id: string;
  topic: string;
  content: string;
  tags: string[];
  source: string;
  createdAt: string;
}

export interface PipelineStats {
  preK: number;
  dispatched: number;
  executing: number;
  postK: number;
  review: number;
  completed: number;
  failed: number;
}

export interface DashboardStats {
  activeMissions: number;
  completedMissions: number;
  failedMissions: number;
  totalMissions: number;
  runningSessions: number;
  staleSessions: number;
  totalSessions: number;
  knowledgeEntries: number;
  knowledgeTopics: number;
  knowledgeLastUpdated: string | null;
}

export interface DashboardData {
  stats: DashboardStats;
  recentMissions: Mission[];
  activeSessions: Session[];
  recentKnowledge: KnowledgeEntry[];
  recentInsights: Insight[];
  pipelineStats: PipelineStats;
}
