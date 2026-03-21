import { readFile, readdir, stat, access } from "node:fs/promises";
import { join, dirname, relative, resolve, extname } from "node:path";

export interface DebtItem {
  type:
    | "missing_crosslink"
    | "missing_hub"
    | "orphan_doc"
    | "broken_link"
    | "stale_doc";
  path: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Collect all .md files under a directory */
async function collectMd(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue;
        results.push(...(await collectMd(full)));
      } else if (extname(entry.name) === ".md") {
        results.push(full);
      }
    }
  } catch {
    // skip
  }
  return results;
}

/** Extract markdown links [text](path) from content */
function extractLinks(content: string): string[] {
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(content)) !== null) {
    const href = m[2];
    // only relative links (no http, no anchors-only)
    if (!href.startsWith("http") && !href.startsWith("#")) {
      links.push(href.split("#")[0]); // strip anchor
    }
  }
  return links;
}

/** Check if content has a "## Related" section with at least one markdown link */
function hasCrosslinkSection(content: string): boolean {
  const relatedIdx = content.indexOf("## Related");
  if (relatedIdx === -1) return false;
  const after = content.slice(relatedIdx);
  return /\[([^\]]+)\]\(([^)]+)\)/.test(after);
}

/** Find hub/index docs in a folder */
async function findHubDoc(dir: string): Promise<string | null> {
  const candidates = ["index.md", "hub.md", "README.md", "_index.md"];
  for (const c of candidates) {
    const p = join(dir, c);
    if (await fileExists(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main integrity check
// ---------------------------------------------------------------------------
export async function checkIntegrity(
  modifiedDocs: string[],
  basePath: string,
): Promise<{ pass: boolean; debts: DebtItem[] }> {
  const debts: DebtItem[] = [];

  for (const doc of modifiedDocs) {
    const fullPath = resolve(basePath, doc);

    let content: string;
    try {
      content = await readFile(fullPath, "utf-8");
    } catch {
      // file doesn't exist or unreadable — skip
      continue;
    }

    // 1. Crosslink check
    if (!hasCrosslinkSection(content)) {
      debts.push({
        type: "missing_crosslink",
        path: doc,
        description: `Missing "## Related" section with crosslinks`,
      });
    }

    // 2. Hub registration check
    const folder = dirname(fullPath);
    const hubDoc = await findHubDoc(folder);
    if (hubDoc) {
      const hubContent = await readFile(hubDoc, "utf-8");
      const docBasename = fullPath.split("/").pop() ?? "";
      if (!hubContent.includes(docBasename)) {
        debts.push({
          type: "missing_hub",
          path: doc,
          description: `Not listed in hub doc ${relative(basePath, hubDoc)}`,
        });
      }
    }

    // 3. Link validation
    const links = extractLinks(content);
    for (const link of links) {
      const resolved = resolve(dirname(fullPath), link);
      if (!(await fileExists(resolved))) {
        debts.push({
          type: "broken_link",
          path: doc,
          description: `Broken link: ${link}`,
        });
      }
    }

    // 4. Staleness check (frontmatter)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const fm = frontmatterMatch[1];
      if (/status:\s*(deprecated|stale)/i.test(fm)) {
        debts.push({
          type: "stale_doc",
          path: doc,
          description: `Doc is marked as deprecated/stale in frontmatter`,
        });
      }
    }
  }

  // 5. Orphan detection — scan all docs in basePath, find ones not referenced by any hub
  try {
    const allDocs = await collectMd(basePath);
    for (const docPath of allDocs) {
      const folder = dirname(docPath);
      const hubDoc = await findHubDoc(folder);
      if (!hubDoc || hubDoc === docPath) continue;

      const hubContent = await readFile(hubDoc, "utf-8");
      const basename = docPath.split("/").pop() ?? "";
      // Skip hub docs themselves
      if (
        ["index.md", "hub.md", "README.md", "_index.md"].includes(basename)
      ) {
        continue;
      }

      if (!hubContent.includes(basename)) {
        debts.push({
          type: "orphan_doc",
          path: relative(basePath, docPath),
          description: `Orphan: not referenced by ${relative(basePath, hubDoc)}`,
        });
      }
    }
  } catch {
    // basePath may not be a valid directory
  }

  return { pass: debts.length === 0, debts };
}
