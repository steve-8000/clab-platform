import { z } from "zod";

export const ActorSchema = z.object({
  kind: z.enum(["system", "user", "agent"]),
  id: z.string(),
});

export type Actor = z.infer<typeof ActorSchema>;

export const EventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  version: z.number().int().positive().default(1),
  occurredAt: z.string().datetime(),
  missionId: z.string().optional(),
  waveId: z.string().optional(),
  taskId: z.string().optional(),
  taskRunId: z.string().optional(),
  sessionId: z.string().optional(),
  workspaceId: z.string().optional(),
  actor: ActorSchema,
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
