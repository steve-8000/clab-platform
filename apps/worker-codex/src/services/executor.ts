import type { CmuxAdapter } from "@clab/cmux-adapter";
import type { TaskRun, Task, AgentSession, TaskResult } from "@clab/domain";
import { createRunner, type EngineRunner } from "@clab/engines";
import { EventBus, createEvent } from "@clab/events";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 2_000; // 2 seconds
const STABILITY_CHECKS = 3; // consecutive identical reads to consider output stable
const STABILITY_INTERVAL_MS = 3_000; // interval between stability checks

export class CodexExecutor {
  private runner: EngineRunner;

  constructor(
    private cmux: CmuxAdapter,
    private bus: EventBus,
  ) {
    this.runner = createRunner("CODEX", cmux);
  }

  /**
   * Execute a task run using the Codex engine.
   * Sends the instruction to the assigned pane, polls for completion,
   * parses the result, and returns a structured TaskResult.
   */
  async execute(input: {
    taskRun: TaskRun;
    task: Task;
    session: AgentSession;
    instruction: string;
    context: string;
  }): Promise<TaskResult> {
    const { taskRun, task, session, instruction, context } = input;
    const paneId = session.paneId;
    const startTime = Date.now();

    if (!paneId) {
      return {
        status: "FAILED",
        summary: "No pane assigned to session",
        changedFiles: [],
        artifacts: [],
        risks: [],
        followups: [],
        metrics: { elapsedMs: 0 },
      };
    }

    try {
      // Emit task run started event
      await this.bus.publish(
        createEvent("task.run.started", {
          taskRunId: taskRun.id,
          taskId: task.id,
          engine: "CODEX",
          paneId,
        }, {
          taskRunId: taskRun.id,
          taskId: task.id,
          sessionId: session.id,
        }),
      );

      // Build the full instruction with context
      const fullInstruction = context
        ? `${instruction}\n\n## Context\n${context}`
        : instruction;

      // Start the Codex runner in the pane
      await this.runner.start({
        sessionId: session.id,
        paneId,
        workingDir: session.workingDir,
        instruction: fullInstruction,
        systemPrompt: `You are a Codex agent executing task "${task.title}". Complete the task and produce clear output.`,
      });

      // Poll for completion
      const timeoutMs = (task as Record<string, unknown>).timeoutMs as number | undefined ?? DEFAULT_TIMEOUT_MS;
      const finalOutput = await this.pollForCompletion(paneId, timeoutMs);
      const elapsedMs = Date.now() - startTime;

      // Parse the result from output
      const result = this.parseResult(finalOutput, elapsedMs);

      // Emit completion event
      await this.bus.publish(
        createEvent("task.run.completed", {
          taskRunId: taskRun.id,
          taskId: task.id,
          status: result.status,
          summary: result.summary,
          elapsedMs,
        }, {
          taskRunId: taskRun.id,
          taskId: task.id,
          sessionId: session.id,
        }),
      );

      return result;
    } catch (err) {
      const elapsedMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Try to capture whatever output exists
      let capturedOutput = "";
      try {
        capturedOutput = await this.runner.readOutput(paneId);
      } catch {
        // Best effort
      }

      await this.bus.publish(
        createEvent("task.run.failed", {
          taskRunId: taskRun.id,
          taskId: task.id,
          error: errorMessage,
          elapsedMs,
        }, {
          taskRunId: taskRun.id,
          taskId: task.id,
          sessionId: session.id,
        }),
      );

      const isTimeout = errorMessage.includes("timed out");
      return {
        status: isTimeout ? "TIMED_OUT" : "FAILED",
        summary: `Codex execution ${isTimeout ? "timed out" : "failed"}: ${errorMessage}`,
        changedFiles: this.extractChangedFiles(capturedOutput),
        artifacts: [],
        risks: isTimeout ? ["Execution did not complete within timeout"] : [`Error: ${errorMessage}`],
        followups: ["Investigate failure and retry if appropriate"],
        metrics: { elapsedMs },
      };
    }
  }

  /**
   * Get the current execution status by reading pane output.
   */
  async getStatus(paneId: string): Promise<{
    running: boolean;
    output: string;
    outputLength: number;
  }> {
    const output = await this.runner.readOutput(paneId);
    const isIdle = this.runner.isIdle(output);
    return {
      running: !isIdle,
      output,
      outputLength: output.length,
    };
  }

