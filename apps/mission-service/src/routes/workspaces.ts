import { Hono } from "hono";
import { db, logger } from "../deps.js";
import { workspaces } from "@clab/db";
import { eq } from "drizzle-orm";

export const workspaceRoutes = new Hono();

// POST / — create workspace
workspaceRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const { name, rootPath } = body;
  if (!name || !rootPath) return c.json({ error: "name, rootPath required" }, 400);

  const [ws] = await db.insert(workspaces).values({
    name,
    rootPath,
    metadata: body.metadata || {},
  }).returning();

  logger.info("Workspace created", { workspaceId: ws.id, name });
  return c.json(ws, 201);
});

// GET / — list workspaces
workspaceRoutes.get("/", async (c) => {
  const all = await db.select().from(workspaces);
  return c.json(all);
});

// GET /:id — get workspace
workspaceRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  if (!ws) return c.json({ error: "Workspace not found" }, 404);
  return c.json(ws);
});

// DELETE /:id — delete workspace
workspaceRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(workspaces).where(eq(workspaces.id, id));
  return c.json({ deleted: id });
});
