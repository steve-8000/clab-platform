import { z } from "zod";

export const CmuxPaneSchema = z.object({
  id: z.string(),
  ref: z.string().optional(),
  workspaceId: z.string().optional(),
  workspaceRef: z.string().optional(),
  index: z.number().int(),
  title: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  surfaceIds: z.array(z.string()).default([]),
  surfaceRefs: z.array(z.string()).default([]),
  selectedSurfaceId: z.string().optional(),
  selectedSurfaceRef: z.string().optional(),
  active: z.boolean().default(false),
  pid: z.number().int().optional(),
  createdAt: z.string().datetime().optional(),
});
export type CmuxPane = z.infer<typeof CmuxPaneSchema>;

export const CmuxWorkspaceSchema = z.object({
  id: z.string(),
  ref: z.string().optional(),
  name: z.string(),
  currentDirectory: z.string().optional(),
  active: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
});
export type CmuxWorkspace = z.infer<typeof CmuxWorkspaceSchema>;

export const CmuxNotificationSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  paneId: z.string().optional(),
  surfaceId: z.string().optional(),
  workspaceId: z.string().optional(),
  isRead: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
});
export type CmuxNotification = z.infer<typeof CmuxNotificationSchema>;
