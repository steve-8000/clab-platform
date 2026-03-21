import {
  connect,
  type NatsConnection,
  type Subscription as NatsSub,
  StringCodec,
  type JetStreamClient,
  type JetStreamManager,
  type ConsumerConfig,
  AckPolicy,
  DeliverPolicy,
} from "nats";
import { EventEnvelopeSchema, type EventEnvelope } from "./envelope.js";

const sc = StringCodec();

/** Convert dotted event type to NATS subject: task.run.completed → clab.task.run.completed */
function toSubject(eventType: string): string {
  return `clab.${eventType}`;
}

export interface Subscription {
  unsubscribe(): void;
}

export class EventBus {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;
  private subs: NatsSub[] = [];

  /** Connect to NATS. Defaults to localhost:4222. */
  async connect(url?: string): Promise<void> {
    this.nc = await connect({ servers: url ?? "nats://localhost:4222" });
    this.jsm = await this.nc.jetstreamManager();
    this.js = this.nc.jetstream();

    // Ensure the clab stream exists (idempotent)
    try {
      await this.jsm.streams.info("CLAB");
    } catch {
      await this.jsm.streams.add({
        name: "CLAB",
        subjects: ["clab.>"],
        retention: "limits" as unknown as import("nats").RetentionPolicy,
        max_bytes: 1_073_741_824, // 1 GiB
        max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
        storage: "file" as unknown as import("nats").StorageType,
        num_replicas: 1,
      });
    }
  }

  /** Publish an event to NATS JetStream. */
  async publish(event: EventEnvelope): Promise<void> {
    if (!this.js) throw new Error("EventBus not connected");
    const validated = EventEnvelopeSchema.parse(event);
    const subject = toSubject(validated.type);
    const data = sc.encode(JSON.stringify(validated));
    await this.js.publish(subject, data);
  }

  /** Subscribe to events matching a pattern (core NATS, non-durable). Pattern uses dots, e.g. "task.run.*" → "clab.task.run.*". */
  async subscribe(
    pattern: string,
    handler: (event: EventEnvelope) => Promise<void>,
  ): Promise<Subscription> {
    if (!this.nc) throw new Error("EventBus not connected");
    const subject = toSubject(pattern);
    const sub = this.nc.subscribe(subject);
    this.subs.push(sub);

    // Process messages in background
    (async () => {
      for await (const msg of sub) {
        try {
          const raw = JSON.parse(sc.decode(msg.data));
          const envelope = EventEnvelopeSchema.parse(raw);
          await handler(envelope);
        } catch (err) {
          console.error(`[EventBus] handler error on ${subject}:`, err);
        }
      }
    })();

    return {
      unsubscribe: () => sub.unsubscribe(),
    };
  }

  /** Subscribe via JetStream durable consumer for reliable, at-least-once delivery. */
  async subscribeStream(
    stream: string,
    consumer: string,
    handler: (event: EventEnvelope) => Promise<void>,
    filterSubject?: string,
  ): Promise<void> {
    if (!this.js || !this.jsm) throw new Error("EventBus not connected");

    // Ensure consumer exists (idempotent upsert)
    const consumerConfig: Partial<ConsumerConfig> = {
      durable_name: consumer,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      ...(filterSubject ? { filter_subject: filterSubject } : {}),
    };

    try {
      await this.jsm.consumers.info(stream, consumer);
    } catch {
      await this.jsm.consumers.add(stream, consumerConfig);
    }

    const c = await this.js.consumers.get(stream, consumer);
    const messages = await c.consume();

    (async () => {
      for await (const msg of messages) {
        try {
          const raw = JSON.parse(sc.decode(msg.data));
          const envelope = EventEnvelopeSchema.parse(raw);
          await handler(envelope);
          msg.ack();
        } catch (err) {
          console.error(`[EventBus] stream handler error on ${stream}/${consumer}:`, err);
          msg.nak();
        }
      }
    })();
  }

  /** Gracefully close all subscriptions and the NATS connection. */
  async close(): Promise<void> {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
    this.subs = [];
    if (this.nc) {
      await this.nc.drain();
      this.nc = null;
      this.js = null;
      this.jsm = null;
    }
  }
}
