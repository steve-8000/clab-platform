import { z } from "zod";

export const PromptTemplateSchema = z.object({
  id: z.string(),
  role: z.string(),
  version: z.string(),
  systemPrompt: z.string(),
  taskTemplate: z.string(),
  contextTemplate: z.string().optional(),
  constraints: z.array(z.string()).default([]),
});
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;
