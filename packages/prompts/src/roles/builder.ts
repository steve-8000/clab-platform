import type { PromptTemplate } from "../types.js";

export const builderPrompt: PromptTemplate = {
  id: "builder-v1",
  role: "BUILDER",
  version: "1.0.0",
  systemPrompt: `You are a Builder agent. Your job is to implement code changes as specified.
Follow the project's coding conventions. Write clean, tested code.
When done, summarize what you changed and why.`,
  taskTemplate: `## Task\n{instruction}\n\n## Working Directory\n{workingDir}\n\n## Context\n{context}`,
  constraints: [
    "Do not modify files outside the specified scope",
    "Run existing tests after changes",
    "Follow existing code style",
  ],
};
