import { z } from "zod";

export const CmuxPaneSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  index: z.number().int(),
  title: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  active: z.boolean().default(false),
  pid: z.number().int().optional(),
  createdAt: z.string().datetime().optional(),
});
export type CmuxPane = z.infer<typeof CmuxPaneSchema>;

export const CmuxWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  paneCount: z.number().int().default(0),
  active: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
});
export type CmuxWorkspace = z.infer<typeof CmuxWorkspaceSchema>;

export const CmuxNotificationSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  body: z.string().optional(),
  paneId: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});
export type CmuxNotification = z.infer<typeof CmuxNotificationSchema>;
