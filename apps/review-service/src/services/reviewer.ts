import { eq } from "drizzle-orm";
import type { Database } from "@clab/db";
import { taskRuns, tasks, artifacts } from "@clab/db";
import type { TaskRun, TaskResult, Task } from "@clab/domain";
import { PolicyEngine, type PolicyDecision, computeRiskScore, type RiskFactors } from "@clab/policy";
import { EventBus, createEvent } from "@clab/events";

export interface ReviewResult {
  passed: boolean;
  issues: string[];
  riskScore: number;
  requiresApproval: boolean;
}

/**
 * ReviewService performs QA and result verification on completed task runs.
 * It checks result contract completeness, validates changed files,
 * runs risk scoring via the policy engine, and determines whether
 * human approval is needed.
 */
export class ReviewService {
  private policyEngine: PolicyEngine;

  constructor(
    private db: Database,
    private bus: EventBus,
  ) {
    this.policyEngine = new PolicyEngine();
  }

  /**
   * Review a task run result and produce a structured review outcome.
   */
  async review(taskRun: TaskRun, result: TaskResult): Promise<ReviewResult> {
    const issues: string[] = [];

    // 1. Check result contract completeness
    const contractIssues = this.checkResultContract(result);
    issues.push(...contractIssues);

    // 2. Validate changed files exist and are reasonable
    const fileIssues = await this.validateChangedFiles(result.changedFiles);
    issues.push(...fileIssues);

    // 3. Check result status consistency
    if (result.status === "SUCCEEDED" && result.changedFiles.length === 0 && result.artifacts.length === 0) {
      issues.push("Task reported success but produced no changed files or artifacts");
    }

    if (result.status === "FAILED" && result.risks.length === 0) {
      issues.push("Task failed but no risks or error details were reported");
    }

    // 4. Run risk scoring via policy engine
    const riskFactors = this.extractRiskFactors(result);
    const riskResult = computeRiskScore(riskFactors);

    // 5. Check policy engine for approval requirements
    const task = await this.fetchTask(taskRun.taskId);
    const role = task?.role ?? "BUILDER";

    const policyDecision = this.policyEngine.evaluate({
      role: role as any,
      action: "task.complete",
      context: {
        filesChanged: result.changedFiles.length,
        files: result.changedFiles,
        risks: result.risks,
        status: result.status,
        summary: result.summary,
      },
    });

    // 6. Determine if approval gate is needed
    const requiresApproval = this.checkApprovalGate(
      riskResult.score,
      result,
      policyDecision,
    );

    if (requiresApproval) {
      issues.push(`Approval required: risk score ${riskResult.score} (${riskResult.level})`);
    }

    // 7. Overall pass/fail decision
    const passed = issues.length === 0 && result.status === "SUCCEEDED" && !requiresApproval;

    // Emit review event
    const eventType = passed ? "task.review.passed" : "task.review.failed";
    await this.bus.publish(
      createEvent(eventType, {
        taskRunId: taskRun.id,
        taskId: taskRun.taskId,
        passed,
        issueCount: issues.length,
        issues,
        riskScore: riskResult.score,
        riskLevel: riskResult.level,
        requiresApproval,
      }, {
        taskRunId: taskRun.id,
        taskId: taskRun.taskId,
      }),
    );

    return {
      passed,
      issues,
      riskScore: riskResult.score,
      requiresApproval,
    };
  }

