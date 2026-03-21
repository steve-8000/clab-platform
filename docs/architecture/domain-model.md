# clab-platform Domain Model

## Core Entity Diagram

```
Mission -> Plan -> Wave -> Task -> TaskRun -> Artifact
                        \
                         -> AgentSession -> CapabilityLease

Mission -> Decision
Mission -> Approval
EventLog captures emitted events alongside current relational state
```

## Entity Descriptions

### Mission

The top-level unit of work. A mission represents a complete user goal and is the container for plans, waves, tasks, decisions, and approvals.

| Field         | Type      | Description                                         |
| ------------- | --------- | --------------------------------------------------- |
| `id`          | UUID      | Primary key                                         |
| `title`       | text      | Short human-readable name                           |
| `objective`   | text      | The original user objective                         |
| `status`      | enum      | `DRAFT`, `PLANNED`, `RUNNING`, `REVIEWING`, `COMPLETED`, `FAILED`, `ABORTED` |
| `priority`    | enum      | `LOW`, `NORMAL`, `HIGH`, `CRITICAL`                 |
| `created_at`  | timestamp | When the mission was created                        |
| `updated_at`  | timestamp | Last modification time                              |
| `completed_at`| timestamp | When the mission reached a terminal state           |

**Status transitions:**

```
DRAFT --> PLANNED --> RUNNING --> REVIEWING --> COMPLETED
   |         |            |            |
   v         v            v            v
 FAILED    ABORTED      FAILED       FAILED
```

### Plan

A structured decomposition of a mission into executable waves and tasks.

| Field       | Type   | Description                                            |
| ----------- | ------ | ------------------------------------------------------ |
| `id`        | UUID   | Primary key                                            |
| `mission_id`| UUID   | Foreign key to Mission                                 |
| `version`   | integer| Plan version                                            |
| `summary`   | text   | Planner summary                                         |
| `wave_count`| integer| Number of waves generated                               |
| `is_active` | bool   | Whether the plan is currently active                    |

Each mission has exactly one active plan. If re-planning is needed (e.g., after a wave failure), the old plan is archived and a new one is created.

### Wave

A group of tasks that can execute in parallel. Waves execute sequentially (Wave 1 must complete before Wave 2 starts).

| Field          | Type      | Description                                      |
| -------------- | --------- | ------------------------------------------------ |
| `id`           | UUID      | Primary key                                      |
| `plan_id`      | UUID      | Foreign key to Plan                              |
| `ordinal`      | integer   | Execution order (1, 2, 3, ...)                   |
| `label`        | text      | Human-readable label                               |
| `status`       | enum      | `PENDING`, `READY`, `RUNNING`, `BLOCKED`, `COMPLETED`, `FAILED` |
| `directive`    | text      | Optional per-wave instruction                      |
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
| `role`              | text     | Assigned role such as `BUILDER`, `PM`, `REVIEWER` |
| `engine`            | text     | `CODEX`, `CLAUDE`, or `BROWSER`                   |
| `status`            | enum     | `QUEUED`, `ASSIGNED`, `RUNNING`, `NEEDS_REVIEW`, `SUCCEEDED`, `FAILED`, `BLOCKED`, `CANCELLED` |
| `dependencies`      | UUID[]   | Task IDs that must complete before this task runs |
| `acceptance_criteria`| text[]  | Review criteria                                   |
| `max_retries`       | integer  | Maximum retry attempts (default: 2)               |
| `timeout_ms`        | integer  | Maximum execution time in ms                      |

**Intra-wave dependencies:** While waves provide coarse ordering, the `dependencies` array allows fine-grained ordering within a wave. A task will not be dispatched until all its dependencies are resolved.

### TaskRun

A single execution attempt of a task. A task may have multiple runs (retries).

| Field           | Type      | Description                                       |
| --------------- | --------- | ------------------------------------------------- |
| `id`            | UUID      | Primary key                                       |
| `task_id`       | UUID      | Foreign key to Task                               |
| `session_id`    | UUID      | Foreign key to AgentSession that executed this run|
| `attempt`       | integer   | Attempt number (1, 2, 3, ...)                     |
| `status`        | enum      | `STARTING`, `RUNNING`, `AWAITING_INPUT`, `SUCCEEDED`, `FAILED`, `TIMED_OUT`, `ABORTED` |
| `started_at`    | timestamp | When execution began                              |
| `finished_at`   | timestamp | When execution ended                              |
| `exit_code`     | integer   | Process exit code (0 = success)                   |
| `stdout`        | text      | Captured pane output or API output                |
| `stderr`        | text      | Captured error output                             |
| `duration_ms`   | integer   | Execution duration                                |

