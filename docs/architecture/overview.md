# clab-platform Architecture Overview

## System Overview

```
                                 +---------------------+
                                 |     Dashboard       |
                                 |     (Next.js)       |
                                 +----------+----------+
                                            | WebSocket + REST
                                            v
+-------------+    REST     +---------------+---------------+
|   Client    | ---------> |           API Gateway          |
| (CLI/Web)   |            |            (Hono)              |
+-------------+            +---------------+---------------+
                                           |
                           +---------------+---------------+
                           |                               |
                    REST   v                        REST   v
              +------------+--------+        +-------------+---------+
              |   Orchestrator      |        |   Review Service       |
              | (Mission Planning)  |        | (Quality Gate)         |
              +------------+--------+        +-------------+---------+
                           |                               ^
                    REST   v                               |
              +------------+--------+                      |
              |  Runtime Manager    | --------- artifacts -+
              | (cmux Lifecycle)    |
              +--+------+------+---+
                 |      |      |
          +------+  +---+  +--+------+
          v         v         v       v
     +--------+ +--------+ +--------+ +----------------+
     |Worker 1| |Worker 2| |Worker N| |Browser Service |
     |Codex/  | |Claude/ | |Codex/  | |  (cmux pane)   |
     |TUI pane| |TUI pane| |TUI pane| |                |
     +--------+ +--------+ +--------+ +----------------+

          All services publish/subscribe via NATS JetStream
         +===================================================+
         |                  NATS Event Bus                    |
         +===================================================+

         +===================================================+
         |              PostgreSQL (Source of Truth)           |
         +===================================================+
```

## Service Descriptions

### API Gateway

The single entry point for all external requests. Built with Hono, it handles:

- **Authentication and authorization** for incoming requests
- **Request routing** to downstream services
- **WebSocket upgrade** for dashboard real-time connections
- **Rate limiting** and request validation
- **Health check aggregation** across all services

All client interactions (CLI, web dashboard, API consumers) go through this gateway.

### Orchestrator

The brain of the platform. Responsible for:

- **Mission intake** — receives high-level user goals and creates Mission records
- **Plan generation** — decomposes a mission into a structured plan with waves and tasks
- **Wave scheduling** — determines which tasks can run in parallel vs. sequentially
- **Progress tracking** — monitors task completions and triggers subsequent waves
- **Failure handling** — decides whether to retry, skip, or abort on task failure

The orchestrator does not execute any tasks itself. It purely coordinates.

### Runtime Manager

Manages the lifecycle of agent sessions and their `cmux` bindings:

- **Sticky session provisioning** — keeps one reusable session per `workspace + role + engine`
- **Pane management** — workers split the current workspace and bind a persistent `cmux` pane the first time a session runs
- **Health monitoring** — heartbeat checks on active sessions, marks stale ones
- **Resource management** — returns finished sessions to `IDLE` without closing their panes
- **Result collection** — stores pane output snapshots and artifacts from completed task runs

### Workers

Worker services attach tasks to interactive TUIs inside `cmux` panes:

- `worker-codex` launches the `codex` TUI for `CODEX` tasks
- `worker-claude` launches the `claude` TUI for `CLAUDE` tasks
- Each worker reuses the pane already assigned to its sticky agent session
- Each worker pastes a rendered prompt into the pane and submits it through the interactive TUI rather than using one-shot batch flags
- Workers detect completion from pane-scoped `cmux` notifications first, then fall back to TUI idle/output checks
- Workers store the final pane transcript as task output and emit completion events

### Browser Service

Provides browser automation capabilities via Playwright:

- **Page navigation and interaction** — click, fill, type, evaluate JavaScript
- **Screenshot capture** — visual verification of web-based tasks
- **DOM snapshotting** — structured page content extraction
- **Shared browser sessions** — multiple tasks can interact with the same browser context

Used for tasks that require web interaction (testing UIs, scraping, form submission).

### Review Service

Quality gate that validates task outputs before marking them complete:

- **Artifact review** — checks generated code, files, and outputs against acceptance criteria
- **Automated checks** — runs linting, type-checking, test suites on produced artifacts
- **Human-in-the-loop** — can pause for manual review when confidence is low
- **Approval/rejection** — feeds results back to the mission service for next-step decisions

### Dashboard

Real-time web interface for monitoring and control:

- **Mission overview** — see all active and completed missions
- **Wave visualization** — track which wave is executing, which tasks are in flight
- **Worker status** — live view of all agent sessions and their health
- **Event stream** — real-time log of all system events via WebSocket
- **Manual intervention** — retry tasks, abort missions, adjust plans

## Data Flow

```
User Request
    |
    v
[API Gateway] -- POST /missions --> [Mission Service]
    |                                      |
    |                               Creates Mission
    |                               Generates Plan
    |                               Schedules Wave 1
    |                                      |
    |                                      v
    |                              [Runtime Manager]
    |                                  |   |   |
    |                          dispatch tasks to workers
    |                                  |   |   |
    |                                  v   v   v
    |                           [Worker] [Worker] [Worker]
    |                              |       |       |
    |                          artifacts + status reported
    |                              |       |       |
    |                              v       v       v
    |                              [Review Service]
    |                                      |
    |                              approve / reject
    |                                      |
    |                                      v
    |                              [Mission Service]
    |                              Wave 1 complete?
    |                              Schedule Wave 2...
    |                                      |
    |                              ... repeat until done ...
    |                                      |
    |                              Mission COMPLETED
    |                                      |
    v                                      v
[Dashboard] <---- WebSocket events ---- [NATS]
```

