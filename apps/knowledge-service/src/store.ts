import { LocalKnowledgeStore } from "@clab/knowledge";
import { EventBus } from "@clab/events";

// ---------------------------------------------------------------------------
// Singleton: Knowledge Store
// ---------------------------------------------------------------------------
const STORE_DIR = process.env.KNOWLEDGE_STORE_DIR ?? ".knowledge-data";
export const store = new LocalKnowledgeStore(STORE_DIR);

// ---------------------------------------------------------------------------
// Singleton: EventBus
// ---------------------------------------------------------------------------
export const bus = new EventBus();

let busConnected = false;

export async function ensureBus(): Promise<void> {
  if (busConnected) return;
  await bus.connect();
  busConnected = true;
}

export function isBusConnected(): boolean {
  return busConnected;
}
