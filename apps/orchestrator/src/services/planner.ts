import { randomUUID } from "node:crypto";
import type { Role } from "@clab/domain";
import { createLogger } from "@clab/telemetry";
import { RoleRouter } from "./role-router.js";

const logger = createLogger("orchestrator:planner");
const router = new RoleRouter();

// ---------------------------------------------------------------------------
// Types for planning output
// ---------------------------------------------------------------------------

export interface PlannedTask {
  id: string;
  waveIndex: number;
  title: string;
  instruction: string;
  role: Role;
  engine: string;
  acceptanceCriteria: string[];
  maxRetries: number;
  timeoutMs: number;
}

export interface PlannedWave {
  id: string;
  index: number;
  label: string;
  directive: string;
  tasks: PlannedTask[];
}

export interface PlanResult {
  planId: string;
  summary: string;
  assumptions: string[];
  constraints: string[];
  waves: PlannedWave[];
}

// ---------------------------------------------------------------------------
// Keyword patterns for decomposition heuristics
// ---------------------------------------------------------------------------

const PHASE_PATTERNS: { label: string; directive: string; patterns: RegExp[] }[] = [
  {
    label: "Research & Analysis",
    directive: "Investigate requirements, analyze existing codebase, and gather context.",
    patterns: [/research/i, /analy[sz]/i, /investigat/i, /understand/i, /gather/i, /audit/i],
  },
  {
    label: "Architecture & Design",
    directive: "Design the solution architecture, define interfaces, and create schemas.",
    patterns: [/design/i, /architect/i, /schema/i, /structur/i, /plan/i, /model/i],
  },
  {
    label: "Implementation",
    directive: "Implement the solution according to the plan and design decisions.",
    patterns: [/implement/i, /build/i, /creat/i, /develop/i, /code/i, /write/i, /add/i, /scaffold/i],
  },
  {
    label: "Testing & Validation",
    directive: "Write tests, run validation, and ensure quality standards are met.",
    patterns: [/test/i, /validat/i, /verif/i, /check/i, /qa/i, /lint/i],
  },
  {
    label: "Review & Documentation",
    directive: "Review all changes, update documentation, and finalize deliverables.",
    patterns: [/review/i, /document/i, /finaliz/i, /clean/i, /polish/i],
  },
];

// ---------------------------------------------------------------------------
// MissionPlanner
// ---------------------------------------------------------------------------

export class MissionPlanner {
  /**
   * Analyze a mission objective and decompose it into waves and tasks.
   *
   * The planner uses keyword analysis to determine which phases (waves)
   * are relevant, then creates appropriate tasks within each wave with
   * role routing for each task.
   */
  async plan(
    missionId: string,
    objective: string,
    constraints: string[] = [],
  ): Promise<PlanResult> {
    logger.info("Planning mission", { missionId, objectiveLength: objective.length });

    const planId = randomUUID();
    const lower = objective.toLowerCase();

    // --- Step 1: Determine which phases apply ---
    const matchedPhases = this.matchPhases(lower);

    // If no specific phases matched, create a default 3-wave plan
    const phases = matchedPhases.length > 0
      ? matchedPhases
      : this.defaultPhases();

    // --- Step 2: Decompose objective into tasks per wave ---
    const waves: PlannedWave[] = [];
    const taskChunks = this.decomposeIntoTasks(objective);

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i]!;
      const waveTasks = this.assignTasksToWave(
        taskChunks,
        phase,
        i,
        missionId,
      );

      // Every wave gets at least one task
      if (waveTasks.length === 0) {
        waveTasks.push(this.createPhaseTask(phase, i));
      }

