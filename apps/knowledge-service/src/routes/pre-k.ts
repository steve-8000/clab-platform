import { Hono } from "hono";
import { LocalKnowledgeStore } from "@clab/knowledge";
import { extractKeywords } from "../services/keyword-extractor.js";
import { searchDocs } from "../services/doc-searcher.js";
import type { SearchResult } from "../services/doc-searcher.js";

const STORE_DIR = process.env.KNOWLEDGE_STORE_DIR ?? ".knowledge-data";
const store = new LocalKnowledgeStore(STORE_DIR);

export interface PreKnowledgeResult {
  keywords: string[];
  knowledgeEntries: Array<{
    id: string;
    topic: string;
    excerpt: string;
    relevance: number;
  }>;
  projectDocs: SearchResult[];
  warnings: string[];
  totalChars: number;
}

const preK = new Hono();

// ---------------------------------------------------------------------------
// POST /retrieve — Pre-Knowledge retrieval for a task
// ---------------------------------------------------------------------------
preK.post("/retrieve", async (c) => {
  const body = await c.req.json<{
    task: string;
    roleId: string;
    scope?: string[];
  }>();

  if (!body.task || !body.roleId) {
    return c.json({ ok: false, error: "task and roleId are required" }, 400);
  }

  try {
    // 1. Extract keywords from task description
    const keywords = extractKeywords(body.task, 8);

    // 2. Search knowledge store for matching entries
    const knowledgeEntries: PreKnowledgeResult["knowledgeEntries"] = [];
    const warnings: string[] = [];

    for (const kw of keywords) {
      const matches = await store.search(kw, 3);
      for (const entry of matches) {
        // Deduplicate by id
        if (knowledgeEntries.some((e) => e.id === entry.id)) continue;

        const excerpt = entry.content.slice(0, 300);
        const relevance =
          keywords.filter(
            (k) =>
              entry.content.toLowerCase().includes(k) ||
              entry.topic.toLowerCase().includes(k),
          ).length / keywords.length;

        knowledgeEntries.push({
          id: entry.id,
          topic: entry.topic,
          excerpt,
          relevance,
        });
      }
    }

    // Sort by relevance desc, take top 5
    knowledgeEntries.sort((a, b) => b.relevance - a.relevance);
    const topEntries = knowledgeEntries.slice(0, 5);

    // 3. Search project docs in scope paths
    const scopePaths = body.scope ?? [];
    let projectDocs: SearchResult[] = [];
    if (scopePaths.length > 0) {
      projectDocs = await searchDocs(keywords, scopePaths, 5, 2000);
    }

    // 4. AKB warnings
    // Check for duplicate risk — topics that closely match existing entries
    if (topEntries.length > 0) {
      const highRelevance = topEntries.filter((e) => e.relevance > 0.6);
      if (highRelevance.length > 0) {
        warnings.push(
          `Duplicate risk: ${highRelevance.length} existing knowledge entries closely match this task. Review before creating new docs.`,
        );
      }
    }

    // Related existing docs warning
    if (projectDocs.length > 0) {
      warnings.push(
        `${projectDocs.length} related project doc(s) found. Check for overlap before modifying.`,
      );
    }

    // 5. Compute total chars
    let totalChars = 0;
    for (const e of topEntries) totalChars += e.excerpt.length;
    for (const d of projectDocs) totalChars += d.excerpt.length;

    const result: PreKnowledgeResult = {
      keywords,
      knowledgeEntries: topEntries,
      projectDocs,
      warnings,
      totalChars,
    };

    return c.json({ ok: true, preK: result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { preK as preKRoutes };
