import type { PromptTemplate } from "./types.js";
import { builderPrompt } from "./roles/builder.js";
import { architectPrompt } from "./roles/architect.js";
import { pmPrompt } from "./roles/pm.js";
import { strategistPrompt } from "./roles/strategist.js";
import { researchAnalystPrompt } from "./roles/research-analyst.js";
import { operationsReviewerPrompt } from "./roles/operations-reviewer.js";

const registry = new Map<string, PromptTemplate>();

function register(prompt: PromptTemplate) {
  registry.set(prompt.role, prompt);
}

register(builderPrompt);
register(architectPrompt);
register(pmPrompt);
register(strategistPrompt);
register(researchAnalystPrompt);
register(operationsReviewerPrompt);

export function getPrompt(role: string): PromptTemplate | undefined {
  return registry.get(role);
}

export function listPrompts(): PromptTemplate[] {
  return Array.from(registry.values());
}
