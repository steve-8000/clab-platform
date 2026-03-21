import net from "node:net";
import type { CmuxAdapter } from "./client.js";
import type { CmuxNotification, CmuxPane, CmuxWorkspace } from "./types.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc?: "2.0";
  id: number;
  ok?: boolean;
  result?: unknown;
  error?: { code?: number | string; message: string; data?: unknown };
}

interface RawWorkspaceResult {
  workspace_id: string;
  workspace_ref: string;
  window_id?: string;
  window_ref?: string;
}

interface RawWorkspaceListResult {
  workspaces: Array<{
    id: string;
    ref: string;
    title?: string;
    current_directory?: string;
    selected?: boolean;
  }>;
}

interface RawPane {
  id: string;
  ref: string;
  index: number;
  focused?: boolean;
  surface_ids?: string[];
  surface_refs?: string[];
  selected_surface_id?: string;
  selected_surface_ref?: string;
}

interface RawPaneListResult {
  workspace_id?: string;
  workspace_ref?: string;
  panes: RawPane[];
}

interface RawSurface {
  id: string;
  ref: string;
  pane_id: string;
  pane_ref: string;
  title?: string;
  selected_in_pane?: boolean;
}

interface RawSurfaceListResult {
  surfaces: RawSurface[];
}

interface RawNotification {
  id: string;
  title?: string;
  subtitle?: string;
  body?: string;
  surface_id?: string;
  workspace_id?: string;
  is_read?: boolean;
}

interface RawNotificationListResult {
  notifications: RawNotification[];
}

export class CmuxSocketClient implements CmuxAdapter {
  private socket: net.Socket | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
  private buffer = "";
  private socketPath: string;
  private connected = false;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? CmuxSocketClient.resolveSocketPath();
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      this.socket = net.createConnection(this.socketPath, () => {
        this.connected = true;
        settled = true;
        resolve();
      });

