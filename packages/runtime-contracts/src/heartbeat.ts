import { z } from "zod";

export const HeartbeatSchema = z.object({
  sessionId: z.string().uuid(),
  timestamp: z.string().datetime(),
  healthy: z.boolean(),
  outputHash: z.string().optional(),
  outputChanged: z.boolean().default(false),
  staleDurationMs: z.number().int().default(0),
  memoryUsageMb: z.number().optional(),
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

export const STALE_THRESHOLD_MS = 120_000; // 2 minutes
export const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

export function isStale(heartbeat: Heartbeat): boolean {
  return heartbeat.staleDurationMs > STALE_THRESHOLD_MS;
}

export function shouldAlert(heartbeat: Heartbeat): boolean {
  return !heartbeat.healthy || isStale(heartbeat);
}
