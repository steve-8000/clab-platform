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
let busPromise: Promise<void> | null = null;

export function ensureBus(): Promise<void> {
  if (busConnected) return Promise.resolve();
  if (!busPromise) {
    busPromise = bus.connect().then(() => { busConnected = true; }).catch((err: unknown) => {
      busPromise = null;
      throw err;
    });
  }
  return busPromise;
}

export function isBusConnected(): boolean {
  return busConnected;
}
