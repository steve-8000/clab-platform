import type { CmuxPane, CmuxWorkspace } from "./types.js";

export interface CmuxAdapter {
  connect(): Promise<void>;
  disconnect(): void;

  // Workspace operations
  workspaceCreate(name?: string): Promise<CmuxWorkspace>;
  workspaceCurrent(): Promise<CmuxWorkspace>;
  workspaceList(): Promise<CmuxWorkspace[]>;
  workspaceSelect(id: string): Promise<void>;
  workspaceRename(id: string, name: string): Promise<void>;
  workspaceCleanup(): Promise<{ closed: number }>;

  // Pane operations
  paneSplit(direction: "right" | "down", fromPaneId?: string): Promise<CmuxPane>;
  paneList(workspaceId: string): Promise<CmuxPane[]>;
  paneFocus(paneId: string): Promise<void>;
  paneClose(paneId: string): Promise<void>;

  // Surface I/O
  sendText(paneId: string, text: string): Promise<void>;
  sendKey(paneId: string, key: string): Promise<void>;
  readText(paneId: string): Promise<string>;

  // Notifications
  notificationList(): Promise<Array<{ id: string; title?: string; body?: string }>>;
  notificationCreate(title: string, body: string, paneId?: string): Promise<void>;
  notificationClear(): Promise<void>;

  // System
  systemIdentify(): Promise<Record<string, unknown>>;
  systemTree(): Promise<Record<string, unknown>>;
}
