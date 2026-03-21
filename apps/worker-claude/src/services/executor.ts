import type { CmuxAdapter } from "@clab/cmux-adapter";
import type { TaskRun, Task, AgentSession, TaskResult } from "@clab/domain";
import { createRunner, type EngineRunner } from "@clab/engines";
import { EventBus, createEvent } from "@clab/events";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (Claude tasks tend to be longer)
const POLL_INTERVAL_MS = 2_000;
const STABILITY_CHECKS = 3;
const STABILITY_INTERVAL_MS = 3_000;

// Claude CLI specific patterns
const CLAUDE_PERMISSION_PROMPT = /Do you want to proceed|Allow|Approve|Y\/n|yes\/no/i;
const CLAUDE_STARTUP_COMPLETE = /claude|>\s*$/i;
const CLAUDE_COST_PATTERN = /(?:tokens?|cost):\s*\$?([\d.]+)/i;

export class ClaudeExecutor {
  private runner: EngineRunner;

  constructor(
    private cmux: CmuxAdapter,
    private bus: EventBus,
  ) {
    this.runner = createRunner("CLAUDE", cmux);
  }

  /**
   * Execute a task run using the Claude CLI engine.
   * Handles Claude-specific startup (skip-permissions prompt, auto-accept),
   * sends the instruction, polls for completion, and parses the result.
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
          engine: "CLAUDE",
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

      // Start the Claude runner with --dangerously-skip-permissions
      await this.runner.start({
        sessionId: session.id,
        paneId,
        workingDir: session.workingDir,
        instruction: fullInstruction,
        systemPrompt: `You are a Claude agent executing task "${task.title}". Complete the task thoroughly and produce clear output.`,
      });

      // Handle any permission prompts that appear during startup
      await this.handleStartupPrompts(paneId);

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

      // Capture whatever output exists
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
        summary: `Claude execution ${isTimeout ? "timed out" : "failed"}: ${errorMessage}`,
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
   * Handle Claude CLI startup prompts.
   * Claude may show permission dialogs or confirmation prompts even with
   * --dangerously-skip-permissions. This auto-accepts them.
   */
  private async handleStartupPrompts(paneId: string): Promise<void> {
    const maxAttempts = 10;
    const checkInterval = 1_000;

    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(checkInterval);
      const output = await this.runner.readOutput(paneId);

      // Check if Claude is showing a permission prompt
      if (CLAUDE_PERMISSION_PROMPT.test(output)) {
        // Auto-accept by sending 'y' followed by Enter
        await this.cmux.sendText(paneId, "y\n");
        console.log(`[ClaudeExecutor] auto-accepted permission prompt in pane ${paneId}`);
        continue;
      }

      // Check if Claude has started processing (output is growing)
      if (CLAUDE_STARTUP_COMPLETE.test(output) && output.length > 100) {
        return; // Claude is running
      }

      // If we see substantial output, Claude has started
      if (output.length > 200) {
        return;
      }
    }
  }

  /**
   * Poll pane output until the agent is idle or the timeout is reached.
   */
  private async pollForCompletion(paneId: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastOutput = "";
    let stableCount = 0;

    while (Date.now() < deadline) {
      const output = await this.runner.readOutput(paneId);

      // Handle any permission prompts that appear mid-execution
      if (CLAUDE_PERMISSION_PROMPT.test(output.slice(-500))) {
        await this.cmux.sendText(paneId, "y\n");
        console.log(`[ClaudeExecutor] auto-accepted mid-execution permission prompt`);
        stableCount = 0;
        lastOutput = "";
        await this.sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Check if the engine reports idle
      if (this.runner.isIdle(output) && output.length > 0) {
        return output;
      }

      // Check output stabilization
      if (output === lastOutput && output.length > 0) {
        stableCount++;
        if (stableCount >= STABILITY_CHECKS) {
          await this.sleep(STABILITY_INTERVAL_MS);
          const finalCheck = await this.runner.readOutput(paneId);
          if (finalCheck === output) {
            return finalCheck;
          }
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
            engine: "CLAUDE",
          }),
        );
      }

      await this.sleep(POLL_INTERVAL_MS);
    }

    const finalOutput = await this.runner.readOutput(paneId);
    throw new Error(`Execution timed out after ${timeoutMs}ms. Last output length: ${finalOutput.length}`);
  }

  /**
   * Parse Claude output into a structured TaskResult.
   */
  private parseResult(output: string, elapsedMs: number): TaskResult {
    const lines = output.split("\n");
    const changedFiles = this.extractChangedFiles(output);
    const hasError = /error|failed|exception/i.test(output);
    const hasSuccess = /completed|success|done|finished/i.test(output);

    // Extract summary from the last meaningful lines
    const meaningfulLines = lines
      .filter((l) => l.trim().length > 0)
      .slice(-15);
    const summary = meaningfulLines.join("\n").slice(0, 500) || "Claude execution completed";

    // Extract cost information if present
    const costMatch = CLAUDE_COST_PATTERN.exec(output);
    const costUsd = costMatch ? parseFloat(costMatch[1]!) : undefined;

    // Detect risks
    const risks: string[] = [];
    if (/rm\s+-rf|force\s+push|--force/i.test(output)) {
      risks.push("Destructive operations detected in output");
    }
    if (/\.env|secret|token|credential/i.test(output)) {
      risks.push("Potential secret/credential access detected");
    }
    if (/permission|sudo|root/i.test(output)) {
      risks.push("Elevated permission usage detected");
    }

    // Detect follow-ups
    const followups: string[] = [];
    if (/TODO|FIXME|HACK/i.test(output)) {
      followups.push("Review TODO/FIXME items left in output");
    }
    if (/test|spec/i.test(output) && hasError) {
      followups.push("Some tests may have failed — review test output");
    }
    if (changedFiles.length > 10) {
      followups.push("Large number of files changed — thorough review recommended");
    }

    const status = hasError && !hasSuccess ? "FAILED" : "SUCCEEDED";

    return {
      status,
      summary,
      changedFiles,
      artifacts: changedFiles.map((f) => ({ type: "FILE", uri: f })),
      risks,
      followups,
      metrics: { elapsedMs, costUsd },
    };
  }

  /**
   * Extract file paths that were modified from Claude output.
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

    // Match git diff headers
    const diffPattern = /^\+\+\+\s+b\/(.+)$/gm;
    while ((match = diffPattern.exec(output)) !== null) {
      files.add(match[1]!);
    }

    // Match Claude's file creation output pattern: "Write to file: path/to/file"
    const claudeWritePattern = /(?:Write to|Reading|Editing)\s+(?:file:\s*)?[`"']?([^\s`"'\n]+\.\w+)[`"']?/gi;
    while ((match = claudeWritePattern.exec(output)) !== null) {
      const file = match[1]!;
      if (!file.includes("(") && !file.includes(")") && file.length < 200) {
        files.add(file);
      }
    }

    return [...files];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
