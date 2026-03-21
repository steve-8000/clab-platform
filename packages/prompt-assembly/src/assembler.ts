import type { RoleDefinition } from "@clab/domain";
import type { ContextSection, AssemblyOptions } from "./types.js";

export class ContextAssembler {
  private sections: ContextSection[] = [];

  async assemble(
    role: RoleDefinition,
    options: AssemblyOptions
  ): Promise<{ systemPrompt: string; metadata: Record<string, unknown> }> {
    this.sections = [];

    // Stage 1: Company Rules
    this.addSection("company-rules", "Company Rules", this.buildCompanyRules(options));

    // Stage 2: Org Context
    this.addSection("org-context", "Organization Context", this.buildOrgContext(role));

    // Stage 3: Role Persona
    this.addSection("role-persona", "Your Role", this.buildPersona(role));

    // Stage 4: Authority Rules
    this.addSection("authority", "Authority & Permissions", this.buildAuthority(role));

    // Stage 5: Knowledge Scope
    this.addSection("knowledge-scope", "Knowledge Scope", this.buildKnowledgeScope(role));

    // Stage 6: Skills
    this.addSection("skills", "Skills & Capabilities", this.buildSkills(role));

    // Stage 7: Hub Docs (if pre-knowledge provided)
    if (options.preKnowledge) {
      this.addSection("pre-knowledge", "Relevant Context", this.buildPreKnowledge(options));
    }

    // Stage 8: Project Context
    this.addSection("project-context", "Project", this.buildProjectContext(options));

    // Stage 9: Team Management (conditional)
    if (role.authorityLevel !== "individual") {
      this.addSection("team", "Team Management", this.buildTeamContext(role, options), true);
    }

    // Stage 10: Code Root
    this.addSection("code-root", "Working Directory", this.buildCodeRoot(options));

    // Stage 11: Execution Rules
    this.addSection("execution-rules", "Execution Rules", this.buildExecutionRules(options));

    const systemPrompt = this.sections
      .map(s => `## ${s.title}\n\n${s.content}`)
      .join("\n\n---\n\n");

    return {
      systemPrompt,
      metadata: {
        sectionsIncluded: this.sections.map(s => s.id),
        roleId: role.id,
        authorityLevel: role.authorityLevel,
        assembledAt: new Date().toISOString(),
      },
    };
  }

  // Implement each build method with real content:

  private buildCompanyRules(options: AssemblyOptions): string {
    return [
      "Follow all company operating rules.",
      "Maintain code quality and consistency.",
      "Document decisions and rationale.",
      `Primary language: ${options.language === "ko" ? "Korean" : options.language === "ja" ? "Japanese" : "English"}`,
    ].join("\n");
  }

  private buildOrgContext(role: RoleDefinition): string {
    const reportLine = role.reportsTo ? `You report to: ${role.reportsTo}` : "You are the top-level orchestrator.";
    return `Role: ${role.name}\n${reportLine}\nAuthority: ${role.authorityLevel}`;
  }

  private buildPersona(role: RoleDefinition): string {
    return `You are the **${role.name}**.\n\nGoals:\n${role.goals.map(g => `- ${g}`).join("\n")}`;
  }

  private buildAuthority(role: RoleDefinition): string {
    const allowed = role.allowedActions.map(a => `- ${a}`).join("\n");
    const blocked = role.blockedActions.map(a => `- ${a}`).join("\n");
    return `### Allowed Actions\n${allowed}\n\n### Blocked Actions\n${blocked || "None"}`;
  }

  private buildKnowledgeScope(role: RoleDefinition): string {
    const reads = role.knowledgeScope.reads.map(p => `- ${p}`).join("\n") || "- All project files";
    const writes = role.knowledgeScope.writes.map(p => `- ${p}`).join("\n") || "- Within assigned scope";
    return `### Read Access\n${reads}\n\n### Write Access\n${writes}`;
  }

  private buildSkills(role: RoleDefinition): string {
    return `Required skills: ${role.requiredSkills.join(", ") || "General"}`;
  }

  private buildPreKnowledge(options: AssemblyOptions): string {
    if (!options.preKnowledge) return "No prior knowledge found.";
    const pk = options.preKnowledge;
    if (pk.relatedDocs?.length) {
      return `Found ${pk.relatedDocs.length} related documents:\n${pk.relatedDocs.map((d: { path: string; excerpt: string }) => `- ${d.path}: ${d.excerpt}`).join("\n")}`;
    }
    return "No related documents found.";
  }

  private buildProjectContext(options: AssemblyOptions): string {
    const parts = [];
    if (options.companyRoot) parts.push(`Company root: ${options.companyRoot}`);
    if (options.codeRoot) parts.push(`Code root: ${options.codeRoot}`);
    return parts.join("\n") || "No project context specified.";
  }

  private buildTeamContext(_role: RoleDefinition, options: AssemblyOptions): string {
    return `You have subordinates. When tasks fall outside your direct expertise, delegate to appropriate team members.\n\nTeam status: ${JSON.stringify(options.teamStatus || {})}`;
  }

  private buildCodeRoot(options: AssemblyOptions): string {
    return options.codeRoot ? `Working directory: ${options.codeRoot}` : "Working directory: current directory";
  }

  private buildExecutionRules(options: AssemblyOptions): string {
    return [
      "- Read only necessary files, do not scan entire repositories",
      "- If stuck after 3 attempts, stop and report the blocker",
      "- Commit changes with clear messages",
      "- Produce artifacts for every significant output",
      `- Respond in **${options.language === "ko" ? "Korean" : options.language === "ja" ? "Japanese" : "English"}**`,
    ].join("\n");
  }

  private addSection(id: string, title: string, content: string, conditional = false) {
    this.sections.push({ id, title, content, priority: this.sections.length, conditional });
  }
}
