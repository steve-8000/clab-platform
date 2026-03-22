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
| `workspace_id`| UUID      | Foreign key to Workspace                            |
| `title`       | text      | Short human-readable name                           |
| `objective`   | text      | The original user objective                         |
| `status`      | enum      | `DRAFT`, `PLANNED`, `RUNNING`, `REVIEWING`, `COMPLETED`, `FAILED`, `ABORTED` |
| `priority`    | enum      | `LOW`, `NORMAL`, `HIGH`, `CRITICAL`                 |
| `assumptions` | JSONB     | Array of planning assumptions                       |
| `constraints` | JSONB     | Array of constraints                                |
| `acceptance_criteria` | JSONB | Array of acceptance criteria                    |
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
| `created_at`| timestamp | When the plan was created                            |

Each mission has exactly one active plan. If re-planning is needed (e.g., after a wave failure), the old plan is archived and a new one is created.

### Wave

A group of tasks that can execute in parallel. Waves execute sequentially (Wave 1 must complete before Wave 2 starts).

| Field          | Type      | Description                                      |
| -------------- | --------- | ------------------------------------------------ |
| `id`           | UUID      | Primary key                                      |
| `plan_id`      | UUID      | Foreign key to Plan                              |
| `mission_id`   | UUID      | Foreign key to Mission                           |
| `ordinal`      | integer   | Execution order (1, 2, 3, ...)                   |
| `label`        | text      | Human-readable label                               |
| `status`       | enum      | `PENDING`, `READY`, `RUNNING`, `BLOCKED`, `COMPLETED`, `FAILED` |
| `directive`    | text      | Optional per-wave instruction                      |
| `created_at`   | timestamp | When the wave was created                        |
| `started_at`   | timestamp | When execution began                             |
| `completed_at` | timestamp | When all tasks in the wave finished              |

**Wave completion rule:** A wave is `COMPLETED` when all of its tasks are in a terminal state (`SUCCEEDED` or `CANCELLED`). A wave is `FAILED` if any task reaches `FAILED` status and exceeds its retry limit.

### Task

An individual unit of work assigned to a single worker.

| Field               | Type     | Description                                       |
| ------------------- | -------- | ------------------------------------------------- |
| `id`                | UUID     | Primary key                                       |
| `wave_id`           | UUID     | Foreign key to Wave                               |
| `mission_id`        | UUID     | Foreign key to Mission                            |
| `title`             | text     | Short description                                 |
| `description`       | text     | Detailed specification for the worker             |
| `role`              | text     | Assigned role: `PM`, `BUILDER`, `ARCHITECT`, `OPERATIONS_REVIEWER`, `STRATEGIST`, `RESEARCH_ANALYST` |
| `engine`            | text     | `CODEX`, `CLAUDE`, or `BROWSER`                   |
| `status`            | enum     | `QUEUED`, `ASSIGNED`, `RUNNING`, `NEEDS_REVIEW`, `SUCCEEDED`, `FAILED`, `BLOCKED`, `CANCELLED` |
| `dependencies`      | JSONB    | Task IDs that must complete before this task runs |
| `acceptance_criteria`| JSONB   | Review criteria                                   |
| `max_retries`       | integer  | Maximum retry attempts (default: 2)               |
| `timeout_ms`        | integer  | Maximum execution time in ms (default: 300000)    |
| `created_at`        | timestamp| When the task was created                         |
| `updated_at`        | timestamp| Last modification time                            |
| `completed_at`      | timestamp| When the task reached a terminal state            |

**Intra-wave dependencies:** While waves provide coarse ordering, the `dependencies` array allows fine-grained ordering within a wave. A task will not be assigned until all its dependencies are resolved.

### TaskRun

A single execution attempt of a task. A task may have multiple runs (retries).

