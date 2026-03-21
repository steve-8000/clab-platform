import type { CmuxAdapter } from "@clab/cmux-adapter";
import type { EngineRunner } from "./types.js";

const CLAUDE_READY_PATTERN = /[$>]\s*$/;
const CLAUDE_IDLE_PATTERN = /claude[>\s]*$|waiting for input|>\s*$/i;

export class ClaudeRunner implements EngineRunner {
  constructor(private cmux: CmuxAdapter) {}

  async start(input: {
    sessionId: string;
    paneId: string;
    workingDir: string;
    instruction: string;
    systemPrompt: string;
  }): Promise<void> {
    // Navigate to working directory
    await this.cmux.sendText(input.paneId, `cd ${input.workingDir}\n`);
    await this.waitForReady(input.paneId, 5000);

    // Launch Claude CLI with dangerous permissions skip and system prompt
    const escapedInstruction = input.instruction.replace(/'/g, "'\\''");
    const escapedSystemPrompt = input.systemPrompt.replace(/'/g, "'\\''");
    const command = `claude --dangerously-skip-permissions --system-prompt '${escapedSystemPrompt}' --prompt '${escapedInstruction}'\n`;
    await this.cmux.sendText(input.paneId, command);

    // Wait for Claude to start processing
    await this.waitForOutput(input.paneId, 15000);
  }

  async sendInstruction(paneId: string, instruction: string): Promise<void> {
    await this.cmux.sendText(paneId, `${instruction}\n`);
  }

  async readOutput(paneId: string): Promise<string> {
    return this.cmux.readText(paneId);
  }

  async interrupt(paneId: string): Promise<void> {
    await this.cmux.sendKey(paneId, "C-c");
  }

  isIdle(output: string): boolean {
    return CLAUDE_IDLE_PATTERN.test(output.trimEnd());
  }

  private async waitForReady(paneId: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const output = await this.cmux.readText(paneId);
      if (CLAUDE_READY_PATTERN.test(output.trimEnd())) return;
      await this.sleep(300);
    }
  }

  private async waitForOutput(paneId: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const initialOutput = await this.cmux.readText(paneId);
    while (Date.now() - start < timeoutMs) {
      const output = await this.cmux.readText(paneId);
      if (output.length > initialOutput.length) return;
      await this.sleep(300);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
