import { Hono } from "hono";
import {
  checkIntegrity,
  type DebtItem,
} from "../services/integrity-checker.js";

export interface PostKnowledgeDebt {
  pass: boolean;
  debts: DebtItem[];
  summary: {
    total: number;
    missingCrosslinks: number;
    missingHub: number;
    orphanDocs: number;
    brokenLinks: number;
    staleDocs: number;
  };
  missionId?: string;
}

const postK = new Hono();

// ---------------------------------------------------------------------------
// POST /check — Post-Knowledge verification
// ---------------------------------------------------------------------------
postK.post("/check", async (c) => {
  const body = await c.req.json<{
    modifiedDocs: string[];
    missionId?: string;
    basePath?: string;
  }>();

  if (!body.modifiedDocs || body.modifiedDocs.length === 0) {
    return c.json({ ok: false, error: "modifiedDocs array is required" }, 400);
  }

  const basePath = body.basePath ?? process.cwd();

  try {
    const { pass, debts } = await checkIntegrity(body.modifiedDocs, basePath);

    const summary = {
      total: debts.length,
      missingCrosslinks: debts.filter((d) => d.type === "missing_crosslink")
        .length,
      missingHub: debts.filter((d) => d.type === "missing_hub").length,
      orphanDocs: debts.filter((d) => d.type === "orphan_doc").length,
      brokenLinks: debts.filter((d) => d.type === "broken_link").length,
      staleDocs: debts.filter((d) => d.type === "stale_doc").length,
    };

    const result: PostKnowledgeDebt = {
      pass,
      debts,
      summary,
      missionId: body.missionId,
    };

    return c.json({ ok: true, postK: result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { postK as postKRoutes };
