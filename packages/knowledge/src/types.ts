import { z } from "zod";

export const KnowledgeEntrySchema = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid().optional(),
  topic: z.string(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  source: z.enum(["MANUAL", "EXTRACTED", "DISTILLED"]).default("MANUAL"),
  confidence: z.number().min(0).max(1).default(1.0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;