### Step-by-step

1. **User submits a request** via CLI or dashboard. The API gateway routes it to the mission service.
2. **Orchestrator creates a Mission** record in PostgreSQL and generates a Plan.
3. **Plan is decomposed into Waves**, each containing parallelizable Tasks.
4. **Wave 1 is scheduled**. The orchestrator emits `task.assigned`.
5. **Runtime manager provisions or reuses a sticky session** for the same workspace/role/engine and records the pane binding.
6. **Workers attach the task to the existing `cmux` pane** for that session, launch the interactive TUI if needed, and paste the rendered prompt.
7. **Review service validates outputs** against acceptance criteria.
8. **Orchestrator receives results**, marks tasks complete/failed, and decides next steps.
9. **If the wave is complete**, the next wave is scheduled. Repeat until all waves done.
10. **Mission is marked COMPLETED** (or FAILED if unrecoverable).
11. **Throughout this process**, NATS events are emitted and the dashboard updates in real-time.

## Communication Patterns

### REST (Synchronous, Request-Response)

Used for **service-to-service commands** where an immediate response is needed:

| Route                          | From              | To               | Purpose                     |
| ------------------------------ | ----------------- | ---------------- | --------------------------- |
| `POST /missions`               | API Gateway       | Orchestrator     | Create new mission          |
| `POST /missions/:id/start`     | API Gateway       | Orchestrator     | Start mission execution     |
| `POST /sessions/:id/heartbeat` | Workers           | Runtime Manager  | Report pane/session liveness|
| `POST /reviews`                | Runtime Manager   | Review Service   | Submit artifact for review  |
| `GET /health`                  | API Gateway       | All services     | Health check aggregation    |

### NATS JetStream (Asynchronous, Pub/Sub)

Used for **events and notifications** where decoupling is essential:

| Subject                        | Publisher         | Subscribers              | Purpose                        |
| ------------------------------ | ----------------- | ------------------------ | ------------------------------ |
| `mission.created`              | Orchestrator      | Dashboard, Audit         | New mission notification       |
| `mission.completed`            | Orchestrator      | Dashboard, Notifications | Mission done                   |
| `wave.started`                 | Orchestrator      | Dashboard, Runtime Mgr   | Wave execution begins          |
| `task.assigned`                | Orchestrator      | Runtime Manager, Workers | Task assigned to a role/engine |
| `task.run.completed`           | Workers           | Orchestrator, Dashboard, Runtime Mgr | Task finished      |
| `task.run.failed`              | Workers           | Orchestrator, Dashboard  | Task errored                   |
| `session.heartbeat`            | Workers           | Runtime Manager          | Worker alive signal            |
| `review.approved`              | Review Service    | Orchestrator             | Artifact passed review         |
| `review.rejected`              | Review Service    | Orchestrator             | Artifact failed review         |

### WebSocket (Real-time, Bidirectional)

Used between the **dashboard and API gateway** for live updates:

- Gateway subscribes to relevant NATS subjects and forwards events to connected WebSocket clients
- Dashboard sends control commands (retry, abort) back through the WebSocket

## Database

**PostgreSQL** is the single source of truth for all state:

- All mission, plan, wave, task, and session records live in PostgreSQL
- JSONB columns store flexible metadata (task specs, artifact manifests, agent configs)
- Drizzle ORM provides type-safe queries with SQL-like syntax
- Migrations are managed via `drizzle-kit` and run at deployment time
- `LISTEN/NOTIFY` is used for lightweight intra-process signaling where NATS would be overkill

See [Domain Model](./domain-model.md) for the full entity relationship diagram.

## Key Design Decisions

### Why Microservices?

clab v1 was a monolithic MCP server. As capabilities grew, we hit pain points:

- **Deployment coupling** — a change to browser logic required redeploying everything
- **Scaling constraints** — couldn't scale workers independently from the mission service
- **Blast radius** — a crash in one subsystem took down the whole process

Microservices let each component evolve, scale, and fail independently. The trade-off is operational complexity, mitigated by shared packages and a monorepo structure.

See [ADR-001: Monorepo Structure](../adr/001-monorepo-structure.md).

### Why NATS?

We needed an event bus that is:

- **Lightweight** — single binary, minimal resource footprint
- **Durable** — JetStream provides at-least-once delivery and replay
- **Language-agnostic** — workers might be non-Node processes in the future
- **Operationally simple** — easier to run than Kafka or RabbitMQ

See [ADR-003: NATS Event Bus](../adr/003-nats-event-bus.md).

### Why Drizzle?

Over Prisma, Drizzle offers:

- **No code generation step** — schema changes are immediately reflected in types
- **SQL-like API** — developers write queries that map directly to SQL, no "magic"
- **Lighter runtime** — smaller bundle, faster startup
- **Better composability** — queries are just functions, easy to build dynamically

See [ADR-005: Drizzle ORM](../adr/005-drizzle-orm.md).

### Why Hono?

Over Express or Fastify:

- **TypeScript-first** — built for TypeScript from day one, excellent type inference
- **Fast** — benchmarks consistently near the top for Node.js frameworks
- **Edge-ready** — runs on Cloudflare Workers, Deno, Bun, and Node.js
- **Minimal** — small API surface, less magic, easier to reason about

See [ADR-004: Hono Framework](../adr/004-hono-framework.md).