      this.socket.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString("utf-8");
        this.processBuffer();
      });

      this.socket.on("error", (err: unknown) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
        for (const [, pending] of this.pending) {
          pending.reject(err);
        }
        this.pending.clear();
      });

      this.socket.on("close", () => {
        this.connected = false;
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
    this.connected = false;
    this.buffer = "";
    this.pending.clear();
  }

  private static resolveSocketPath(): string {
    const home = process.env["HOME"] ?? "";
    if (process.env["CMUX_SOCKET_PATH"]) {
      return process.env["CMUX_SOCKET_PATH"];
    }
    if (process.env["TMUX_SOCKET_PATH"]) {
      return process.env["TMUX_SOCKET_PATH"];
    }
    return `${home}/Library/Application Support/cmux/cmux.sock`;
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
          if (response.ok === false || response.error) {
            const code = response.error?.code ?? "unknown";
            const message = response.error?.message ?? "Request failed";
            pending.reject(new Error(`cmux error ${code}: ${message}`));
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
      this.socket!.write(JSON.stringify(request) + "\n", (err: unknown) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  // --- Workspace operations ---

  async workspaceCreate(name?: string): Promise<CmuxWorkspace> {
    const result = await this.request("workspace.create", name ? { title: name } : {}) as RawWorkspaceResult;
    return this.normalizeWorkspace(result, name);
  }

  async workspaceCurrent(): Promise<CmuxWorkspace> {
    const result = await this.request("workspace.current") as RawWorkspaceResult;
    const workspaces = await this.workspaceList();
    const matched = workspaces.find((workspace) => workspace.id === result.workspace_id || workspace.ref === result.workspace_ref);
    return matched ?? this.normalizeWorkspace(result);
  }

  async workspaceList(): Promise<CmuxWorkspace[]> {
    const result = await this.request("workspace.list") as RawWorkspaceListResult;
    return result.workspaces.map((workspace) => ({
      id: workspace.id,
      ref: workspace.ref,
      name: workspace.title ?? workspace.ref,
      currentDirectory: workspace.current_directory,
      active: workspace.selected ?? false,
    }));
  }

  async workspaceSelect(id: string): Promise<void> {
    await this.request("workspace.select", this.toTargetParams("workspace", id));
  }

  async workspaceRename(id: string, name: string): Promise<void> {
    await this.request("workspace.rename", { ...this.toTargetParams("workspace", id), title: name });
  }

  // --- Pane operations ---

  async paneSplit(direction: "right" | "down", fromPaneId?: string): Promise<CmuxPane> {
    const surfaceId = fromPaneId
      ? await this.resolveSelectedSurfaceId(fromPaneId)
      : await this.currentSurfaceId();
    const result = await this.request("surface.split", { surface_id: surfaceId, direction }) as {
      pane_id: string;
      pane_ref: string;
      surface_id: string;
      surface_ref: string;
      workspace_id?: string;
      workspace_ref?: string;
    };
    return {
      id: result.pane_id,
      ref: result.pane_ref,
      workspaceId: result.workspace_id,
      workspaceRef: result.workspace_ref,
      index: -1,
      surfaceIds: [result.surface_id],
      surfaceRefs: [result.surface_ref],
      selectedSurfaceId: result.surface_id,
      selectedSurfaceRef: result.surface_ref,
      active: false,
    };
  }

  async paneList(workspaceId?: string): Promise<CmuxPane[]> {
    const params = workspaceId ? this.toTargetParams("workspace", workspaceId) : {};
    const result = await this.request("pane.list", params) as RawPaneListResult;
    return result.panes.map((pane) => this.normalizePane(pane, result.workspace_id, result.workspace_ref));
  }

  async paneFocus(paneId: string): Promise<void> {
    await this.request("pane.focus", this.toTargetParams("pane", paneId));
  }

  async paneClose(paneId: string): Promise<void> {
    const surfaceId = await this.resolveSelectedSurfaceId(paneId);
    await this.request("surface.close", { surface_id: surfaceId });
  }

  // --- Surface I/O ---

  async sendText(paneId: string, text: string): Promise<void> {
    const surfaceId = await this.resolveSelectedSurfaceId(paneId);
    await this.request("surface.send_text", { surface_id: surfaceId, text });
  }

  async sendKey(paneId: string, key: string): Promise<void> {
    const surfaceId = await this.resolveSelectedSurfaceId(paneId);
    await this.request("surface.send_key", { surface_id: surfaceId, key });
  }

  async readText(paneId: string): Promise<string> {
    const surfaceId = await this.resolveSelectedSurfaceId(paneId);
    const result = await this.request("surface.read_text", { surface_id: surfaceId }) as { text?: string; base64?: string };
    return result.text ?? "";
  }

  // --- Notifications ---

  async notificationList(): Promise<CmuxNotification[]> {
    const [notificationsResult, surfaceMap] = await Promise.all([
      this.request("notification.list") as Promise<RawNotificationListResult>,
      this.surfaceToPaneMap(),
    ]);
    return notificationsResult.notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      subtitle: notification.subtitle,
      body: notification.body,
      paneId: notification.surface_id ? surfaceMap.get(notification.surface_id) : undefined,
      surfaceId: notification.surface_id,
      workspaceId: notification.workspace_id,
      isRead: notification.is_read,
    }));
  }

  async notificationCreate(title: string, body: string, paneId?: string): Promise<void> {
    if (paneId) {
      const surfaceId = await this.resolveSelectedSurfaceId(paneId);
      await this.request("notification.create_for_surface", { surface_id: surfaceId, title, body });
      return;
    }
    await this.request("notification.create", { title, body });
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

  private normalizeWorkspace(result: RawWorkspaceResult, name?: string): CmuxWorkspace {
    return {
      id: result.workspace_id,
      ref: result.workspace_ref,
      name: name ?? result.workspace_ref,
      active: true,
    };
  }

  private normalizePane(raw: RawPane, workspaceId?: string, workspaceRef?: string): CmuxPane {
    return {
      id: raw.id,
      ref: raw.ref,
      workspaceId,
      workspaceRef,
      index: raw.index,
      surfaceIds: raw.surface_ids ?? [],
      surfaceRefs: raw.surface_refs ?? [],
      selectedSurfaceId: raw.selected_surface_id,
      selectedSurfaceRef: raw.selected_surface_ref,
      active: raw.focused ?? false,
    };
  }

  private toTargetParams(prefix: "workspace" | "pane", target: string): Record<string, string> {
    if (target.includes(":")) {
      return { [`${prefix}_ref`]: target };
    }
    return { [`${prefix}_id`]: target };
  }

  private async currentSurfaceId(): Promise<string> {
    const identify = await this.request("system.identify") as {
      focused?: { surface_id?: string };
    };
    const surfaceId = identify.focused?.surface_id;
    if (!surfaceId) {
      throw new Error("cmux did not report an active surface");
    }
    return surfaceId;
  }

  private async resolveSelectedSurfaceId(paneId: string): Promise<string> {
    const panes = await this.paneList();
    const pane = panes.find((candidate) => candidate.id === paneId || candidate.ref === paneId);
    if (!pane?.selectedSurfaceId) {
      throw new Error(`Unable to resolve selected surface for pane ${paneId}`);
    }
    return pane.selectedSurfaceId;
  }

  private async surfaceToPaneMap(): Promise<Map<string, string>> {
    const result = await this.request("surface.list") as RawSurfaceListResult;
    return new Map(
      result.surfaces.map((surface) => [surface.id, surface.pane_id]),
    );
  }
}
