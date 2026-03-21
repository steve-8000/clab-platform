# clab-platform Domain Model

## Entity Relationship Diagram

```
+------------------+       +------------------+       +------------------+
|     Mission      |       |      Plan        |       |      Wave        |
+------------------+       +------------------+       +------------------+
| id (PK)          |1----1 | id (PK)          |1----* | id (PK)          |
| title            |       | mission_id (FK)  |       | plan_id (FK)     |
| description      |       | strategy         |       | order            |
| status           |       | rationale        |       | status           |
| goal             |       | metadata (JSONB) |       | started_at       |
| created_by       |       | created_at       |       | completed_at     |
| created_at       |       | updated_at       |       | created_at       |
| updated_at       |       +------------------+       | updated_at       |
| completed_at     |                                   +--------+---------+
+------------------+                                            |
                                                           1    |    *
                                                                v
+------------------+       +------------------+       +------------------+
|  AgentSession    |       |    TaskRun       |       |      Task        |
+------------------+       +------------------+       +------------------+
| id (PK)          |       | id (PK)          |*----1 | id (PK)          |
| worker_id        |1----* | task_id (FK)     |       | wave_id (FK)     |
| pane_id          |       | session_id (FK)  |       | title            |
| status           |       | attempt          |       | description      |
| capabilities     |       | status           |       | type             |
| last_heartbeat   |       | started_at       |       | status           |
| mission_id (FK)  |       | completed_at     |       | priority         |
| created_at       |       | exit_code        |       | dependencies[]   |
| updated_at       |       | error_message    |       | spec (JSONB)     |
+------------------+       | output (JSONB)   |       | acceptance       |
                           | created_at       |       |   _criteria      |
                           +------------------+       | max_retries      |
                                    |                 | timeout_seconds  |
                                    | 1               | created_at       |
                                    v *               | updated_at       |
                           +------------------+       +------------------+
                           |    Artifact      |
                           +------------------+
                           | id (PK)          |
                           | task_run_id (FK) |       +------------------+
                           | type             |       |    Decision      |
                           | path             |       +------------------+
                           | content_hash     |       | id (PK)          |
                           | size_bytes       |       | mission_id (FK)  |
                           | metadata (JSONB) |       | task_id (FK)?    |
                           | created_at       |       | type             |
                           +------------------+       | title            |
                                                      | context          |
                           +------------------+       | choice           |
                           |     Event        |       | rationale        |
                           +------------------+       | alternatives[]   |
                           | id (PK)          |       | decided_by       |
                           | stream           |       | created_at       |
                           | subject          |       +------------------+
                           | payload (JSONB)  |
                           | sequence         |
                           | timestamp        |
                           +------------------+
```

## Entity Descriptions

### Mission

The top-level unit of work. A mission represents a complete user goal.

| Field         | Type      | Description                                         |
| ------------- | --------- | --------------------------------------------------- |
| `id`          | UUID      | Primary key                                         |
| `title`       | text      | Short human-readable name                           |
| `description` | text      | Detailed description of the goal                    |
| `status`      | enum      | `PENDING`, `PLANNING`, `EXECUTING`, `REVIEWING`, `COMPLETED`, `FAILED`, `CANCELLED` |
| `goal`        | text      | The original user prompt/request                    |
| `created_by`  | text      | Identifier of the requesting user or system         |
| `created_at`  | timestamp | When the mission was created                        |
| `updated_at`  | timestamp | Last modification time                              |
| `completed_at`| timestamp | When the mission reached a terminal state           |

**Status transitions:**

```
PENDING --> PLANNING --> EXECUTING --> REVIEWING --> COMPLETED
                |            |            |
                v            v            v
              FAILED       FAILED       FAILED
                                          |
                                          v
                                      CANCELLED
```

### Plan

A structured decomposition of a mission into executable waves and tasks.

| Field       | Type   | Description                                            |
| ----------- | ------ | ------------------------------------------------------ |
| `id`        | UUID   | Primary key                                            |
| `mission_id`| UUID   | Foreign key to Mission                                 |
| `strategy`  | text   | The planning strategy used (e.g., `parallel-waves`, `sequential`) |
| `rationale` | text   | Explanation of why the plan was structured this way    |
| `metadata`  | JSONB  | Additional planning context (model used, token counts) |

