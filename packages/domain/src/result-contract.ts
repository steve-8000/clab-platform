import { z } from "zod";
import { ArtifactType } from "./enums.js";

export const TaskResultStatus = z.enum([
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "NEEDS_REVIEW",
  "TIMED_OUT",
  "ABORTED",
]);
export type TaskResultStatus = z.infer<typeof TaskResultStatus>;

export const TaskResultArtifact = z.object({
  type: ArtifactType,
  uri: z.string(),
});
export type TaskResultArtifact = z.infer<typeof TaskResultArtifact>;

export const TaskResultMetrics = z.object({
  elapsedMs: z.number().nonnegative(),
  tokenIn: z.number().int().nonnegative().optional(),
  tokenOut: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type TaskResultMetrics = z.infer<typeof TaskResultMetrics>;

export const TaskResult = z.object({
  status: TaskResultStatus,
  summary: z.string(),
  changedFiles: z.array(z.string()),
  artifacts: z.array(TaskResultArtifact),
  risks: z.array(z.string()),
  followups: z.array(z.string()),
  metrics: TaskResultMetrics,
});
export type TaskResult = z.infer<typeof TaskResult>;
