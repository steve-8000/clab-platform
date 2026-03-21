import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolAdapter } from "../types.js";

const execAsync = promisify(exec);

export class ShellAdapter implements ToolAdapter {
  name = "shell";
  description = "Execute shell commands";

  validate(input: Record<string, unknown>): boolean {
    return typeof input.command === "string";
  }

  async execute(input: Record<string, unknown>): Promise<{
    output: Record<string, unknown>;
    status: "succeeded" | "failed";
    error?: string;
    durationMs: number;
  }> {
    const start = Date.now();
    const command = input.command as string;
    const cwd = (input.cwd as string) || process.cwd();
    const timeoutMs = (input.timeoutMs as number) || 30_000;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 10,
      });
      return {
        output: { stdout, stderr, exitCode: 0 },
        status: "succeeded",
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        output: { stdout: e.stdout || "", stderr: e.stderr || "", exitCode: e.code || 1 },
        status: "failed",
        error: e.message || "Command failed",
        durationMs: Date.now() - start,
      };
    }
  }
}
