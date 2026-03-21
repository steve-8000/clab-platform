import type { PromptTemplate } from "./types.js";

export function renderPrompt(
  template: PromptTemplate,
  vars: Record<string, string>,
): { system: string; user: string } {
  let user = template.taskTemplate;
  for (const [key, value] of Object.entries(vars)) {
    user = user.replaceAll(`{${key}}`, value);
  }
  if (template.contextTemplate) {
    let ctx = template.contextTemplate;
    for (const [key, value] of Object.entries(vars)) {
      ctx = ctx.replaceAll(`{${key}}`, value);
    }
    user = `${user}\n\n${ctx}`;
  }
  return { system: template.systemPrompt, user };
}
