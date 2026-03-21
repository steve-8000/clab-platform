import { z } from "zod";

export const TraceEntrySchema = z.object({
  seq: z.number().int(),
  timestamp: z.string().datetime(),
  type: z.enum([
    "prompt_sent", "response_started", "response_chunk",
    "tool_called", "tool_result", "file_read", "file_written",
    "command_executed", "error_occurred", "completion_detected",
  ]),
  sessionId: z.string().uuid(),
  taskRunId: z.string().uuid().optional(),
  data: z.record(z.unknown()),
  durationMs: z.number().optional(),
});
export type TraceEntry = z.infer<typeof TraceEntrySchema>;

export const ExecutionTraceSchema = z.object({
  taskRunId: z.string().uuid(),
  sessionId: z.string().uuid(),
  entries: z.array(TraceEntrySchema),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  totalDurationMs: z.number().optional(),
  tokenCount: z.object({
    input: z.number().int().default(0),
    output: z.number().int().default(0),
  }).default({}),
});
export type ExecutionTrace = z.infer<typeof ExecutionTraceSchema>;
