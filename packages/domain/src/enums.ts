import { z } from "zod";

// --- MissionStatus ---
export const MissionStatus = z.enum([
  "DRAFT",
  "PLANNED",
  "RUNNING",
  "REVIEWING",
  "COMPLETED",
  "FAILED",
  "ABORTED",
]);
export type MissionStatus = z.infer<typeof MissionStatus>;

// --- MissionPriority ---
export const MissionPriority = z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
export type MissionPriority = z.infer<typeof MissionPriority>;

// --- WaveStatus ---
export const WaveStatus = z.enum([
  "PENDING",
  "READY",
  "RUNNING",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
]);
export type WaveStatus = z.infer<typeof WaveStatus>;

// --- TaskStatus ---
export const TaskStatus = z.enum([
  "QUEUED",
  "ASSIGNED",
  "RUNNING",
  "NEEDS_REVIEW",
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

// --- TaskRunStatus ---
export const TaskRunStatus = z.enum([
  "STARTING",
  "RUNNING",
  "AWAITING_INPUT",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "ABORTED",
]);
export type TaskRunStatus = z.infer<typeof TaskRunStatus>;

// --- SessionState ---
export const SessionState = z.enum([
  "IDLE",
  "BOUND",
  "RUNNING",
  "AWAITING_INPUT",
  "STALE",
  "LOST",
  "CLOSED",
]);
export type SessionState = z.infer<typeof SessionState>;

// --- Role ---
export const Role = z.enum([
  "PM",
  "OPERATIONS_REVIEWER",
  "BUILDER",
  "ARCHITECT",
  "STRATEGIST",
  "RESEARCH_ANALYST",
]);
export type Role = z.infer<typeof Role>;

// --- Engine ---
export const Engine = z.enum(["CODEX", "CLAUDE", "BROWSER"]);
export type Engine = z.infer<typeof Engine>;

// --- ArtifactType ---
export const ArtifactType = z.enum([
  "PATCH",
  "FILE",
  "TEST_REPORT",
  "SUMMARY",
  "SCREENSHOT",
  "LOG",
  "DECISION_NOTE",
  "KNOWLEDGE_NOTE",
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

// --- DecisionCategory ---
export const DecisionCategory = z.enum([
  "ARCHITECTURE",
  "IMPLEMENTATION",
  "POLICY",
  "RECOVERY",
  "REVIEW",
]);
export type DecisionCategory = z.infer<typeof DecisionCategory>;

// --- Capability ---
export const Capability = z.enum([
  "READ_CONTEXT",
  "WRITE_WORKSPACE",
  "EXEC_SHELL",
  "BROWSER_ACT",
  "NETWORK_EGRESS",
  "EXTERNAL_EFFECT",
  "APPROVE_HIGH_RISK",
]);
export type Capability = z.infer<typeof Capability>;

// --- ApprovalStatus ---
export const ApprovalStatus = z.enum(["PENDING", "GRANTED", "DENIED"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

// --- RiskLevel ---
export const RiskLevel = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

// --- MessageStatus (session-centric) ---
export const MessageStatusSchema = z.enum(["streaming", "done", "error", "awaiting_input", "interrupted"]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

// --- RoleStatus (session-centric) ---
export const RoleStatusSchema = z.enum(["idle", "working", "awaiting_input", "done"]);
export type RoleStatus = z.infer<typeof RoleStatusSchema>;

// --- ActivityEventType ---
export const ActivityEventTypeSchema = z.enum([
  "msg:start", "msg:done", "msg:error", "msg:awaiting_input",
  "text", "thinking", "tool:start", "tool:result",
  "dispatch:start", "dispatch:done",
  "turn:warning", "turn:limit",
  "prompt:assembled", "trace:response",
  "knowledge:pre_k", "knowledge:post_k",
]);
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;

// --- KnowledgeSource ---
export const KnowledgeSourceSchema = z.enum(["MANUAL", "EXTRACTED", "DISTILLED", "IMPORTED"]);
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;

// --- AuthorityLevel ---
export const AuthorityLevelSchema = z.enum(["c_level", "manager", "individual"]);
export type AuthorityLevel = z.infer<typeof AuthorityLevelSchema>;
