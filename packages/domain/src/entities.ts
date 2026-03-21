import { z } from "zod";
import {
  MissionStatus,
  MissionPriority,
  WaveStatus,
  TaskStatus,
  TaskRunStatus,
  SessionState,
  Role,
  Engine,
  ArtifactType,
  DecisionCategory,
  ApprovalStatus,
  Capability,
  RiskLevel,
} from "./enums.js";

// --- Mission ---
export const Mission = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  userRequest: z.string(),
  status: MissionStatus,
  priority: MissionPriority,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  closedAt: z.string().datetime().optional(),
});
export type Mission = z.infer<typeof Mission>;

// --- Plan ---
export const Plan = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  normalizedIntent: z.string(),
  assumptions: z.array(z.string()),
  constraints: z.array(z.string()),
  successCriteria: z.array(z.string()),
  riskLevel: RiskLevel,
  plannerVersion: z.string(),
  createdAt: z.string().datetime(),
});
export type Plan = z.infer<typeof Plan>;

// --- Wave ---
export const Wave = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  planId: z.string().uuid(),
  index: z.number().int().nonnegative(),
  status: WaveStatus,
  dependencyWaveIds: z.array(z.string().uuid()),
  concurrencyLimit: z.number().int().positive(),
});
export type Wave = z.infer<typeof Wave>;

// --- Task ---
export const Task = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  waveId: z.string().uuid(),
  role: Role,
  title: z.string(),
  instruction: z.string(),
  inputArtifacts: z.array(z.string().uuid()),
  expectedOutputs: z.array(ArtifactType),
  status: TaskStatus,
  retryCount: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
});
export type Task = z.infer<typeof Task>;

// --- TaskRun ---
export const TaskRun = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  engine: Engine,
  sessionId: z.string().uuid().optional(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  status: TaskRunStatus,
  exitReason: z.string().optional(),
  tokenIn: z.number().int().nonnegative().optional(),
  tokenOut: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type TaskRun = z.infer<typeof TaskRun>;

// --- AgentSession ---
export const AgentSession = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  role: Role,
  engine: Engine,
  paneId: z.string().optional(),
  runtimeNode: z.string().optional(),
  workingDir: z.string(),
  branchName: z.string().optional(),
  state: SessionState,
  leaseExpiresAt: z.string().datetime().optional(),
  lastHeartbeatAt: z.string().datetime().optional(),
});
export type AgentSession = z.infer<typeof AgentSession>;

// --- Artifact ---
export const Artifact = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  taskRunId: z.string().uuid().optional(),
  type: ArtifactType,
  uri: z.string(),
  mimeType: z.string().optional(),
  hash: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
});
export type Artifact = z.infer<typeof Artifact>;

// --- Decision ---
export const Decision = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  category: DecisionCategory,
  summary: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()),
  consequences: z.array(z.string()),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
});
export type Decision = z.infer<typeof Decision>;

// --- Approval ---
export const Approval = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  gateType: z.string(),
  requestedAction: z.string(),
  status: ApprovalStatus,
  reason: z.string().optional(),
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
});
export type Approval = z.infer<typeof Approval>;

// --- CapabilityLease ---
export const CapabilityLease = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  capability: Capability,
  scope: z.record(z.string(), z.unknown()),
  grantedBy: z.string(),
  expiresAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
});
export type CapabilityLease = z.infer<typeof CapabilityLease>;