### AgentSession

Represents a sticky runtime binding between a workspace-local agent (`role + engine`) and a `cmux` pane.

| Field            | Type      | Description                                      |
| ---------------- | --------- | ------------------------------------------------ |
| `id`             | UUID      | Primary key                                      |
| `workspace_id`   | UUID      | Workspace owning the session                     |
| `role`           | text      | Session role                                     |
| `engine`         | text      | `CODEX`, `CLAUDE`, or `BROWSER`                  |
| `pane_id`        | text      | Persistent `cmux` pane ID kept alive across tasks|
| `state`          | enum      | `IDLE`, `BOUND`, `RUNNING`, `AWAITING_INPUT`, `STALE`, `LOST`, `CLOSED` |
| `pid`            | integer   | Optional pane process id                         |
| `last_heartbeat` | timestamp | Last time the worker reported alive              |
| `metadata`       | JSONB     | Sticky metadata such as `currentTaskId`, `lastTaskId`, provisioning info |

**Lifecycle:**

```
IDLE --> BOUND --> RUNNING --> IDLE
                     |           |
                     v           v
               AWAITING_INPUT   CLOSED
                     |
                     v
                  STALE --> LOST
```

- `IDLE`: Ready for reuse by the same workspace/role/engine
- `BOUND`: Reserved for a task but not yet actively running
- `RUNNING`: Interactive TUI session is executing the current task inside the existing pane
- `AWAITING_INPUT`: The pane is waiting for user input
- `STALE` / `LOST`: Heartbeat or pane output is no longer progressing
- `CLOSED`: Session has been explicitly torn down, not merely returned to idle

### Artifact

A file or output produced by a task run.

| Field          | Type      | Description                                       |
| -------------- | --------- | ------------------------------------------------- |
| `id`           | UUID      | Primary key                                       |
| `task_run_id`  | UUID      | Foreign key to TaskRun                            |
| `type`         | enum      | `PATCH`, `FILE`, `TEST_REPORT`, `SUMMARY`, `SCREENSHOT`, `LOG`, `DECISION_NOTE`, `KNOWLEDGE_NOTE` |
| `path`         | text      | Relative file path within the workspace           |
| `content`      | text      | Inline content when stored directly               |
| `size_bytes`   | bigint    | File size                                         |
| `metadata`     | JSONB     | Additional info (MIME type, line count, etc.)     |

Artifacts can represent file outputs, pane transcripts, summaries, screenshots, or derived notes.

### Decision

Records important decisions made during mission execution, both automated and human.

| Field          | Type      | Description                                       |
| -------------- | --------- | ------------------------------------------------- |
| `id`           | UUID      | Primary key                                       |
| `mission_id`   | UUID      | Foreign key to Mission                            |
| `task_id`      | UUID      | Optional FK to Task (if decision is task-specific)|
| `category`     | enum/text | `ARCHITECTURE`, `IMPLEMENTATION`, `POLICY`, `RECOVERY`, `REVIEW` |
| `title`        | text      | What was decided                                  |
| `reasoning`    | text      | Why this choice was made                          |
| `chosen_option`| text      | What was chosen                                   |
| `alternatives` | text[]    | Other options considered                          |
| `actor_kind`   | text      | `system`, `user`, or agent kind                   |
| `actor_id`     | text      | Specific actor identifier                         |

Decision tracking provides an audit trail of why the system behaved the way it did. This is especially valuable for post-mortem analysis of failed missions.

### CapabilityLease

Capability leases grant temporary execution rights to a session.

| Field        | Type      | Description                            |
| ------------ | --------- | -------------------------------------- |
| `session_id` | UUID      | Foreign key to AgentSession            |
| `capability` | text      | Granted capability                     |
| `granted_at` | timestamp | Lease creation time                    |
| `expires_at` | timestamp | Lease expiry                           |
| `revoked_at` | timestamp | Revocation time if lease was cancelled |

### Event (Stored Events)

Persisted copy of emitted events for replay and audit.

| Field       | Type      | Description                                        |
| ----------- | --------- | -------------------------------------------------- |
| `id`        | UUID      | Primary key                                        |
| `stream`    | text      | NATS stream name                                   |
| `subject`   | text      | NATS subject (e.g., `clab.task.assigned`)          |
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
