import { z } from "zod";

// ============================================================
// mission_create
// ============================================================
export const MissionCreateInput = z.object({
  workspaceId: z.string(),
  title: z.string(),
  request: z.string(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).default("NORMAL"),
});
export const MissionCreateOutput = z.object({
  missionId: z.string(),
  status: z.string(),
});

// ============================================================
// mission_plan
// ============================================================
export const MissionPlanInput = z.object({
  missionId: z.string(),
});
export const MissionPlanOutput = z.object({
  planId: z.string(),
  waveCount: z.number().int(),
  taskCount: z.number().int(),
});

// ============================================================
// mission_status
// ============================================================
export const MissionStatusInput = z.object({
  missionId: z.string(),
});
export const MissionStatusOutput = z.object({
  missionId: z.string(),
  status: z.string(),
  title: z.string(),
  progress: z.object({
    totalTasks: z.number().int(),
    completedTasks: z.number().int(),
    failedTasks: z.number().int(),
    runningTasks: z.number().int(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ============================================================
// mission_abort
// ============================================================
export const MissionAbortInput = z.object({
  missionId: z.string(),
  reason: z.string().optional(),
});
export const MissionAbortOutput = z.object({
  missionId: z.string(),
  status: z.string(),
  abortedTasks: z.number().int(),
});

// ============================================================
// task_dispatch
// ============================================================
export const TaskDispatchInput = z.object({
  missionId: z.string(),
  role: z.string(),
  title: z.string(),
  instruction: z.string(),
  expectedOutputs: z.array(z.string()).optional(),
  waveId: z.string().optional(),
});
export const TaskDispatchOutput = z.object({
  taskId: z.string(),
  status: z.string(),
});

// ============================================================
// task_list
// ============================================================
export const TaskListInput = z.object({
  missionId: z.string().optional(),
  status: z.string().optional(),
  role: z.string().optional(),
});
export const TaskListOutput = z.object({
  tasks: z.array(
    z.object({
      taskId: z.string(),
      title: z.string(),
      role: z.string(),
      status: z.string(),
      missionId: z.string(),
    }),
  ),
});

// ============================================================
// task_retry
// ============================================================
export const TaskRetryInput = z.object({
  taskId: z.string(),
});
export const TaskRetryOutput = z.object({
  taskId: z.string(),
  status: z.string(),
  retryCount: z.number().int(),
});

// ============================================================
// task_review
// ============================================================
export const TaskReviewInput = z.object({
  taskId: z.string(),
  verdict: z.enum(["APPROVED", "REJECTED", "NEEDS_REVISION"]),
  feedback: z.string().optional(),
});
export const TaskReviewOutput = z.object({
  taskId: z.string(),
  status: z.string(),
  verdict: z.string(),
});

// ============================================================
// wave_list
// ============================================================
export const WaveListInput = z.object({
  missionId: z.string(),
});
export const WaveListOutput = z.object({
  waves: z.array(
    z.object({
      waveId: z.string(),
      index: z.number().int(),
      status: z.string(),
      taskCount: z.number().int(),
    }),
  ),
});

// ============================================================
// wave_release_next
// ============================================================
export const WaveReleaseNextInput = z.object({
  missionId: z.string(),
});
export const WaveReleaseNextOutput = z.object({
  waveId: z.string(),
  index: z.number().int(),
  status: z.string(),
  releasedTasks: z.number().int(),
});

// ============================================================
// wave_pause
// ============================================================
export const WavePauseInput = z.object({
  waveId: z.string(),
});
export const WavePauseOutput = z.object({
  waveId: z.string(),
  status: z.string(),
});

// ============================================================
// session_list
// ============================================================
export const SessionListInput = z.object({
  workspaceId: z.string().optional(),
  state: z.string().optional(),
});
export const SessionListOutput = z.object({
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      role: z.string(),
      engine: z.string(),
      state: z.string(),
      workspaceId: z.string(),
    }),
  ),
});

// ============================================================
// session_rebind
// ============================================================
export const SessionRebindInput = z.object({
  sessionId: z.string(),
});
export const SessionRebindOutput = z.object({
  sessionId: z.string(),
  state: z.string(),
});

// ============================================================
// session_interrupt
// ============================================================
export const SessionInterruptInput = z.object({
  sessionId: z.string(),
  reason: z.string().optional(),
});
export const SessionInterruptOutput = z.object({
  sessionId: z.string(),
  state: z.string(),
  interrupted: z.boolean(),
});

// ============================================================
// artifact_list
// ============================================================
export const ArtifactListInput = z.object({
  missionId: z.string().optional(),
  taskId: z.string().optional(),
  type: z.string().optional(),
});
export const ArtifactListOutput = z.object({
  artifacts: z.array(
    z.object({
      artifactId: z.string(),
      type: z.string(),
      uri: z.string(),
      missionId: z.string(),
      taskId: z.string().optional(),
      createdAt: z.string(),
    }),
  ),
});

// ============================================================
// artifact_read
// ============================================================
export const ArtifactReadInput = z.object({
  artifactId: z.string(),
});
export const ArtifactReadOutput = z.object({
  artifactId: z.string(),
  type: z.string(),
  uri: z.string(),
  content: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
});

// ============================================================
// decision_record
// ============================================================
export const DecisionRecordInput = z.object({
  missionId: z.string(),
  taskId: z.string().optional(),
  category: z.string(),
  summary: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()).default([]),
  consequences: z.array(z.string()).default([]),
});
export const DecisionRecordOutput = z.object({
  decisionId: z.string(),
  category: z.string(),
  summary: z.string(),
});

// ============================================================
// decision_list
// ============================================================
export const DecisionListInput = z.object({
  missionId: z.string(),
  category: z.string().optional(),
});
export const DecisionListOutput = z.object({
  decisions: z.array(
    z.object({
      decisionId: z.string(),
      category: z.string(),
      summary: z.string(),
      createdAt: z.string(),
    }),
  ),
});

// ============================================================
// knowledge_search
// ============================================================
export const KnowledgeSearchInput = z.object({
  query: z.string(),
  limit: z.number().int().positive().default(10),
  tags: z.array(z.string()).optional(),
});
export const KnowledgeSearchOutput = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      topic: z.string(),
      content: z.string(),
      tags: z.array(z.string()),
      confidence: z.number(),
    }),
  ),
});

