import type { Role, Engine } from "@clab/domain";

// ---------------------------------------------------------------------------
// Keyword → Role mapping
// ---------------------------------------------------------------------------

interface RoleKeywords {
  role: Role;
  keywords: string[];
}

const ROLE_RULES: RoleKeywords[] = [
  {
    role: "BUILDER",
    keywords: [
      "code", "implement", "build", "test", "fix", "refactor", "migrate",
      "write", "develop", "create file", "add feature", "debug", "patch",
      "lint", "format", "compile", "scaffold", "generate",
    ],
  },
  {
    role: "ARCHITECT",
    keywords: [
      "design", "architecture", "structure", "schema", "diagram", "pattern",
      "module", "api design", "interface", "protocol", "data model", "erd",
      "system design", "component",
    ],
  },
  {
    role: "RESEARCH_ANALYST",
    keywords: [
      "research", "document", "analyze", "investigate", "compare",
      "benchmark", "survey", "study", "explore", "audit", "report",
      "summarize", "gather",
    ],
  },
  {
    role: "OPERATIONS_REVIEWER",
    keywords: [
      "review", "verify", "qa", "validate", "inspect", "check", "approve",
      "quality", "compliance", "security review", "code review", "audit",
    ],
  },
  {
    role: "PM",
    keywords: [
      "plan", "prioritize", "decompose", "coordinate", "track", "status",
      "milestone", "roadmap", "backlog", "requirement", "scope", "estimate",
      "schedule",
    ],
  },
  {
    role: "STRATEGIST",
    keywords: [
      "strategy", "evaluate", "decide", "trade-off", "tradeoff", "assess",
      "option", "alternative", "recommend", "advise", "vision", "direction",
    ],
  },
];

// ---------------------------------------------------------------------------
// Engine selection per role
// ---------------------------------------------------------------------------

const ROLE_ENGINE_MAP: Record<Role, Engine> = {
  BUILDER: "CODEX",
  ARCHITECT: "CLAUDE",
  RESEARCH_ANALYST: "CLAUDE",
  OPERATIONS_REVIEWER: "CLAUDE",
  PM: "CLAUDE",
  STRATEGIST: "CLAUDE",
};

// ---------------------------------------------------------------------------
// RoleRouter
// ---------------------------------------------------------------------------

export interface RouteResult {
  role: Role;
  engine: Engine;
  confidence: number;
}

export class RoleRouter {
  /**
   * Analyze an instruction string and return the best-matching role + engine.
   * Uses keyword frequency scoring. Falls back to BUILDER if no strong match.
   */
  route(instruction: string): RouteResult {
    const lower = instruction.toLowerCase();

    let bestRole: Role = "BUILDER";
    let bestScore = 0;

    for (const rule of ROLE_RULES) {
      let score = 0;
      for (const kw of rule.keywords) {
        if (lower.includes(kw)) {
          // Longer keywords get more weight to reward specificity
          score += kw.length;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestRole = rule.role;
      }
    }

    // Confidence: normalize against a baseline of 20 chars of matching keywords
    const confidence = Math.min(bestScore / 20, 1);

    return {
      role: bestRole,
      engine: ROLE_ENGINE_MAP[bestRole],
      confidence,
    };
  }

  /**
   * Determine engine for a specific role.
   */
  engineForRole(role: Role): Engine {
    return ROLE_ENGINE_MAP[role];
  }
}
