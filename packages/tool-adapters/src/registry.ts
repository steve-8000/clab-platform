import type { ToolAdapter } from "./types.js";
import { ShellAdapter } from "./adapters/shell.js";
import { FileSystemAdapter } from "./adapters/file-system.js";
import { HttpAdapter } from "./adapters/http.js";

export class ToolAdapterRegistry {
  private adapters = new Map<string, ToolAdapter>();

  constructor() {
    this.register(new ShellAdapter());
    this.register(new FileSystemAdapter());
    this.register(new HttpAdapter());
  }

  register(adapter: ToolAdapter): void { this.adapters.set(adapter.name, adapter); }
  get(name: string): ToolAdapter | undefined { return this.adapters.get(name); }
  list(): ToolAdapter[] { return Array.from(this.adapters.values()); }

  async execute(toolName: string, input: Record<string, unknown>) {
    const adapter = this.get(toolName);
    if (!adapter) throw new Error(`Unknown tool: ${toolName}`);
    if (!adapter.validate(input)) throw new Error(`Invalid input for tool: ${toolName}`);
    return adapter.execute(input);
  }
}