  /**
   * List pending reviews (task runs in SUCCEEDED status that haven't been reviewed yet).
   */
  async listPending(): Promise<Array<{
    taskRunId: string;
    taskId: string;
    status: string;
    startedAt: string | null;
  }>> {
    // Find task runs that completed but associated tasks still need review
    const pending = await this.db
      .select({
        taskRunId: taskRuns.id,
        taskId: taskRuns.taskId,
        status: taskRuns.status,
        startedAt: taskRuns.startedAt,
      })
      .from(taskRuns)
      .innerJoin(tasks, eq(taskRuns.taskId, tasks.id))
      .where(eq(tasks.status, "NEEDS_REVIEW"));

    return pending.map((row) => ({
      taskRunId: row.taskRunId,
      taskId: row.taskId,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Check result contract completeness.
   * Validates that all required fields in the TaskResult are properly filled.
   */
  private checkResultContract(result: TaskResult): string[] {
    const issues: string[] = [];

    if (!result.summary || result.summary.trim().length === 0) {
      issues.push("Result summary is empty");
    }

    if (result.summary && result.summary.length > 5000) {
      issues.push("Result summary exceeds 5000 character limit");
    }

    if (!result.status) {
      issues.push("Result status is missing");
    }

    if (!result.metrics || result.metrics.elapsedMs === undefined) {
      issues.push("Result metrics (elapsedMs) are missing");
    }

    if (result.metrics && result.metrics.elapsedMs < 0) {
      issues.push("Result metrics show negative elapsed time");
    }

    if (result.status === "SUCCEEDED" && result.summary.toLowerCase().includes("error")) {
      issues.push("Result reports success but summary contains error references");
    }

    // Check artifacts have valid types and URIs
    for (const artifact of result.artifacts) {
      if (!artifact.type) {
        issues.push("Artifact missing type");
      }
      if (!artifact.uri || artifact.uri.trim().length === 0) {
        issues.push("Artifact missing URI");
      }
    }

    return issues;
  }

  /**
   * Validate that changed files look reasonable.
   * Checks for suspicious patterns, excessively long paths, etc.
   */
  private async validateChangedFiles(changedFiles: string[]): Promise<string[]> {
    const issues: string[] = [];

    if (changedFiles.length > 100) {
      issues.push(`Unusually large number of changed files: ${changedFiles.length}`);
    }

    for (const file of changedFiles) {
      // Check for suspicious file paths
      if (file.length > 500) {
        issues.push(`Suspiciously long file path: ${file.slice(0, 100)}...`);
      }

      if (/\.env|secret|credential|token|password/i.test(file)) {
        issues.push(`Sensitive file modified: ${file}`);
      }

      if (/node_modules|\.git\/|dist\/|build\//i.test(file)) {
        issues.push(`Build/vendor artifact modified: ${file}`);
      }

      if (/^\/etc\/|^\/usr\/|^\/var\//i.test(file)) {
        issues.push(`System file modified: ${file}`);
      }
    }

    return issues;
  }

  /**
   * Extract risk factors from a TaskResult for risk scoring.
   */
  private extractRiskFactors(result: TaskResult): RiskFactors {
    const allText = [
      result.summary,
      ...result.changedFiles,
      ...result.risks,
      ...result.followups,
    ].join(" ").toLowerCase();

    return {
      filesChanged: result.changedFiles.length,
      hasInfraChanges:
        allText.includes("infra") ||
        allText.includes("terraform") ||
        allText.includes("docker") ||
        allText.includes("cloudformation"),
      hasSecretAccess:
        allText.includes("secret") ||
        allText.includes(".env") ||
        allText.includes("token") ||
        allText.includes("credential"),
      hasExternalEffects:
        allText.includes("external") ||
        allText.includes("deploy") ||
        allText.includes("submit"),
      hasDestructiveOps:
        allText.includes("rm -rf") ||
        allText.includes("force push") ||
        allText.includes("--force") ||
        allText.includes("reset --hard"),
      retryCount: 0, // Will be enriched from task run data
    };
  }

  /**
   * Determine if an approval gate should be triggered.
   */
  private checkApprovalGate(
    riskScore: number,
    result: TaskResult,
    policyDecision: PolicyDecision,
  ): boolean {
    // High risk always requires approval
    if (riskScore >= 70) {
      return true;
    }

    // Policy engine said approval required
    if (!policyDecision.allow && policyDecision.requiredApprovalGate) {
      return true;
    }

    // Medium risk with sensitive file changes requires approval
    if (riskScore >= 30) {
      const hasSensitiveFiles = result.changedFiles.some((f) =>
        /\.env|secret|credential|token|password|infra|deploy/i.test(f),
      );
      if (hasSensitiveFiles) {
        return true;
      }
    }

    // Many files changed (>20) requires approval
    if (result.changedFiles.length > 20) {
      return true;
    }

    return false;
  }

  /**
   * Fetch the task associated with a task run.
   */
  private async fetchTask(taskId: string): Promise<typeof tasks.$inferSelect | null> {
    const [task] = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    return task ?? null;
  }
}
