# CLAB Cutover Execution Spec v4

## Scope
- Big-bang applies only to service responsibility, shared contracts, state-machine ownership, and deployment baseline.
- Data migration, event replay/backfill, and network policy rewrites are phased transitions.

## Ownership
- `orchestrator` is the single writer for Mission/Plan/Wave/TaskRun state validation, finalization, persistence, and transition event publication.
- `runtime-manager` is the single writer for Session/Lease/Heartbeat state validation, finalization, and persistence.
- Workers only report status and execution outputs.
- Other services may keep read models (cache/projections) but must not finalize source-of-truth state.

## Delivery Semantics
- Event delivery is `at-least-once`.
- Consumers must be idempotent.
- Ordering is meaningful only per `aggregateId` and not globally.
- Event envelope includes `schemaVersion`, `aggregateType`, `aggregateId`, `traceId`, `correlationId`, and optional `idempotencyKey`.

## Idempotency
- Source of truth is orchestrator.
- `executionRequestId` deduplicates external execution requests.
- `taskRunId + attempt` represents internal retry progression.
- Replayed request with same `executionRequestId` must return `DUPLICATE_IGNORED`.

## TaskRun State
- Allowed states: `PENDING`, `ASSIGNED`, `RUNNING`, `BLOCKED`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `TIMED_OUT`.
- Minimum transition policy:
  - `PENDING -> ASSIGNED -> RUNNING`
  - `RUNNING -> SUCCEEDED|FAILED|TIMED_OUT`
  - `BLOCKED <-> RUNNING|ASSIGNED`
  - `ANY(non-terminal) -> CANCELLED` (policy/operator path)

## Gates
- Hard gate: policy/integrity/approval conditions that fail-closed.
- Hard gate failure: TaskRun fails closed (`FAILED`/cancel path), no auto retry.
- Soft gate: Pre-K retrieval/insight extraction with degraded execution allowed.
- Soft gate failure: mark degraded metadata and publish warning event.
- High-risk mission types must not execute in degraded mode.

## Timeout and Lease
- Heartbeat timeout: 90s (30s x 3).
- Execution timeout default: 10m (`TASK_EXECUTION_TIMEOUT_MS`).
- Lease expiration must mark session stale/reclaimable.

## Worker Scheduling
- Worker registers `capabilities`.
- Task assignment carries `requiredCapabilities`.
- Runtime manager must match capabilities before provisioning.

## Deployment and Promotion
- No `latest` tags and no mutable promotion.
- Promote same image digest across environments (dev -> stg -> prod), never rebuild per environment.
- ArgoCD must deploy immutable artifacts only.

## DB Compatibility
- Forward-only migration by default.
- No destructive migration in cutover window.
- Use `expand -> migrate -> contract`.
- Keep read compatibility window during stabilization.

## Operational Acceptance
- End-to-end propagation of `trace_id`/`correlation_id`.
- Duplicate TaskRun prevention verified.
- Worker disconnect/reconnect and lease reclaim verified.
- At least one fault-injection recovery path verified.
- Runbook exists and operator rehearsal completed.

## Cutover Exit Criteria
- Contract/version compatibility tests pass.
- State-machine ownership and transition tests pass.
- E2E mission scenario passes.
- Runtime recovery checks pass.
- Track B is promoted by immutable digest.
- Track A switches to read-only bridge mode and is removed after stabilization window.
