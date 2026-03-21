import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeEntry } from "./types.js";
import type { KnowledgeStore } from "./store.js";

export class LocalKnowledgeStore implements KnowledgeStore {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private entryPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private async readEntry(filePath: string): Promise<KnowledgeEntry> {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as KnowledgeEntry;
  }

  private async allEntries(): Promise<KnowledgeEntry[]> {
    await this.ensureDir();
    const files = await readdir(this.dir);
    const jsonFiles = files.filter((f: string) => f.endsWith(".json"));
    const entries: KnowledgeEntry[] = [];
    for (const file of jsonFiles) {
      try {
        entries.push(await this.readEntry(join(this.dir, file)));
      } catch {
        // skip corrupt files
      }
    }
    return entries;
  }

  async store(
    input: Omit<KnowledgeEntry, "id" | "createdAt">,
  ): Promise<KnowledgeEntry> {
    await this.ensureDir();
    const entry: KnowledgeEntry = {
      ...input,
      id: randomUUID(),
      tags: input.tags ?? [],
      source: input.source ?? "MANUAL",
      confidence: input.confidence ?? 1.0,
      createdAt: new Date().toISOString(),
    };
    await writeFile(this.entryPath(entry.id), JSON.stringify(entry, null, 2));
    return entry;
  }

  async search(query: string, limit = 10): Promise<KnowledgeEntry[]> {
    const entries = await this.allEntries();
    const lower = query.toLowerCase();

    const scored = entries
      .map((entry) => {
        let score = 0;
        if (entry.topic.toLowerCase().includes(lower)) score += 3;
        if (entry.content.toLowerCase().includes(lower)) score += 2;
        for (const tag of entry.tags) {
          if (tag.toLowerCase().includes(lower)) score += 1;
        }
        return { entry, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((r) => r.entry);
  }

  async getByTopic(topic: string): Promise<KnowledgeEntry[]> {
    const entries = await this.allEntries();
    const lower = topic.toLowerCase();
    return entries.filter((e) => e.topic.toLowerCase() === lower);
  }

  async getByTags(tags: string[]): Promise<KnowledgeEntry[]> {
    const entries = await this.allEntries();
    const lowerTags = new Set(tags.map((t) => t.toLowerCase()));
    return entries.filter((e) =>
      e.tags.some((t) => lowerTags.has(t.toLowerCase())),
    );
  }

  async status(): Promise<{
    totalEntries: number;
    topics: number;
    lastUpdated?: string;
  }> {
    const entries = await this.allEntries();
    const topics = new Set(entries.map((e) => e.topic)).size;

    let lastUpdated: string | undefined;
    for (const entry of entries) {
      const ts = entry.updatedAt || entry.createdAt;
      if (!lastUpdated || ts > lastUpdated) lastUpdated = ts;
    }

    return { totalEntries: entries.length, topics, lastUpdated };
  }

  async delete(id: string): Promise<void> {
    await unlink(this.entryPath(id));
  }
}
