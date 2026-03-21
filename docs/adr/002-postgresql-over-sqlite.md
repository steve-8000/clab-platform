# ADR-002: PostgreSQL over SQLite

## Status

**Accepted** — 2026-03-01

## Context

clab-platform needs a persistent store for mission state, task tracking, agent sessions, artifacts, and decision logs. The previous clab v1 used in-memory state with JSON file persistence, which was fragile and didn't survive process restarts.

We evaluated two relational databases:

### SQLite

- **Pros**: Zero configuration, single-file database, embedded (no separate process), excellent for single-writer workloads, great for local development.
- **Cons**: Limited concurrent write support (WAL mode helps but still single-writer), no native JSONB with rich query operators, no `LISTEN/NOTIFY` equivalent, harder to scale across multiple service instances.

### PostgreSQL

- **Pros**: Full concurrent read/write support, rich JSONB querying (indexing, containment, path queries), `LISTEN/NOTIFY` for lightweight pub/sub, mature ecosystem, wide hosting options, proper transaction isolation levels.
- **Cons**: Requires a separate process, more operational overhead, heavier resource footprint.

### Key Requirements

1. **Concurrent access**: Multiple services (orchestrator, runtime-manager, review-service) read and write state simultaneously.
2. **Transactional integrity**: State transitions (e.g., `task.status` from `RUNNING` to `COMPLETED`) must be atomic and isolated.
3. **Flexible metadata**: Task specs, agent configs, and artifact metadata are semi-structured and vary by type.
4. **Change notification**: Some services need to react to state changes without polling.

## Decision

We chose **PostgreSQL** as the primary data store.

### Rationale

**Concurrent access** is the strongest driver. In clab-platform, the orchestrator, runtime-manager, and review-service all write to the same tables concurrently. SQLite's single-writer model would create contention under load. With PostgreSQL, each service opens its own connection (via a pool), and the database handles concurrency natively.

**JSONB columns** provide the flexibility we need for semi-structured data without sacrificing query performance. Task specs vary by type (`CODE` tasks have file paths, `BROWSER` tasks have URLs), and JSONB lets us store these naturally while still supporting indexed queries like:

```sql
SELECT * FROM tasks WHERE spec @> '{"language": "typescript"}';
```

**LISTEN/NOTIFY** provides a lightweight notification mechanism for cases where NATS would be overkill. For example, the runtime-manager can listen for task status changes without polling:

```sql
NOTIFY task_status_changed, '{"task_id": "...", "new_status": "COMPLETED"}';
```

**Transaction isolation** ensures that complex state transitions (e.g., marking all tasks in a wave as cancelled when the mission is aborted) are atomic. PostgreSQL's `SERIALIZABLE` isolation level prevents race conditions that could leave the system in an inconsistent state.

## Consequences

### Positive

- Services can read and write concurrently without application-level locking.
- JSONB enables flexible schemas for task specs and metadata with indexed queries.
- `LISTEN/NOTIFY` reduces polling for lightweight state change notifications.
- Rich ecosystem of tools for monitoring, backups, and administration.
- Drizzle ORM (see ADR-005) has excellent PostgreSQL support including JSONB type inference.

### Negative

- Requires running a PostgreSQL instance (locally via Docker, in production via managed service).
- More operational overhead than SQLite (backups, connection pooling, version upgrades).
- Local development requires either a running PostgreSQL or a Docker container.
- Connection management (pooling, timeouts, retries) must be handled correctly.

### Mitigations

- A `docker-compose.yml` at the repo root starts PostgreSQL (and NATS) for local development with a single command.
- Connection pooling is handled by `pg-pool` with sensible defaults in `packages/db`.
- Database migrations are version-controlled and applied automatically at startup in development.
- Production deployments use managed PostgreSQL (e.g., AWS RDS, Neon, Supabase) to minimize operational burden.