Each mission has exactly one active plan. If re-planning is needed (e.g., after a wave failure), the old plan is archived and a new one is created.

### Wave

A group of tasks that can execute in parallel. Waves execute sequentially (Wave 1 must complete before Wave 2 starts).

| Field          | Type      | Description                                      |
| -------------- | --------- | ------------------------------------------------ |
| `id`           | UUID      | Primary key                                      |
| `plan_id`      | UUID      | Foreign key to Plan                              |
| `order`        | integer   | Execution order (1, 2, 3, ...)                   |
| `status`       | enum      | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`      |
| `started_at`   | timestamp | When execution began                             |
| `completed_at` | timestamp | When all tasks in the wave finished              |

**Wave completion rule:** A wave is `COMPLETED` when all of its tasks are in a terminal state (`COMPLETED` or `SKIPPED`). A wave is `FAILED` if any task reaches `FAILED` status and exceeds its retry limit.

### Task

An individual unit of work assigned to a single worker.

| Field               | Type     | Description                                       |
| ------------------- | -------- | ------------------------------------------------- |
| `id`                | UUID     | Primary key                                       |
| `wave_id`           | UUID     | Foreign key to Wave                               |
| `title`             | text     | Short description                                 |
| `description`       | text     | Detailed specification for the worker             |
| `type`              | enum     | `CODE`, `TEST`, `REVIEW`, `BROWSER`, `SHELL`      |
| `status`            | enum     | `PENDING`, `DISPATCHED`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED` |
| `priority`          | integer  | Higher number = higher priority in dispatch queue |
| `dependencies`      | UUID[]   | Task IDs that must complete before this task runs |
| `spec`              | JSONB    | Task-specific configuration (files to edit, commands to run, etc.) |
| `acceptance_criteria`| text    | Human-readable criteria for review service        |
| `max_retries`       | integer  | Maximum retry attempts (default: 2)               |
| `timeout_seconds`   | integer  | Maximum execution time (default: 300)             |

**Intra-wave dependencies:** While waves provide coarse ordering, the `dependencies` array allows fine-grained ordering within a wave. A task will not be dispatched until all its dependencies are resolved.

### TaskRun

A single execution attempt of a task. A task may have multiple runs (retries).

| Field           | Type      | Description                                       |
| --------------- | --------- | ------------------------------------------------- |
| `id`            | UUID      | Primary key                                       |
| `task_id`       | UUID      | Foreign key to Task                               |
| `session_id`    | UUID      | Foreign key to AgentSession that executed this run|
| `attempt`       | integer   | Attempt number (1, 2, 3, ...)                     |
| `status`        | enum      | `RUNNING`, `COMPLETED`, `FAILED`, `TIMED_OUT`     |
| `started_at`    | timestamp | When execution began                              |
| `completed_at`  | timestamp | When execution ended                              |
| `exit_code`     | integer   | Process exit code (0 = success)                   |
| `error_message` | text      | Error details if failed                           |
| `output`        | JSONB     | Structured output from the worker                 |

### AgentSession

Represents a running Codex worker instance.

| Field            | Type      | Description                                      |
| ---------------- | --------- | ------------------------------------------------ |
| `id`             | UUID      | Primary key                                      |
| `worker_id`      | text      | Unique identifier for the worker process         |
| `pane_id`        | text      | tmux pane ID managed by cmux                     |
| `status`         | enum      | `INITIALIZING`, `IDLE`, `BUSY`, `STALE`, `TERMINATED` |
| `capabilities`   | text[]    | What this session can do (e.g., `code`, `browser`) |
| `last_heartbeat` | timestamp | Last time the worker reported alive              |
| `mission_id`     | UUID      | Foreign key to Mission (sessions are scoped)     |

**Lifecycle:**

```
INITIALIZING --> IDLE <--> BUSY --> TERMINATED
                  |                     ^
                  v                     |
                STALE ------------------+
```

- `INITIALIZING`: Pane created, Codex process starting
- `IDLE`: Ready to accept tasks
- `BUSY`: Currently executing a task
- `STALE`: Heartbeat not received within threshold (default: 30s)
- `TERMINATED`: Cleaned up and no longer running

