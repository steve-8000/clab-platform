import type { CmuxAdapter } from "@clab/cmux-adapter";
import type { EngineRunner } from "./types.js";

const SHELL_READY_PATTERN = /[$>]\s*$/;
const BROWSER_IDLE_PATTERN = /browser_idle|page loaded|navigation complete|>\s*$/i;

export class BrowserRunner implements EngineRunner {
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

    // Launch Playwright browser session via npx
    const launchCommand = `npx playwright open --headless about:blank\n`;
    await this.cmux.sendText(input.paneId, launchCommand);
    await this.waitForOutput(input.paneId, 15000);

    // Send the initial instruction as a navigation or action
    if (input.instruction) {
      await this.sendInstruction(input.paneId, input.instruction);
    }
  }

  async sendInstruction(paneId: string, instruction: string): Promise<void> {
    // Browser instructions are sent as Playwright script commands
    const escapedInstruction = instruction.replace(/'/g, "'\\''");
    await this.cmux.sendText(paneId, `${escapedInstruction}\n`);
  }

  async readOutput(paneId: string): Promise<string> {
    return this.cmux.readText(paneId);
  }

  async interrupt(paneId: string): Promise<void> {
    await this.cmux.sendKey(paneId, "C-c");
  }

  isIdle(output: string): boolean {
    return BROWSER_IDLE_PATTERN.test(output.trimEnd());
  }

  private async waitForReady(paneId: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const output = await this.cmux.readText(paneId);
      if (SHELL_READY_PATTERN.test(output.trimEnd())) return;
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
