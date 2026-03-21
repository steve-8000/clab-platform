export interface EngineRunner {
  start(input: {
    sessionId: string;
    paneId: string;
    workingDir: string;
    instruction: string;
    systemPrompt: string;
  }): Promise<void>;

  sendInstruction(paneId: string, instruction: string): Promise<void>;
  readOutput(paneId: string): Promise<string>;
  interrupt(paneId: string): Promise<void>;
  isIdle(output: string): boolean;
}
