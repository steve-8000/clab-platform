import type { KnowledgeEntry } from "./types.js";

export interface KnowledgeStore {
  store(
    entry: Omit<KnowledgeEntry, "id" | "createdAt">,
  ): Promise<KnowledgeEntry>;
  search(query: string, limit?: number): Promise<KnowledgeEntry[]>;
  getByTopic(topic: string): Promise<KnowledgeEntry[]>;
  getByTags(tags: string[]): Promise<KnowledgeEntry[]>;
  status(): Promise<{
    totalEntries: number;
    topics: number;
    lastUpdated?: string;
  }>;
  delete(id: string): Promise<void>;
}
