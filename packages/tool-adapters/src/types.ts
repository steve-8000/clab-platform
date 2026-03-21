import type { ToolInvocation } from "@clab/runtime-contracts";

export interface ToolAdapter {
  name: string;
  description: string;
  execute(input: Record<string, unknown>): Promise<{
    output: Record<string, unknown>;
    status: "succeeded" | "failed";
    error?: string;
    durationMs: number;
  }>;
  validate(input: Record<string, unknown>): boolean;
}