### Artifact

A file or output produced by a task run.

| Field          | Type      | Description                                       |
| -------------- | --------- | ------------------------------------------------- |
| `id`           | UUID      | Primary key                                       |
| `task_run_id`  | UUID      | Foreign key to TaskRun                            |
| `type`         | enum      | `FILE`, `DIFF`, `LOG`, `SCREENSHOT`, `TEST_RESULT` |
| `path`         | text      | Relative file path within the workspace           |
| `content_hash` | text      | SHA-256 hash for deduplication and verification   |
| `size_bytes`   | bigint    | File size                                         |
| `metadata`     | JSONB     | Additional info (MIME type, line count, etc.)     |

Artifacts are stored on the filesystem and referenced in the database. The `content_hash` enables deduplication -- identical files across runs are stored once.

### Decision

Records important decisions made during mission execution, both automated and human.

| Field          | Type      | Description                                       |
| -------------- | --------- | ------------------------------------------------- |
| `id`           | UUID      | Primary key                                       |
| `mission_id`   | UUID      | Foreign key to Mission                            |
| `task_id`      | UUID      | Optional FK to Task (if decision is task-specific)|
| `type`         | enum      | `PLANNING`, `RETRY`, `SKIP`, `ABORT`, `OVERRIDE`  |
| `title`        | text      | What was decided                                  |
| `context`      | text      | Situation that required a decision                |
| `choice`       | text      | What was chosen                                   |
| `rationale`    | text      | Why this choice was made                          |
| `alternatives` | text[]    | Other options considered                          |
| `decided_by`   | text      | `orchestrator`, `user`, or specific agent ID      |

Decision tracking provides an audit trail of why the system behaved the way it did. This is especially valuable for post-mortem analysis of failed missions.

### Event (Stored Events)

Persisted copy of NATS events for replay and audit.

| Field       | Type      | Description                                        |
| ----------- | --------- | -------------------------------------------------- |
| `id`        | UUID      | Primary key                                        |
| `stream`    | text      | NATS stream name                                   |
| `subject`   | text      | NATS subject (e.g., `task.completed`)              |
| `payload`   | JSONB     | Full event payload                                 |
| `sequence`  | bigint    | NATS sequence number for ordering                  |
| `timestamp` | timestamp | When the event was published                       |

## Event Sourcing Approach

clab-platform uses a **hybrid approach** to state management:

### PostgreSQL as Source of Truth

The current state of all entities (missions, tasks, sessions) lives in PostgreSQL and is updated directly. This gives us:

- Simple queries for current state ("show me all running tasks")
- Transactional consistency for state transitions
- Familiar relational model for joins and aggregations

### NATS JetStream as Event Log

Every state change also emits an event to NATS JetStream. These events are:

- **Durable** — JetStream retains events for a configurable period
- **Replayable** — consumers can replay from any sequence number
- **Decoupled** — services react to events without direct dependencies

### Why Hybrid?

Pure event sourcing (rebuilding state from events) adds complexity that isn't justified at our scale. Instead:

1. **Write path**: Service updates PostgreSQL, then publishes event to NATS
2. **Read path**: Services query PostgreSQL for current state
3. **React path**: Services subscribe to NATS for real-time reactions
4. **Audit path**: Events are also persisted to the `events` table for historical analysis

This gives us the benefits of event-driven architecture (decoupling, reactivity, audit trail) without the complexity of full event sourcing (projections, snapshots, eventual consistency).

### Event Flow Example

```
Orchestrator                PostgreSQL              NATS JetStream
     |                          |                        |
     |-- UPDATE task SET        |                        |
     |   status='COMPLETED' --> |                        |
     |                          |                        |
     |-- PUBLISH task.completed -----------------------> |
     |                          |                        |
     |                          |           Dashboard <--|-- subscribe
     |                          |         Review Svc <--|-- subscribe
     |                          |         Event Store <--|-- subscribe
     |                          |                        |
     |                          |<-- INSERT INTO events --|
```

The `Event Store` consumer persists events to PostgreSQL's `events` table, creating a queryable archive that outlives NATS retention policies.
