import { z } from "zod";

export const ContextSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  priority: z.number().default(0),
  conditional: z.boolean().default(false),
});
export type ContextSection = z.infer<typeof ContextSectionSchema>;

export const AssemblyOptionsSchema = z.object({
  companyRoot: z.string().optional(),
  codeRoot: z.string().optional(),
  roleId: z.string(),
  task: z.string(),
  sourceRole: z.string().optional(),
  preKnowledge: z.any().optional(),
  teamStatus: z.record(z.string()).optional(),
  language: z.enum(["en", "ko", "ja"]).default("en"),
  maxTokens: z.number().default(8000),
});
export type AssemblyOptions = z.infer<typeof AssemblyOptionsSchema>;