  /**
   * Poll the pane output until the agent is idle or the timeout is reached.
   * Uses both idle pattern detection and output stabilization.
   */
  private async pollForCompletion(paneId: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastOutput = "";
    let stableCount = 0;

    while (Date.now() < deadline) {
      const output = await this.runner.readOutput(paneId);

      // Check if the engine reports idle (command prompt returned)
      if (this.runner.isIdle(output) && output.length > 0) {
        return output;
      }

      // Check output stabilization
      if (output === lastOutput && output.length > 0) {
        stableCount++;
        if (stableCount >= STABILITY_CHECKS) {
          // Output hasn't changed for several checks — likely done
          // Do one final idle check with a longer wait
          await this.sleep(STABILITY_INTERVAL_MS);
          const finalCheck = await this.runner.readOutput(paneId);
          if (finalCheck === output) {
            return finalCheck;
          }
          // Output changed during final check, reset stability counter
          stableCount = 0;
          lastOutput = finalCheck;
          continue;
        }
      } else {
        stableCount = 0;
        lastOutput = output;
      }

      // Emit periodic heartbeat
      if (stableCount === 0) {
        await this.bus.publish(
          createEvent("task.run.heartbeat", {
            paneId,
            outputLength: output.length,
          }),
        );
      }

      await this.sleep(POLL_INTERVAL_MS);
    }

    // Timeout reached
    const finalOutput = await this.runner.readOutput(paneId);
    throw new Error(`Execution timed out after ${timeoutMs}ms. Last output length: ${finalOutput.length}`);
  }

  /**
   * Parse Codex output into a structured TaskResult.
   */
  private parseResult(output: string, elapsedMs: number): TaskResult {
    const lines = output.split("\n");
    const changedFiles = this.extractChangedFiles(output);
    const hasError = /error|failed|exception|panic/i.test(output);
    const hasSuccess = /completed|success|done|finished/i.test(output);

    // Extract a summary from the last meaningful lines
    const meaningfulLines = lines
      .filter((l) => l.trim().length > 0)
      .slice(-10);
    const summary = meaningfulLines.join("\n").slice(0, 500) || "Execution completed";

    // Detect risks in the output
    const risks: string[] = [];
    if (/rm\s+-rf|force\s+push|--force/i.test(output)) {
      risks.push("Destructive operations detected in output");
    }
    if (/\.env|secret|token|credential/i.test(output)) {
      risks.push("Potential secret/credential access detected");
    }

    // Detect follow-up suggestions
    const followups: string[] = [];
    if (/TODO|FIXME|HACK/i.test(output)) {
      followups.push("Review TODO/FIXME items left in output");
    }
    if (/test|spec/i.test(output) && hasError) {
      followups.push("Some tests may have failed — review test output");
    }

    const status = hasError && !hasSuccess ? "FAILED" : "SUCCEEDED";

    return {
      status,
      summary,
      changedFiles,
      artifacts: changedFiles.map((f) => ({ type: "FILE", uri: f })),
      risks,
      followups,
      metrics: { elapsedMs },
    };
  }

  /**
   * Extract file paths that were modified from Codex output.
   * Looks for common patterns like "created", "modified", "wrote", git diff output.
   */
  private extractChangedFiles(output: string): string[] {
    const files = new Set<string>();

    // Match patterns like "Created file.ts", "Modified src/foo.ts", "Wrote bar.js"
    const createPattern = /(?:creat|modif|wro?te|updat|edit|chang)\w*\s+[`"']?([^\s`"']+\.\w+)[`"']?/gi;
    let match: RegExpExecArray | null;
    while ((match = createPattern.exec(output)) !== null) {
      const file = match[1]!;
      if (!file.includes("(") && !file.includes(")") && file.length < 200) {
        files.add(file);
      }
    }

    // Match git diff headers: "diff --git a/file b/file" or "+++ b/file"
    const diffPattern = /^\+\+\+\s+b\/(.+)$/gm;
    while ((match = diffPattern.exec(output)) !== null) {
      files.add(match[1]!);
    }

    return [...files];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
