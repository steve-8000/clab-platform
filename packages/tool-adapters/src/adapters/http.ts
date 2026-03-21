import type { ToolAdapter } from "../types.js";

export class HttpAdapter implements ToolAdapter {
  name = "http";
  description = "Make HTTP requests";

  validate(input: Record<string, unknown>): boolean {
    return typeof input.url === "string";
  }

  async execute(input: Record<string, unknown>) {
    const start = Date.now();
    const url = input.url as string;
    const method = (input.method as string) || "GET";
    const headers = (input.headers as Record<string, string>) || {};
    const body = input.body as string | undefined;

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: method !== "GET" ? body : undefined,
      });
      const text = await res.text();
      return {
        output: { status: res.status, body: text, headers: Object.fromEntries(res.headers.entries()) },
        status: res.ok ? "succeeded" as const : "failed" as const,
        error: res.ok ? undefined : `HTTP ${res.status}`,
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      return { output: {}, status: "failed" as const, error: (err as Error).message, durationMs: Date.now() - start };
    }
  }
}