| Field           | Type      | Description                                       |
| --------------- | --------- | ------------------------------------------------- |
| `id`            | UUID      | Primary key                                       |
| `task_id`       | UUID      | Foreign key to Task                               |
| `session_id`    | UUID      | Foreign key to AgentSession that executed this run|
| `attempt`       | integer   | Attempt number (1, 2, 3, ...)                     |
| `status`        | enum      | `STARTING`, `RUNNING`, `AWAITING_INPUT`, `SUCCEEDED`, `FAILED`, `TIMED_OUT`, `ABORTED` |
| `exit_code`     | integer   | Process exit code (0 = success)                   |
| `stdout`        | text      | Captured output                                   |
| `stderr`        | text      | Captured error output                             |
| `duration_ms`   | integer   | Execution duration                                |
| `started_at`    | timestamp | When execution began                              |
| `finished_at`   | timestamp | When execution ended                              |

### AgentSession

Represents a runtime binding between a workspace-local agent (`role + engine`) and an execution context.

| Field            | Type      | Description                                      |
| ---------------- | --------- | ------------------------------------------------ |
| `id`             | UUID      | Primary key                                      |
| `workspace_id`   | UUID      | Foreign key to Workspace                         |
| `role`           | text      | Session role (e.g., `BUILDER`, `PM`)             |
| `engine`         | text      | `CODEX`, `CLAUDE`, or `BROWSER`                  |
| `pane_id`        | text      | Optional execution context identifier            |
| `state`          | enum      | `IDLE`, `BOUND`, `RUNNING`, `AWAITING_INPUT`, `STALE`, `LOST`, `CLOSED` |
| `pid`            | integer   | Optional process id                              |
| `last_heartbeat` | timestamp | Last time the worker reported alive              |
| `metadata`       | JSONB     | Metadata such as `currentTaskId`, `lastTaskId`, provisioning info |
| `created_at`     | timestamp | When the session was created                     |
| `closed_at`      | timestamp | When the session was closed                      |

**Lifecycle:**

```
IDLE --> BOUND --> RUNNING --> IDLE (reuse)
                     |           |
                     v           v
               AWAITING_INPUT   CLOSED
                     |
                     v
                  STALE --> LOST
```

- `IDLE`: Ready for reuse by the same workspace/role/engine
- `BOUND`: Reserved for a task but not yet actively running
- `RUNNING`: Session is actively executing the current task
- `AWAITING_INPUT`: The session is waiting for user input or an approval
- `STALE`: No heartbeat received for 2+ minutes
- `LOST`: Session has been stale for 5+ minutes, will be closed
- `CLOSED`: Session has been explicitly torn down

### Artifact

A file or output produced by a task run.

| Field          | Type      | Description                                       |
| -------------- | --------- | ------------------------------------------------- |
| `id`           | UUID      | Primary key                                       |
| `task_run_id`  | UUID      | Foreign key to TaskRun                            |
| `mission_id`   | UUID      | Foreign key to Mission                            |
| `type`         | enum      | `PATCH`, `FILE`, `TEST_REPORT`, `SUMMARY`, `SCREENSHOT`, `LOG`, `DECISION_NOTE`, `KNOWLEDGE_NOTE` |
| `path`         | text      | Relative file path within the workspace           |
| `content`      | text      | Inline content when stored directly               |
| `size_bytes`   | integer   | File size                                         |
| `checksum`     | text      | Content checksum                                  |
| `metadata`     | JSONB     | Additional info (MIME type, line count, etc.)     |
| `created_at`   | timestamp | When the artifact was created                     |

### Decision

Records important decisions made during mission execution, both automated and human.

| Field          | Type      | Description                                       |
| -------------- | --------- | ------------------------------------------------- |
| `id`           | UUID      | Primary key                                       |
| `mission_id`   | UUID      | Foreign key to Mission                            |
| `task_id`      | UUID      | Optional FK to Task (if decision is task-specific)|
| `category`     | text      | `ARCHITECTURE`, `IMPLEMENTATION`, `POLICY`, `RECOVERY`, `REVIEW` |
| `title`        | text      | What was decided                                  |
| `reasoning`    | text      | Why this choice was made                          |
| `chosen_option`| text      | What was chosen                                   |
| `alternatives` | JSONB     | Other options considered                          |
| `risk_level`   | text      | `LOW`, `MEDIUM`, `HIGH`                           |
| `actor_kind`   | text      | `system`, `user`, or agent kind                   |
| `actor_id`     | text      | Specific actor identifier                         |
| `created_at`   | timestamp | When the decision was recorded                    |

