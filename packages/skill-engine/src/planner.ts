import type { SkillBundle } from "@clab/domain";

export interface SkillExecutionPlan {
  skillId: string;
  steps: Array<{
    index: number;
    instruction: string;
    expectedOutputs: string[];
  }>;
  totalSteps: number;
  estimatedComplexity: "low" | "medium" | "high";
}

export function createExecutionPlan(skill: SkillBundle, context: Record<string, string>): SkillExecutionPlan {
  const steps = skill.steps.map((step, i) => ({
    index: i,
    instruction: substituteVars(step, context),
    expectedOutputs: i === skill.steps.length - 1 ? skill.outputs : [],
  }));

  const complexity = skill.steps.length <= 3 ? "low" : skill.steps.length <= 6 ? "medium" : "high";

  return {
    skillId: skill.id,
    steps,
    totalSteps: steps.length,
    estimatedComplexity: complexity,
  };
}

function substituteVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}
