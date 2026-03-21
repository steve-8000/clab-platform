# ADR-003: NATS JetStream for Event Bus

## Status

**Accepted** — 2026-03-01

## Context

clab-platform's microservices need an asynchronous communication mechanism for events that don't require an immediate response. Examples:

- Orchestrator emits `mission.created`; dashboard and audit logger react.
- Runtime manager emits `task.completed`; orchestrator decides next steps.
- Workers emit `session.heartbeat`; runtime manager tracks liveness.

We need a system that supports:

1. **Pub/Sub** — Multiple consumers per event.
2. **Durability** — Events must survive consumer downtime (at-least-once delivery).
3. **Replay** — Ability to replay events from a specific point for recovery or debugging.
4. **Lightweight** — Minimal operational overhead; this is a development-focused platform.
5. **Language-agnostic** — Workers may eventually be non-Node processes.

### Options Considered

1. **Redis Pub/Sub + Redis Streams**
   - Pros: Already commonly deployed, simple API.
   - Cons: Redis Pub/Sub is fire-and-forget (no durability). Redis Streams add durability but the consumer group API is awkward. Mixing two Redis paradigms adds cognitive load.

2. **RabbitMQ**
   - Pros: Mature, rich routing (exchanges, bindings), durable queues.
   - Cons: Heavier operationally (Erlang runtime), more complex configuration, overkill for our event volume.

3. **Apache Kafka**
   - Pros: Industry standard for event streaming, excellent durability and replay.
   - Cons: Very heavy (JVM, ZooKeeper/KRaft), complex to operate, massive overkill for our scale.

4. **NATS JetStream**
   - Pros: Single Go binary (~20MB), built-in persistence via JetStream, simple subject-based routing, durable consumers with replay, clients for every language, WebSocket support for browser clients.
   - Cons: Smaller community than Kafka/RabbitMQ, fewer enterprise integrations, less tooling for complex routing patterns.

## Decision

We chose **NATS with JetStream** as the event bus.

### Rationale

**Operational simplicity** is the primary driver. NATS is a single binary with no dependencies. Starting it locally is `nats-server -js`. Compare this to Kafka (JVM + KRaft) or RabbitMQ (Erlang + management plugin).

**JetStream durability** provides exactly the guarantees we need:

- **Streams** persist events to disk with configurable retention (time, size, or count).
- **Durable consumers** track their position. If a service restarts, it picks up where it left off.
- **Replay** from any sequence number enables recovery scenarios and debugging.
- **At-least-once delivery** with acknowledgment ensures events aren't lost.

**Subject-based routing** maps naturally to our domain events:

```
mission.created
mission.completed
mission.failed
wave.started
wave.completed
task.dispatched
task.completed
task.failed
session.heartbeat
review.approved
review.rejected
```

Consumers can subscribe to specific subjects or use wildcards (`task.*` for all task events).

**Language agnosticism** matters for future extensibility. NATS has official clients for Go, Rust, Python, JavaScript/TypeScript, Java, C#, C, Ruby, and more. If we ever add non-Node workers, they can participate in the event system natively.

**WebSocket support** allows the dashboard to subscribe to NATS events directly (via the API gateway's WebSocket proxy), enabling real-time updates without a separate push mechanism.

## Configuration

### Streams

| Stream     | Subjects           | Retention | Max Age | Description              |
| ---------- | ------------------ | --------- | ------- | ------------------------ |
| `MISSIONS` | `mission.*`        | Limits    | 7 days  | Mission lifecycle events |
| `WAVES`    | `wave.*`           | Limits    | 7 days  | Wave lifecycle events    |
| `TASKS`    | `task.*`           | Limits    | 7 days  | Task lifecycle events    |
| `SESSIONS` | `session.*`        | Limits    | 1 day   | Heartbeats, status       |
| `REVIEWS`  | `review.*`         | Limits    | 7 days  | Review decisions         |

### Consumers

Each service creates durable consumers for the subjects it cares about:

- **Orchestrator**: `task.completed`, `task.failed`, `review.approved`, `review.rejected`
- **Runtime Manager**: `wave.started`, `session.heartbeat`
- **Dashboard**: `mission.*`, `wave.*`, `task.*` (wildcard for full visibility)
- **Event Store**: `>` (all subjects, for persistence to PostgreSQL)

## Consequences

### Positive

- Single binary, trivial to run locally and in CI.
- JetStream provides durability, replay, and at-least-once delivery out of the box.
- Subject-based routing is intuitive and maps cleanly to domain events.
- Clients available for every major language.
- Low resource footprint (~30MB RAM for our event volume).
- Built-in monitoring via `nats` CLI tool.

### Negative

- Smaller ecosystem than Kafka or RabbitMQ; fewer third-party integrations.
- JetStream is newer than Kafka Streams; less battle-tested at extreme scale.
- No built-in dead letter queue (must implement manually via republish).
- Limited complex routing (no equivalent to RabbitMQ topic exchanges with binding keys).

### Mitigations

- Dead letter handling is implemented in `packages/nats-client` as a wrapper that republishes failed messages to a `dlq.*` subject after max retries.
- Event volume is well within NATS's comfortable operating range (hundreds of events/minute, not millions).
- The `packages/nats-client` package abstracts NATS specifics, so switching to another bus in the future would only require changing one package.