Decision tracking provides an audit trail of why the system behaved the way it did. This is especially valuable for post-mortem analysis of failed missions.

### Approval

Approval gates for high-risk operations that require explicit authorization.

| Field                | Type      | Description                                |
| -------------------- | --------- | ------------------------------------------ |
| `id`                 | UUID      | Primary key                                |
| `mission_id`         | UUID      | Foreign key to Mission                     |
| `task_id`            | UUID      | Optional FK to Task                        |
| `requested_capability`| text     | Capability being requested                 |
| `reason`             | text      | Why the capability is needed               |
| `status`             | enum      | `PENDING`, `GRANTED`, `DENIED`             |
| `risk_level`         | text      | `LOW`, `MEDIUM`, `HIGH`                    |
| `actor_kind`         | text      | Who requested it                           |
| `actor_id`           | text      | Specific requester identifier              |
| `reviewed_by`        | text      | Who reviewed the approval                  |
| `reviewed_at`        | timestamp | When the approval was reviewed             |
| `created_at`         | timestamp | When the approval was requested            |

### CapabilityLease

Capability leases grant temporary execution rights to a session.

| Field        | Type      | Description                            |
| ------------ | --------- | -------------------------------------- |
| `session_id` | UUID      | Foreign key to AgentSession            |
| `capability` | text      | Granted capability (e.g., `READ_CONTEXT`, `WRITE_WORKSPACE`, `EXEC_SHELL`, `BROWSER_ACT`, `NETWORK_EGRESS`, `EXTERNAL_EFFECT`, `APPROVE_HIGH_RISK`) |
| `granted_at` | timestamp | Lease creation time                    |
| `expires_at` | timestamp | Lease expiry                           |
| `revoked_at` | timestamp | Revocation time if lease was cancelled |

### Event (Stored Events)

Persisted copy of emitted events for replay and audit.

| Field         | Type      | Description                                       |
| ------------- | --------- | ------------------------------------------------- |
| `id`          | UUID      | Primary key                                       |
| `type`        | text      | Event type (e.g., `mission.created`, `task.assigned`) |
| `version`     | integer   | Event schema version                              |
| `occurred_at` | timestamp | When the event was published                      |
| `mission_id`  | UUID      | Optional FK to Mission                            |
| `wave_id`     | UUID      | Optional FK to Wave                               |
| `task_id`     | UUID      | Optional FK to Task                               |
| `task_run_id` | UUID      | Optional FK to TaskRun                            |
| `session_id`  | UUID      | Optional FK to AgentSession                       |
| `workspace_id`| UUID      | Optional FK to Workspace                          |
| `actor_kind`  | text      | Who caused the event                              |
| `actor_id`    | text      | Specific actor identifier                         |
| `payload`     | JSONB     | Full event payload                                |

## Event Sourcing Approach

clab-platform uses a **hybrid approach** to state management:

### PostgreSQL as Source of Truth

The current state of all entities (missions, tasks, sessions) lives in PostgreSQL and is updated directly. This gives us:

- Simple queries for current state ("show me all running tasks")
- Transactional consistency for state transitions
- Familiar relational model for joins and aggregations

### NATS JetStream as Event Log

Every state change also emits an event to NATS JetStream. These events are:

- **Durable** -- JetStream retains events for a configurable period
- **Replayable** -- consumers can replay from any sequence number
- **Decoupled** -- services react to events without direct dependencies

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
     |   status='SUCCEEDED' --> |                        |
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
