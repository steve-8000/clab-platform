import { z } from "zod";

export const KnowledgeDocumentSchema = z.object({
  id: z.string().uuid(),
  topic: z.string(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  source: z.enum(["MANUAL", "EXTRACTED", "DISTILLED", "IMPORTED"]),
  confidence: z.number().min(0).max(1).default(1.0),
  hubPath: z.string().optional(),
  crosslinks: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;

export const KnowledgeChunkSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  content: z.string(),
  embedding: z.array(z.number()).optional(),
  tokenCount: z.number().int().optional(),
  position: z.number().int(),
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;

export const KnowledgeEdgeSchema = z.object({
  id: z.string().uuid(),
  sourceDocId: z.string().uuid(),
  targetDocId: z.string().uuid(),
  relation: z.enum(["references", "extends", "contradicts", "supersedes", "related"]),
  strength: z.number().min(0).max(1).default(0.5),
});
export type KnowledgeEdge = z.infer<typeof KnowledgeEdgeSchema>;

export const EvidenceSchema = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid().optional(),
  taskRunId: z.string().uuid().optional(),
  documentId: z.string().uuid(),
  excerpt: z.string(),
  context: z.string().optional(),
  usedAt: z.string().datetime(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const InsightSchema = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid().optional(),
  content: z.string(),
  category: z.enum(["pattern", "decision", "risk", "optimization", "convention"]),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().uuid()).default([]),
  createdAt: z.string().datetime(),
});
export type Insight = z.infer<typeof InsightSchema>;

export const PreKnowledgeResultSchema = z.object({
  keywords: z.array(z.string()),
  relatedDocs: z.array(z.object({
    path: z.string(),
    relevanceScore: z.number(),
    excerpt: z.string(),
  })),
  warnings: z.array(z.string()).default([]),
  assembledAt: z.string().datetime(),
});
export type PreKnowledgeResult = z.infer<typeof PreKnowledgeResultSchema>;

export const PostKnowledgeDebtSchema = z.object({
  pass: z.boolean(),
  debts: z.array(z.object({
    type: z.enum(["missing_crosslink", "missing_hub", "orphan_doc", "broken_link", "stale_doc"]),
    path: z.string(),
    description: z.string(),
  })),
  modifiedDocs: z.array(z.string()).default([]),
  checkedAt: z.string().datetime(),
});
export type PostKnowledgeDebt = z.infer<typeof PostKnowledgeDebtSchema>;
