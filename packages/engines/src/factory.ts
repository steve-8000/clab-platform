import type { Engine } from "@clab/domain";
import type { CmuxAdapter } from "@clab/cmux-adapter";
import type { EngineRunner } from "./types.js";
import { CodexRunner } from "./codex-runner.js";
import { ClaudeRunner } from "./claude-runner.js";
import { BrowserRunner } from "./browser-runner.js";

export function createRunner(engine: Engine, cmux: CmuxAdapter): EngineRunner {
  switch (engine) {
    case "CODEX":
      return new CodexRunner(cmux);
    case "CLAUDE":
      return new ClaudeRunner(cmux);
    case "BROWSER":
      return new BrowserRunner(cmux);
    default:
      throw new Error(`Unknown engine: ${engine}`);
  }
}
