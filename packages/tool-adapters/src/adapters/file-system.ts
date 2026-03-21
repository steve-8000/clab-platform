import type { ToolAdapter } from "../types.js";

export class FileSystemAdapter implements ToolAdapter {
  name = "filesystem";
  description = "Read and write files";

  validate(input: Record<string, unknown>): boolean {
    return typeof input.action === "string" && typeof input.path === "string";
  }

  async execute(input: Record<string, unknown>) {
    const fs = await import("node:fs/promises");
    const start = Date.now();
    const action = input.action as string;
    const filePath = input.path as string;

    try {
      switch (action) {
        case "read": {
          const content = await fs.readFile(filePath, "utf-8");
          return { output: { content }, status: "succeeded" as const, durationMs: Date.now() - start };
        }
        case "write": {
          await fs.writeFile(filePath, input.content as string);
          return { output: { written: true }, status: "succeeded" as const, durationMs: Date.now() - start };
        }
        case "list": {
          const entries = await fs.readdir(filePath);
          return { output: { entries }, status: "succeeded" as const, durationMs: Date.now() - start };
        }
        case "exists": {
          try { await fs.access(filePath); return { output: { exists: true }, status: "succeeded" as const, durationMs: Date.now() - start }; }
          catch { return { output: { exists: false }, status: "succeeded" as const, durationMs: Date.now() - start }; }
        }
        default:
          return { output: {}, status: "failed" as const, error: `Unknown action: ${action}`, durationMs: Date.now() - start };
      }
    } catch (err: unknown) {
      return { output: {}, status: "failed" as const, error: (err as Error).message, durationMs: Date.now() - start };
    }
  }
}
