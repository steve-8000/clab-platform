import { z } from "zod";

export const AssembledContextSchema = z.object({
  systemPrompt: z.string(),
  task: z.string(),
  sourceRole: z.string().optional(),
  targetRole: z.string(),
  metadata: z.object({
    orgPath: z.array(z.string()),
    knowledgeScope: z.object({
      reads: z.array(z.string()),
      writes: z.array(z.string()),
    }),
    authorityLevel: z.enum(["c_level", "manager", "individual"]),
    subordinates: z.array(z.string()),
    preKnowledge: z.any().optional(),
    assembledAt: z.string().datetime(),
    sectionsIncluded: z.array(z.string()),
  }),
});
export type AssembledContext = z.infer<typeof AssembledContextSchema>;
