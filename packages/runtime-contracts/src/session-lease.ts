import { z } from "zod";

export const SessionLeaseSchema = z.object({
  leaseId: z.string().uuid(),
  sessionId: z.string().uuid(),
  taskRunId: z.string().uuid(),
  capabilities: z.array(z.string()),
  grantedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  renewalCount: z.number().int().default(0),
  maxRenewals: z.number().int().default(3),
});
export type SessionLease = z.infer<typeof SessionLeaseSchema>;

export function isLeaseExpired(lease: SessionLease): boolean {
  return new Date(lease.expiresAt) < new Date();
}

export function canRenewLease(lease: SessionLease): boolean {
  return lease.renewalCount < lease.maxRenewals;
}

export function renewLease(lease: SessionLease, durationMs: number): SessionLease {
  if (!canRenewLease(lease)) throw new Error("Max renewals exceeded");
  return {
    ...lease,
    expiresAt: new Date(Date.now() + durationMs).toISOString(),
    renewalCount: lease.renewalCount + 1,
  };
}