// ============================================================
// knowledge_store
// ============================================================
export const KnowledgeStoreInput = z.object({
  topic: z.string(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  source: z.enum(["MANUAL", "EXTRACTED", "DISTILLED"]).default("MANUAL"),
  missionId: z.string().optional(),
});
export const KnowledgeStoreOutput = z.object({
  id: z.string(),
  topic: z.string(),
  stored: z.boolean(),
});

// ============================================================
// approval_list
// ============================================================
export const ApprovalListInput = z.object({
  missionId: z.string().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});
export const ApprovalListOutput = z.object({
  approvals: z.array(
    z.object({
      approvalId: z.string(),
      missionId: z.string(),
      taskId: z.string().optional(),
      gateType: z.string(),
      requestedAction: z.string(),
      status: z.string(),
      requestedAt: z.string(),
    }),
  ),
});

// ============================================================
// approval_resolve
// ============================================================
export const ApprovalResolveInput = z.object({
  approvalId: z.string(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().optional(),
});
export const ApprovalResolveOutput = z.object({
  approvalId: z.string(),
  status: z.string(),
  resolvedAt: z.string(),
});

// ============================================================
// dashboard_snapshot
// ============================================================
export const DashboardSnapshotInput = z.object({
  workspaceId: z.string(),
});
export const DashboardSnapshotOutput = z.object({
  workspaceId: z.string(),
  activeMissions: z.number().int(),
  totalTasks: z.number().int(),
  runningTasks: z.number().int(),
  completedTasks: z.number().int(),
  failedTasks: z.number().int(),
  activeSessions: z.number().int(),
  pendingApprovals: z.number().int(),
  recentDecisions: z.number().int(),
});

// ============================================================
// health_summary
// ============================================================
export const HealthSummaryInput = z.object({});
export const HealthSummaryOutput = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  services: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      latencyMs: z.number().optional(),
    }),
  ),
  uptime: z.number(),
  version: z.string(),
});