      waves.push({
        id: randomUUID(),
        index: i,
        label: phase.label,
        directive: phase.directive,
        tasks: waveTasks,
      });
    }

    // --- Step 3: Build plan summary ---
    const totalTasks = waves.reduce((sum, w) => sum + w.tasks.length, 0);
    const summary = `Decomposed into ${waves.length} wave(s) with ${totalTasks} task(s). ` +
      `Phases: ${waves.map((w) => w.label).join(" -> ")}.`;

    const assumptions = this.inferAssumptions(objective);

    logger.info("Plan complete", {
      missionId,
      planId,
      waveCount: waves.length,
      taskCount: totalTasks,
    });

    return {
      planId,
      summary,
      assumptions,
      constraints,
      waves,
    };
  }

  // -------------------------------------------------------------------------
  // Phase matching
  // -------------------------------------------------------------------------

  private matchPhases(lowerObjective: string) {
    return PHASE_PATTERNS.filter((phase) =>
      phase.patterns.some((p) => p.test(lowerObjective)),
    );
  }

  private defaultPhases() {
    return [
      {
        label: "Analysis",
        directive: "Analyze the request, identify requirements and constraints.",
        patterns: [] as RegExp[],
      },
      {
        label: "Implementation",
        directive: "Implement the requested changes.",
        patterns: [] as RegExp[],
      },
      {
        label: "Review",
        directive: "Review all changes and ensure quality.",
        patterns: [] as RegExp[],
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Task decomposition
  // -------------------------------------------------------------------------

  /**
   * Break an objective string into discrete task chunks.
   * Splits on sentence boundaries, bullet points, numbered lists, and "and" conjunctions.
   */
  private decomposeIntoTasks(objective: string): string[] {
    // Split on common delimiters
    const raw = objective
      .split(/(?:\.\s+|\n[-*]\s*|\n\d+[.)]\s*|\band\b(?=\s+(?:then|also|create|implement|add|build|write|test|review|design)))/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 10); // Filter out fragments

    // Deduplicate near-identical chunks
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const chunk of raw) {
      const key = chunk.toLowerCase().slice(0, 40);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(chunk);
      }
    }

    return unique.length > 0 ? unique : [objective];
  }

  /**
   * Assign task chunks to a wave based on keyword affinity with the phase.
   */
  private assignTasksToWave(
    allChunks: string[],
    phase: { label: string; directive: string; patterns: RegExp[] },
    waveIndex: number,
    _missionId: string,
  ): PlannedTask[] {
    const tasks: PlannedTask[] = [];

    for (const chunk of allChunks) {
      // Check if this chunk belongs in this phase
      const belongs = phase.patterns.length === 0 ||
        phase.patterns.some((p) => p.test(chunk));

      if (belongs) {
        const routed = router.route(chunk);
        tasks.push({
          id: randomUUID(),
          waveIndex,
          title: this.generateTitle(chunk),
          instruction: chunk,
          role: routed.role,
          engine: routed.engine,
          acceptanceCriteria: this.inferAcceptanceCriteria(chunk),
          maxRetries: 2,
          timeoutMs: this.estimateTimeout(routed.role),
        });
      }
    }

    return tasks;
  }

  /**
   * Create a single task that represents the entire phase.
   */
  private createPhaseTask(
    phase: { label: string; directive: string },
    waveIndex: number,
  ): PlannedTask {
    const routed = router.route(phase.directive);
    return {
      id: randomUUID(),
      waveIndex,
      title: phase.label,
      instruction: phase.directive,
      role: routed.role,
      engine: routed.engine,
      acceptanceCriteria: [`${phase.label} phase completed successfully`],
      maxRetries: 2,
      timeoutMs: this.estimateTimeout(routed.role),
    };
  }

  // -------------------------------------------------------------------------
  // Heuristic helpers
  // -------------------------------------------------------------------------

  private generateTitle(instruction: string): string {
    // Take the first ~60 chars, ending at a word boundary
    const truncated = instruction.slice(0, 60);
    const lastSpace = truncated.lastIndexOf(" ");
    const title = lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
    return title.replace(/[.,;:!?]+$/, "").trim();
  }

  private inferAcceptanceCriteria(instruction: string): string[] {
    const criteria: string[] = [];
    const lower = instruction.toLowerCase();

    if (/test/i.test(lower)) criteria.push("All tests pass");
    if (/implement|build|create|code|write/i.test(lower)) criteria.push("Code compiles without errors");
    if (/document/i.test(lower)) criteria.push("Documentation is complete and accurate");
    if (/review/i.test(lower)) criteria.push("Review feedback addressed");
    if (/design|architect/i.test(lower)) criteria.push("Design document produced");

    if (criteria.length === 0) {
      criteria.push("Task objective met");
    }

    return criteria;
  }

  private inferAssumptions(objective: string): string[] {
    const assumptions: string[] = [];
    const lower = objective.toLowerCase();

    if (/exist/i.test(lower)) {
      assumptions.push("Referenced existing code/systems are accessible");
    }
    if (/api|endpoint|service/i.test(lower)) {
      assumptions.push("Required APIs are available and documented");
    }
    if (/database|db|schema/i.test(lower)) {
      assumptions.push("Database is accessible with appropriate permissions");
    }
    if (/deploy|infra/i.test(lower)) {
      assumptions.push("Infrastructure and deployment credentials are configured");
    }

    assumptions.push("Workspace has necessary dependencies installed");
    return assumptions;
  }

  private estimateTimeout(role: Role): number {
    switch (role) {
      case "BUILDER":
        return 600_000; // 10 min — building/testing takes longer
      case "ARCHITECT":
        return 300_000; // 5 min
      case "RESEARCH_ANALYST":
        return 300_000; // 5 min
      case "OPERATIONS_REVIEWER":
        return 180_000; // 3 min
      case "PM":
        return 180_000; // 3 min
      case "STRATEGIST":
        return 240_000; // 4 min
      default:
        return 300_000;
    }
  }
}
