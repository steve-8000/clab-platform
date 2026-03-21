import type { CmuxAdapter } from "@clab/cmux-adapter";
import type { EngineRunner } from "./types.js";

const CLAUDE_READY_PATTERN = /[$>]\s*$/;
const CLAUDE_IDLE_PATTERN = /claude[>\s]*$|waiting for input|>\s*$/i;
const CLAUDE_PROMPT_PATTERN = /(^|\n)❯\s*$/m;

export class ClaudeRunner implements EngineRunner {
  constructor(private cmux: CmuxAdapter) {}

  async start(input: {
    sessionId: string;
    paneId: string;
    workingDir: string;
    instruction: string;
    systemPrompt: string;
  }): Promise<void> {
    await this.cmux.sendText(input.paneId, `cd ${input.workingDir}\n`);
    await this.waitForReady(input.paneId, 5000);

    // Launch the interactive Claude TUI inside the cmux pane, then paste the task.
    const escapedSystemPrompt = input.systemPrompt.replace(/'/g, "'\\''");
    const command = `claude --dangerously-skip-permissions --append-system-prompt '${escapedSystemPrompt}'\n`;
    await this.cmux.sendText(input.paneId, command);
    await this.waitForOutput(input.paneId, 15000);
    await this.acceptBypassPromptIfPresent(input.paneId);

    await this.submitPrompt(input.paneId, input.instruction);
    await this.waitForOutput(input.paneId, 5000);
  }

  async sendInstruction(paneId: string, instruction: string): Promise<void> {
    await this.submitPrompt(paneId, instruction);
  }

  async readOutput(paneId: string): Promise<string> {
    return this.cmux.readText(paneId);
  }

  async interrupt(paneId: string): Promise<void> {
    await this.cmux.sendKey(paneId, "C-c");
  }

  isIdle(output: string): boolean {
    const tail = output.slice(-1500).trimEnd();
    return CLAUDE_IDLE_PATTERN.test(tail)
      || CLAUDE_PROMPT_PATTERN.test(tail);
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

  private async acceptBypassPromptIfPresent(paneId: string): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const output = await this.cmux.readText(paneId);
      if (/Bypass Permissions mode/i.test(output) && /Yes, I accept/i.test(output)) {
        await this.cmux.sendText(paneId, "2");
        await this.sleep(150);
        await this.cmux.sendKey(paneId, "Enter");
        await this.waitForOutput(paneId, 5000);
        return;
      }
      await this.sleep(250);
    }
  }

  private async submitPrompt(paneId: string, prompt: string): Promise<void> {
    await this.cmux.sendText(paneId, prompt);
    await this.sleep(150);
    await this.cmux.sendKey(paneId, "Enter");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
