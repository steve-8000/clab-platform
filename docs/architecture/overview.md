# clab-platform Architecture Overview

## System Overview

```
                                 +---------------------+
                                 |     Dashboard       |
                                 |     (Next.js)       |
                                 +----------+----------+
                                            | REST (5s polling)
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
              | (Session Lifecycle) |
              +--+------+------+---+
                 |      |      |
          +------+  +---+  +--+------+
          v         v         v       v
     +--------+ +--------+ +--------+ +----------------+
     |Worker  | |Worker  | |Worker  | |Browser Service |
     |Codex   | |Claude  | |Codex   | |  (Playwright)  |
     |        | |        | |        | |                |
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

- **Request routing** to downstream services (orchestrator, runtime-manager, review-service, knowledge-service)
- **CORS management** for dashboard cross-origin requests
- **Health check aggregation** across all services
- **Dashboard data aggregation** via the `/v1/dashboard` endpoint

All client interactions (CLI, web dashboard, API consumers) go through this gateway.

### Orchestrator

The brain of the platform. Responsible for:

- **Mission intake** -- receives high-level user goals and creates Mission records
- **Plan generation** -- decomposes a mission into a structured plan with waves and tasks
- **Wave scheduling** -- determines which tasks can run in parallel vs. sequentially
- **Progress tracking** -- monitors task completions and triggers subsequent waves
- **Failure handling** -- decides whether to retry, skip, or abort on task failure
- **Policy enforcement** -- evaluates capabilities and approval gates via the PolicyEngine

The orchestrator does not execute any tasks itself. It purely coordinates.

### Runtime Manager

Manages the lifecycle of agent sessions:

- **Session provisioning** -- creates and reuses sessions per `workspace + role + engine`
- **Health monitoring** -- heartbeat checks on active sessions (30s interval, 2min stale threshold, 5min lost threshold)
- **State management** -- tracks session state transitions (IDLE -> BOUND -> RUNNING -> IDLE or CLOSED)
- **Resource management** -- returns finished sessions to `IDLE` for reuse
- **Result collection** -- stores output and artifacts from completed task runs

### Workers

Worker services execute tasks using AI CLI tools:

- `worker-codex` launches Codex CLI for `CODEX` engine tasks
- `worker-claude` launches Claude CLI for `CLAUDE` engine tasks
- Each worker binds to an agent session managed by the runtime manager
- Workers report heartbeats to maintain session liveness
- Workers store task output and emit completion events

### Browser Service

Provides browser automation capabilities via Playwright:

- **Page navigation and interaction** -- click, fill, type, evaluate JavaScript
- **Screenshot capture** -- visual verification of web-based tasks
- **DOM snapshotting** -- structured page content extraction
- **Shared browser sessions** -- multiple tasks can interact with the same browser context

Used for tasks that require web interaction (testing UIs, scraping, form submission).

### Review Service

Quality gate that validates task outputs before marking them complete:

- **Artifact review** -- checks generated code, files, and outputs against acceptance criteria
- **Automated checks** -- runs linting, type-checking, test suites on produced artifacts
- **Human-in-the-loop** -- can pause for manual review when confidence is low
- **Approval management** -- manages approval requests and resolution for high-risk operations

### Knowledge Service

Persistent knowledge layer (AKB -- Agent Knowledge Base):

- **Knowledge storage** -- stores extracted insights, decisions, and learnings
- **Search** -- full-text search across knowledge entries
- **Insights** -- derived insights from accumulated knowledge
- **Integration** -- pre-K and post-K knowledge injection for task prompts

### Dashboard

Web interface for monitoring and control:

- **Mission overview** -- see all active and completed missions
- **Wave visualization** -- track which wave is executing, which tasks are in flight
- **Session status** -- view of all agent sessions and their health
- **Knowledge panel** -- browse knowledge entries and insights
- **Pipeline view** -- AI workflow pipeline statistics
- **Manual intervention** -- retry tasks, abort missions, resolve approvals

The dashboard uses **5-second polling** against the API gateway's `/v1/dashboard` endpoint for data updates.

## Data Flow

```
User Request
    |
    v
