import { Hono } from "hono";
import { LocalKnowledgeStore } from "@clab/knowledge";
import type { KnowledgeEntry } from "@clab/knowledge";

const STORE_DIR = process.env.KNOWLEDGE_STORE_DIR ?? ".knowledge-data";
const store = new LocalKnowledgeStore(STORE_DIR);

const knowledge = new Hono();

// ---------------------------------------------------------------------------
// POST / — store a knowledge entry
// ---------------------------------------------------------------------------
knowledge.post("/", async (c) => {
  const body = await c.req.json<{
    topic: string;
    content: string;
    tags?: string[];
    source?: "MANUAL" | "EXTRACTED" | "DISTILLED";
    confidence?: number;
    missionId?: string;
  }>();

  if (!body.topic || !body.content) {
    return c.json({ ok: false, error: "topic and content are required" }, 400);
  }

  try {
    const entry = await store.store({
      topic: body.topic,
      content: body.content,
      tags: body.tags ?? [],
      source: body.source ?? "MANUAL",
      confidence: body.confidence ?? 1.0,
      missionId: body.missionId,
    });
    return c.json({ ok: true, entry });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /search?q=... — search knowledge (keyword matching)
// ---------------------------------------------------------------------------
knowledge.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q) {
    return c.json({ ok: false, error: "query parameter q is required" }, 400);
  }

  try {
    const results = await store.search(q);
    return c.json({ ok: true, results, count: results.length });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /topic/:topic — get entries by topic
// ---------------------------------------------------------------------------
knowledge.get("/topic/:topic", async (c) => {
  const topic = c.req.param("topic");

  try {
    const entries = await store.getByTopic(topic);
    return c.json({ ok: true, entries, count: entries.length });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /tags?tags=... — get entries by tags (comma-separated)
// ---------------------------------------------------------------------------
knowledge.get("/tags", async (c) => {
  const tagsParam = c.req.query("tags");
  if (!tagsParam) {
    return c.json(
      { ok: false, error: "query parameter tags is required" },
      400,
    );
  }

  const tags = tagsParam.split(",").map((t) => t.trim());

  try {
    const entries = await store.getByTags(tags);
    return c.json({ ok: true, entries, count: entries.length });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /status — knowledge base stats
// ---------------------------------------------------------------------------
knowledge.get("/status", async (c) => {
  try {
    const stats = await store.status();
    return c.json({ ok: true, ...stats });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id — delete a knowledge entry
// ---------------------------------------------------------------------------
knowledge.delete("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    await store.delete(id);
    return c.json({ ok: true, deleted: id });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { knowledge as knowledgeRoutes };
