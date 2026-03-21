import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

export interface SearchResult {
  path: string;
  relevanceScore: number;
  excerpt: string;
  matchedKeywords: string[];
}

// ---------------------------------------------------------------------------
// Walk a directory tree collecting .md file paths
// ---------------------------------------------------------------------------
async function walkMd(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // skip node_modules / hidden dirs
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue;
        results.push(...(await walkMd(fullPath)));
      } else if (extname(entry.name) === ".md") {
        results.push(fullPath);
      }
    }
  } catch {
    // directory may not exist — skip
  }
  return results;
}

// ---------------------------------------------------------------------------
// Search docs by keyword matching
// ---------------------------------------------------------------------------
export async function searchDocs(
  keywords: string[],
  searchPaths: string[],
  maxResults = 5,
  maxTotalChars = 2000,
): Promise<SearchResult[]> {
  const allFiles: string[] = [];

  for (const searchPath of searchPaths) {
    try {
      const info = await stat(searchPath);
      if (info.isDirectory()) {
        allFiles.push(...(await walkMd(searchPath)));
      } else if (extname(searchPath) === ".md") {
        allFiles.push(searchPath);
      }
    } catch {
      // path doesn't exist — skip
    }
  }

  const scored: SearchResult[] = [];

  for (const filePath of allFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const lower = content.toLowerCase();
      const matched: string[] = [];

      for (const kw of keywords) {
        if (lower.includes(kw.toLowerCase())) {
          matched.push(kw);
        }
      }

      // Must match at least 2 keywords to qualify
      if (matched.length < 2) continue;

      const excerpt = content.slice(0, 400);

      scored.push({
        path: filePath,
        relevanceScore: matched.length,
        excerpt,
        matchedKeywords: matched,
      });
    } catch {
      // unreadable file — skip
    }
  }

  // Sort by relevance desc, take top N
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const topResults = scored.slice(0, maxResults);

  // Trim total excerpt chars to maxTotalChars
  let totalChars = 0;
  const trimmed: SearchResult[] = [];
  for (const r of topResults) {
    const remaining = maxTotalChars - totalChars;
    if (remaining <= 0) break;
    if (r.excerpt.length > remaining) {
      trimmed.push({ ...r, excerpt: r.excerpt.slice(0, remaining) });
      totalChars += remaining;
    } else {
      trimmed.push(r);
      totalChars += r.excerpt.length;
    }
  }

  return trimmed;
}