[API Gateway] -- POST /v1/missions --> [Orchestrator]
    |                                      |
    |                               Creates Mission
    |                               Generates Plan
    |                               Schedules Wave 1
    |                                      |
    |                                      v
    |                              [Runtime Manager]
    |                                  |   |   |
    |                          assign tasks to sessions
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
    |                              [Orchestrator]
    |                              Wave 1 complete?
    |                              Schedule Wave 2...
    |                                      |
    |                              ... repeat until done ...
    |                                      |
    |                              Mission COMPLETED
    |                                      |
    v                                      v
[Dashboard] <---- 5s polling ---- [API Gateway] <-- [NATS]
```

### Step-by-step

1. **User submits a request** via CLI or dashboard. The API gateway routes it to the orchestrator.
2. **Orchestrator creates a Mission** record in PostgreSQL and generates a Plan.
3. **Plan is decomposed into Waves**, each containing parallelizable Tasks.
4. **Wave 1 is scheduled**. The orchestrator emits `task.assigned`.
5. **Runtime manager provisions or reuses a session** for the same workspace/role/engine.
6. **Workers execute the task**, report heartbeats, and emit completion events.
7. **Review service validates outputs** against acceptance criteria.
8. **Orchestrator receives results**, marks tasks succeeded/failed, and decides next steps.
9. **If the wave is complete**, the next wave is scheduled. Repeat until all waves done.
10. **Mission is marked COMPLETED** (or FAILED if unrecoverable).
11. **Throughout this process**, NATS events are emitted and the dashboard polls for updates.

## Communication Patterns

### REST (Synchronous, Request-Response)

Used for **service-to-service commands** where an immediate response is needed:

| Route                          | From              | To               | Purpose                     |
| ------------------------------ | ----------------- | ---------------- | --------------------------- |
| `POST /v1/missions`           | API Gateway       | Orchestrator     | Create new mission          |
| `POST /v1/missions/:id/start` | API Gateway       | Orchestrator     | Start mission execution     |
| `POST /sessions/:id/heartbeat`| Workers           | Runtime Manager  | Report session liveness     |
| `POST /reviews`               | Runtime Manager   | Review Service   | Submit artifact for review  |
| `GET /health`                 | API Gateway       | All services     | Health check aggregation    |

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

## Database

**PostgreSQL** is the single source of truth for all state:

- All mission, plan, wave, task, and session records live in PostgreSQL
- JSONB columns store flexible metadata (task specs, artifact manifests, agent configs)
- Drizzle ORM provides type-safe queries with SQL-like syntax
- Migrations are managed via `drizzle-kit` and run at deployment time

See [Domain Model](./domain-model.md) for the full entity relationship diagram.

## Key Design Decisions

### Why Microservices?

clab v1 was a monolithic MCP server. As capabilities grew, we hit pain points:

- **Deployment coupling** -- a change to browser logic required redeploying everything
- **Scaling constraints** -- couldn't scale workers independently from the orchestrator
- **Blast radius** -- a crash in one subsystem took down the whole process

Microservices let each component evolve, scale, and fail independently. The trade-off is operational complexity, mitigated by shared packages and a monorepo structure.

See [ADR-001: Monorepo Structure](../adr/001-monorepo-structure.md).

### Why NATS?

We needed an event bus that is:

- **Lightweight** -- single binary, minimal resource footprint
- **Durable** -- JetStream provides at-least-once delivery and replay
- **Language-agnostic** -- workers might be non-Node processes in the future
- **Operationally simple** -- easier to run than Kafka or RabbitMQ

See [ADR-003: NATS Event Bus](../adr/003-nats-event-bus.md).

### Why Drizzle?

Over Prisma, Drizzle offers:

- **No code generation step** -- schema changes are immediately reflected in types
- **SQL-like API** -- developers write queries that map directly to SQL, no "magic"
- **Lighter runtime** -- smaller bundle, faster startup
- **Better composability** -- queries are just functions, easy to build dynamically

See [ADR-005: Drizzle ORM](../adr/005-drizzle-orm.md).

### Why Hono?

Over Express or Fastify:

- **TypeScript-first** -- built for TypeScript from day one, excellent type inference
- **Fast** -- benchmarks consistently near the top for Node.js frameworks
- **Edge-ready** -- runs on Cloudflare Workers, Deno, Bun, and Node.js
- **Minimal** -- small API surface, less magic, easier to reason about

See [ADR-004: Hono Framework](../adr/004-hono-framework.md).
