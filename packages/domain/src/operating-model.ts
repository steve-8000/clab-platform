import { z } from "zod";

export const RoleDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  reportsTo: z.string().nullable(),
  goals: z.array(z.string()),
  allowedActions: z.array(z.string()),
  blockedActions: z.array(z.string()).default([]),
  requiredSkills: z.array(z.string()).default([]),
  defaultEngine: z.enum(["CODEX", "CLAUDE", "BROWSER"]),
  reviewPolicy: z.enum(["none", "optional", "mandatory"]).default("optional"),
  knowledgeScope: z.object({
    reads: z.array(z.string()).default([]),
    writes: z.array(z.string()).default([]),
  }).default({}),
  authorityLevel: z.enum(["c_level", "manager", "individual"]).default("individual"),
});
export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;

export const SkillBundleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  inputs: z.array(z.string()).default([]),
  steps: z.array(z.string()),
  outputs: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  version: z.string().default("1.0.0"),
});
export type SkillBundle = z.infer<typeof SkillBundleSchema>;

export const RuleBundleSchema = z.object({
  id: z.string(),
  name: z.string(),
  conditions: z.array(z.string()),
  requires: z.array(z.record(z.string())).default([]),
  denies: z.array(z.string()).default([]),
  priority: z.number().default(0),
});
export type RuleBundle = z.infer<typeof RuleBundleSchema>;

export const ProjectContextSchema = z.object({
  id: z.string(),
  name: z.string(),
  brief: z.string(),
  constraints: z.array(z.string()).default([]),
  codeRoot: z.string().optional(),
  companyRoot: z.string().optional(),
  assets: z.array(z.string()).default([]),
});
export type ProjectContext = z.infer<typeof ProjectContextSchema>;

export const CompanyPolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  rules: z.array(RuleBundleSchema).default([]),
  approvalGates: z.array(z.string()).default([]),
  version: z.string().default("1.0.0"),
});
export type CompanyPolicy = z.infer<typeof CompanyPolicySchema>;
