import { z } from "zod";

export const ToolInvocationSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  taskRunId: z.string().uuid(),
  toolName: z.string(),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).optional(),
  status: z.enum(["pending", "running", "succeeded", "failed", "timeout"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
});
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;
