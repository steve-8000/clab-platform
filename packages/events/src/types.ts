import { z } from "zod";

// ---------------------------------------------------------------------------
// Mission events
// ---------------------------------------------------------------------------

export const MissionCreatedPayload = z.object({
  title: z.string(),
  description: z.string().optional(),
  createdBy: z.string(),
});

export const MissionPlannedPayload = z.object({
  waveCount: z.number().int(),
  taskCount: z.number().int(),
  planSummary: z.string().optional(),
});

export const MissionStartedPayload = z.object({
  startedAt: z.string().datetime(),
});

export const MissionReviewRequestedPayload = z.object({
  reason: z.string(),
  pendingItems: z.array(z.string()).optional(),
});

export const MissionCompletedPayload = z.object({
  summary: z.string(),
  totalElapsedMs: z.number(),
  totalCostUsd: z.number().optional(),
});

export const MissionFailedPayload = z.object({
  reason: z.string(),
  errorCode: z.string().optional(),
  retriable: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Wave events
// ---------------------------------------------------------------------------

export const WaveCreatedPayload = z.object({
  index: z.number().int(),
  taskCount: z.number().int(),
});

export const WaveReadyPayload = z.object({
  index: z.number().int(),
  resolvedDependencies: z.array(z.string()).optional(),
});

export const WaveStartedPayload = z.object({
  index: z.number().int(),
  startedAt: z.string().datetime(),
});

export const WaveCompletedPayload = z.object({
  index: z.number().int(),
  elapsedMs: z.number(),
  taskResults: z.array(z.object({
    taskId: z.string(),
    status: z.string(),
  })).optional(),
});

export const WaveFailedPayload = z.object({
  index: z.number().int(),
  reason: z.string(),
  failedTaskIds: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Task events
// ---------------------------------------------------------------------------

export const TaskCreatedPayload = z.object({
  title: z.string(),
  role: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
});

export const TaskAssignedPayload = z.object({
  assignedTo: z.string(),
  role: z.string().optional(),
});

export const TaskQueuedPayload = z.object({
  queuePosition: z.number().int().optional(),
  reason: z.string().optional(),
});

export const TaskRunStartedPayload = z.object({
  runIndex: z.number().int().optional(),
  startedAt: z.string().datetime(),
});

export const TaskRunHeartbeatPayload = z.object({
  runIndex: z.number().int().optional(),
  uptimeMs: z.number(),
  lastOutput: z.string().optional(),
});

export const TaskRunOutputStabilizedPayload = z.object({
  runIndex: z.number().int().optional(),
  stabilizedAt: z.string().datetime(),
  outputPreview: z.string().optional(),
});

export const TaskRunCompletedPayload = z.object({
  status: z.string(),
  summary: z.string(),
  changedFiles: z.array(z.string()),
  artifactIds: z.array(z.string()),
  metrics: z.object({
    elapsedMs: z.number(),
    tokenIn: z.number().int(),
    tokenOut: z.number().int(),
    costUsd: z.number(),
  }),
});

export const TaskRunFailedPayload = z.object({
  reason: z.string(),
  errorCode: z.string().optional(),
  exitCode: z.number().int().optional(),
  retriable: z.boolean().default(false),
});

export const TaskReviewRequestedPayload = z.object({
  reviewType: z.string(),
  summary: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
});

export const TaskReviewPassedPayload = z.object({
  reviewedBy: z.string(),
  comments: z.string().optional(),
});

export const TaskReviewFailedPayload = z.object({
  reviewedBy: z.string(),
  reason: z.string(),
  comments: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Session events
// ---------------------------------------------------------------------------

export const SessionCreatedPayload = z.object({
  agentId: z.string(),
  paneId: z.string().optional(),
});

export const SessionBoundPayload = z.object({
  boundTo: z.string(),
  paneId: z.string().optional(),
});

export const SessionHeartbeatPayload = z.object({
  uptimeMs: z.number(),
  memoryMb: z.number().optional(),
  lastOutput: z.string().optional(),
});

export const SessionStaleDetectedPayload = z.object({
  staleDurationMs: z.number(),
  lastOutput: z.string().optional(),
});

export const SessionRecoveredPayload = z.object({
  recoveryMethod: z.string(),
  downtimeMs: z.number(),
});

export const SessionLostPayload = z.object({
  reason: z.string(),
  lastSeenAt: z.string().datetime(),
});

export const SessionClosedPayload = z.object({
  reason: z.string().optional(),
  totalUptimeMs: z.number(),
});

// ---------------------------------------------------------------------------
// Artifact events
// ---------------------------------------------------------------------------

export const ArtifactEmittedPayload = z.object({
  artifactId: z.string(),
  kind: z.string(),
  path: z.string().optional(),
  sizeBytes: z.number().int().optional(),
});

export const ArtifactPromotedPayload = z.object({
  artifactId: z.string(),
  promotedTo: z.string(),
  promotedBy: z.string(),
});

export const ArtifactRejectedPayload = z.object({
  artifactId: z.string(),
  reason: z.string(),
  rejectedBy: z.string(),
});

// ---------------------------------------------------------------------------
// Decision events
// ---------------------------------------------------------------------------

export const DecisionRecordedPayload = z.object({
  decisionId: z.string(),
  title: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Knowledge events
// ---------------------------------------------------------------------------

export const KnowledgeExtractedPayload = z.object({
  knowledgeId: z.string(),
  kind: z.string(),
  content: z.string(),
  source: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Approval events
// ---------------------------------------------------------------------------

export const ApprovalRequestedPayload = z.object({
  approvalId: z.string(),
  reason: z.string(),
  requiredFrom: z.string().optional(),
  deadline: z.string().datetime().optional(),
});

export const ApprovalGrantedPayload = z.object({
  approvalId: z.string(),
  grantedBy: z.string(),
  comments: z.string().optional(),
});

export const ApprovalDeniedPayload = z.object({
  approvalId: z.string(),
  deniedBy: z.string(),
  reason: z.string(),
});

// ---------------------------------------------------------------------------
// Policy & Risk events
// ---------------------------------------------------------------------------

export const PolicyViolationDetectedPayload = z.object({
  policyId: z.string(),
  rule: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string(),
  violatingEntity: z.string().optional(),
});

export const RiskScoreComputedPayload = z.object({
  score: z.number().min(0).max(100),
  factors: z.array(z.object({
    name: z.string(),
    weight: z.number(),
    value: z.number(),
  })),
  recommendation: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Event type → payload mapping
// ---------------------------------------------------------------------------

export const EventPayloadSchemas = {
  "mission.created": MissionCreatedPayload,
  "mission.planned": MissionPlannedPayload,
  "mission.started": MissionStartedPayload,
  "mission.review_requested": MissionReviewRequestedPayload,
  "mission.completed": MissionCompletedPayload,
  "mission.failed": MissionFailedPayload,

  "wave.created": WaveCreatedPayload,
  "wave.ready": WaveReadyPayload,
  "wave.started": WaveStartedPayload,
  "wave.completed": WaveCompletedPayload,
  "wave.failed": WaveFailedPayload,

  "task.created": TaskCreatedPayload,
  "task.assigned": TaskAssignedPayload,
  "task.queued": TaskQueuedPayload,
  "task.run.started": TaskRunStartedPayload,
  "task.run.heartbeat": TaskRunHeartbeatPayload,
  "task.run.output_stabilized": TaskRunOutputStabilizedPayload,
  "task.run.completed": TaskRunCompletedPayload,
  "task.run.failed": TaskRunFailedPayload,
  "task.review_requested": TaskReviewRequestedPayload,
  "task.review_passed": TaskReviewPassedPayload,
  "task.review_failed": TaskReviewFailedPayload,

  "session.created": SessionCreatedPayload,
  "session.bound": SessionBoundPayload,
  "session.heartbeat": SessionHeartbeatPayload,
  "session.stale_detected": SessionStaleDetectedPayload,
  "session.recovered": SessionRecoveredPayload,
  "session.lost": SessionLostPayload,
  "session.closed": SessionClosedPayload,

  "artifact.emitted": ArtifactEmittedPayload,
  "artifact.promoted": ArtifactPromotedPayload,
  "artifact.rejected": ArtifactRejectedPayload,

  "decision.recorded": DecisionRecordedPayload,

  "knowledge.extracted": KnowledgeExtractedPayload,

  "approval.requested": ApprovalRequestedPayload,
  "approval.granted": ApprovalGrantedPayload,
  "approval.denied": ApprovalDeniedPayload,

  "policy.violation_detected": PolicyViolationDetectedPayload,
  "risk.score_computed": RiskScoreComputedPayload,
} as const;

export type EventType = keyof typeof EventPayloadSchemas;
