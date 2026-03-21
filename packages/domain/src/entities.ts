import { z } from "zod";
import {
  MissionStatus,
  MissionPriority,
  WaveStatus,
  TaskStatus,
  TaskRunStatus,
  SessionState,
  ApprovalStatus,
} from "./enums.js";

// --- Mission ---
export const Mission = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  objective: z.string(),
  status: MissionStatus,
  priority: MissionPriority,
  assumptions: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type Mission = z.infer<typeof Mission>;

// --- Plan ---
export const Plan = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  version: z.number().int().default(1),
  summary: z.string(),
  waveCount: z.number().int().default(0),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
});
export type Plan = z.infer<typeof Plan>;

// --- Wave ---
export const Wave = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  missionId: z.string().uuid(),
  ordinal: z.number().int().nonnegative(),
  label: z.string().optional(),
  status: WaveStatus,
  directive: z.string().optional(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});
export type Wave = z.infer<typeof Wave>;

// --- Task ---
export const Task = z.object({
  id: z.string().uuid(),
  waveId: z.string().uuid(),
  missionId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  role: z.string(),
  engine: z.string().default("CODEX"),
  status: TaskStatus,
  dependencies: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  maxRetries: z.number().int().nonnegative().default(2),
  timeoutMs: z.number().int().nonnegative().default(300_000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type Task = z.infer<typeof Task>;

// --- TaskRun ---
export const TaskRun = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  attempt: z.number().int().default(1),
  status: TaskRunStatus,
  exitCode: z.number().int().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  durationMs: z.number().int().optional(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
});
export type TaskRun = z.infer<typeof TaskRun>;

// --- AgentSession ---
export const AgentSession = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  role: z.string(),
  engine: z.string(),
  state: SessionState,
  paneId: z.string().optional(),
  pid: z.number().int().optional(),
  lastHeartbeat: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
  closedAt: z.string().datetime().optional(),
});
export type AgentSession = z.infer<typeof AgentSession>;

// --- Artifact ---
export const Artifact = z.object({
  id: z.string().uuid(),
  taskRunId: z.string().uuid(),
  missionId: z.string().uuid(),
  type: z.string(),
  path: z.string().optional(),
  content: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  checksum: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type Artifact = z.infer<typeof Artifact>;

// --- Decision ---
export const Decision = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  category: z.string(),
  title: z.string(),
  reasoning: z.string(),
  alternatives: z.array(z.string()).default([]),
  chosenOption: z.string(),
  riskLevel: z.string().default("LOW"),
  actorKind: z.string(),
  actorId: z.string(),
  createdAt: z.string().datetime(),
});
export type Decision = z.infer<typeof Decision>;

// --- Approval ---
export const Approval = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  requestedCapability: z.string(),
  reason: z.string(),
  status: ApprovalStatus,
  riskLevel: z.string().default("MEDIUM"),
  actorKind: z.string(),
  actorId: z.string(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type Approval = z.infer<typeof Approval>;

// --- CapabilityLease ---
export const CapabilityLease = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  capability: z.string(),
  grantedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
});
export type CapabilityLease = z.infer<typeof CapabilityLease>;
