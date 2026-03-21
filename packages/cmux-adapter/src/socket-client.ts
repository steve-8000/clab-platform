import net from "node:net";
import type { CmuxAdapter } from "./client.js";
import type { CmuxPane, CmuxWorkspace } from "./types.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class CmuxSocketClient implements CmuxAdapter {
  private socket: net.Socket | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
  private buffer = "";
  private socketPath: string;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? `${process.env["HOME"]}/.cmux/socket`;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath, () => {
        resolve();
      });

      this.socket.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString("utf-8");
        this.processBuffer();
      });

      this.socket.on("error", (err) => {
        reject(err);
        for (const [, pending] of this.pending) {
          pending.reject(err);
        }
        this.pending.clear();
      });

      this.socket.on("close", () => {
        for (const [, pending] of this.pending) {
          pending.reject(new Error("Socket closed"));
        }
        this.pending.clear();
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = "";
    this.pending.clear();
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const response = JSON.parse(trimmed) as JsonRpcResponse;
        const pending = this.pending.get(response.id);
        if (pending) {
          this.pending.delete(response.id);
          if (response.error) {
            pending.reject(new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch {
        // Ignore malformed lines
      }
    }
  }

  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.socket) {
      throw new Error("Not connected. Call connect() first.");
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket!.write(JSON.stringify(request) + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  // --- Workspace operations ---

  async workspaceCreate(name?: string): Promise<CmuxWorkspace> {
    const result = await this.request("workspace.create", name ? { name } : {});
    return result as CmuxWorkspace;
  }

  async workspaceCurrent(): Promise<CmuxWorkspace> {
    const result = await this.request("workspace.current");
    return result as CmuxWorkspace;
  }

  async workspaceList(): Promise<CmuxWorkspace[]> {
    const result = await this.request("workspace.list");
    return result as CmuxWorkspace[];
  }

  async workspaceSelect(id: string): Promise<void> {
    await this.request("workspace.select", { id });
  }

  async workspaceRename(id: string, name: string): Promise<void> {
    await this.request("workspace.rename", { id, name });
  }

  async workspaceCleanup(): Promise<{ closed: number }> {
    const result = await this.request("workspace.cleanup");
    return result as { closed: number };
  }

  // --- Pane operations ---

  async paneSplit(direction: "right" | "down", fromPaneId?: string): Promise<CmuxPane> {
    const params: Record<string, unknown> = { direction };
    if (fromPaneId) params["fromPaneId"] = fromPaneId;
    const result = await this.request("pane.split", params);
    return result as CmuxPane;
  }

  async paneList(workspaceId: string): Promise<CmuxPane[]> {
    const result = await this.request("pane.list", { workspaceId });
    return result as CmuxPane[];
  }

  async paneFocus(paneId: string): Promise<void> {
    await this.request("pane.focus", { paneId });
  }

  async paneClose(paneId: string): Promise<void> {
    await this.request("pane.close", { paneId });
  }

  // --- Surface I/O ---

  async sendText(paneId: string, text: string): Promise<void> {
    await this.request("surface.sendText", { paneId, text });
  }

  async sendKey(paneId: string, key: string): Promise<void> {
    await this.request("surface.sendKey", { paneId, key });
  }

  async readText(paneId: string): Promise<string> {
    const result = await this.request("surface.readText", { paneId });
    return result as string;
  }

  // --- Notifications ---

  async notificationList(): Promise<Array<{ id: string; title?: string; body?: string }>> {
    const result = await this.request("notification.list");
    return result as Array<{ id: string; title?: string; body?: string }>;
  }

  async notificationCreate(title: string, body: string, paneId?: string): Promise<void> {
    const params: Record<string, unknown> = { title, body };
    if (paneId) params["paneId"] = paneId;
    await this.request("notification.create", params);
  }

  async notificationClear(): Promise<void> {
    await this.request("notification.clear");
  }

  // --- System ---

  async systemIdentify(): Promise<Record<string, unknown>> {
    const result = await this.request("system.identify");
    return result as Record<string, unknown>;
  }

  async systemTree(): Promise<Record<string, unknown>> {
    const result = await this.request("system.tree");
    return result as Record<string, unknown>;
  }
}
