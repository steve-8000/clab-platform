import type { CmuxAdapter } from "@clab/cmux-adapter";
import type { EngineRunner } from "./types.js";

const CODEX_READY_PATTERN = /[$>]\s*$/;
const CODEX_FOOTER_PATTERN = /gpt-\d(?:\.\d+)?/i;
const CODEX_PROMPT_PATTERN = /(^|\n)› .*$/m;
const CODEX_IDLE_PATTERN = /Codex\s*[>$]|waiting for input|█\s*$/i;

export class CodexRunner implements EngineRunner {
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

    // Launch the interactive Codex TUI inside the cmux pane, then paste the task.
    await this.cmux.sendText(input.paneId, "codex\n");
    await this.waitForOutput(input.paneId, 10000);

    const initialPrompt = this.buildInitialPrompt(input.systemPrompt, input.instruction);
    await this.submitPrompt(input.paneId, initialPrompt);
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
    return CODEX_IDLE_PATTERN.test(tail)
      || (CODEX_PROMPT_PATTERN.test(tail) && CODEX_FOOTER_PATTERN.test(tail));
  }

  private async waitForReady(paneId: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const output = await this.cmux.readText(paneId);
      if (CODEX_READY_PATTERN.test(output.trimEnd())) return;
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

  private buildInitialPrompt(systemPrompt: string, instruction: string): string {
    return [
      "Follow this operating mode for the rest of the session:",
      systemPrompt,
      "",
      "Task:",
      instruction,
    ].join("\n");
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
