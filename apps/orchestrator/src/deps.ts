import { createDb, type Database } from "@clab/db";
import { EventBus } from "@clab/events";
import { createLogger } from "@clab/telemetry";
import { MissionPlanner } from "./services/planner.js";
import { WaveScheduler } from "./services/scheduler.js";
import { RoleRouter } from "./services/role-router.js";

const logger = createLogger("orchestrator:deps");

// ---------------------------------------------------------------------------
// Singleton instances — initialized lazily on first access
// ---------------------------------------------------------------------------

let _db: Database | null = null;
let _bus: EventBus | null = null;
let _planner: MissionPlanner | null = null;
let _scheduler: WaveScheduler | null = null;
let _router: RoleRouter | null = null;

export function getDb(): Database {
  if (!_db) {
    _db = createDb();
    logger.info("Database connection created");
  }
  return _db;
}

export function getBus(): EventBus {
  if (!_bus) {
    _bus = new EventBus();
    // Connection is async — callers should await connectBus() at startup
    logger.info("EventBus instance created (call connectBus to connect)");
  }
  return _bus;
}

export async function connectBus(): Promise<EventBus> {
  const bus = getBus();
  const natsUrl = process.env.NATS_URL || "nats://localhost:4222";
  try {
    await bus.connect(natsUrl);
    logger.info("EventBus connected", { natsUrl });
  } catch (err) {
    logger.warn("EventBus connection failed — running without events", {
      natsUrl,
      error: String(err),
    });
  }
  return bus;
}

export function getPlanner(): MissionPlanner {
  if (!_planner) {
    _planner = new MissionPlanner();
  }
  return _planner;
}

export function getScheduler(): WaveScheduler {
  if (!_scheduler) {
    _scheduler = new WaveScheduler(getDb(), getBus());
  }
  return _scheduler;
}

export function getRouter(): RoleRouter {
  if (!_router) {
    _router = new RoleRouter();
  }
  return _router;
}
