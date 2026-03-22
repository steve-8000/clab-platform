# Troubleshooting Runbook

## Quick Reference

| Symptom                          | Likely Cause                    | Jump To                        |
| -------------------------------- | ------------------------------- | ------------------------------ |
| Tasks stuck in `ASSIGNED`        | Worker session stale/dead       | [Session Stale](#session-stale)|
| Tasks timing out                 | Worker hung or slow             | [Task Timeout](#task-timeout)  |
| Services can't start             | DB connection failure           | [DB Connection](#db-connection-issues) |
| Events not flowing               | NATS disconnected               | [NATS Disconnection](#nats-disconnection) |
| Mission stuck in `RUNNING`       | Wave not completing             | [Mission Failure Recovery](#mission-failure-recovery) |
| Dashboard shows no data          | API gateway or polling issue    | [Dashboard Issues](#dashboard-issues) |

## Status Reference

### Mission Status

`DRAFT` -> `PLANNED` -> `RUNNING` -> `REVIEWING` -> `COMPLETED` | `FAILED` | `ABORTED`

### Task Status

`QUEUED` -> `ASSIGNED` -> `RUNNING` -> `NEEDS_REVIEW` -> `SUCCEEDED` | `FAILED` | `BLOCKED` | `CANCELLED`

### Session State

`IDLE` -> `BOUND` -> `RUNNING` -> `IDLE` (reuse) | `CLOSED`

Degraded states: `STALE` -> `LOST`

## How to Check Logs

### Kubernetes

```bash
# All logs for a service
kubectl logs -l app=orchestrator -n clab-platform --tail=100

# Follow logs in real-time
kubectl logs -f deployment/orchestrator -n clab-platform

# Logs from a specific pod
kubectl logs pod/orchestrator-7f8d9c4b5-x2k9p -n clab-platform

# Previous container logs (if pod restarted)
kubectl logs pod/orchestrator-7f8d9c4b5-x2k9p -n clab-platform --previous

# Logs with timestamps
kubectl logs -l app=runtime-manager -n clab-platform --timestamps

# Search logs across all services
kubectl logs -l platform=clab -n clab-platform --tail=500 | grep "ERROR"
```

### Local Development

```bash
# Services log to stdout in structured JSON (pino format)
# Use pino-pretty for readable output
pnpm --filter orchestrator dev | pnpm pino-pretty

# Check all service logs simultaneously
pnpm dev 2>&1 | pnpm pino-pretty
```

### Log Levels

All services respect the `LOG_LEVEL` environment variable:

- `fatal` -- Unrecoverable errors
- `error` -- Errors that affect functionality
- `warn` -- Unexpected conditions that are handled
- `info` -- Normal operational messages (default)
- `debug` -- Detailed diagnostic information
- `trace` -- Very verbose, includes request/response bodies

```bash
# Temporarily increase log level for a deployment
kubectl set env deployment/orchestrator LOG_LEVEL=debug -n clab-platform
```

---

## Common Issues

### Session Stale

**Symptoms:**
- Tasks stuck in `ASSIGNED` or `RUNNING` status
- Runtime manager logs show `Session <id> STALE`
- Worker process is unresponsive or has exited

**Diagnosis:**

```bash
# Check session status in the database
psql $DATABASE_URL -c "
  SELECT id, role, engine, state, last_heartbeat,
         NOW() - last_heartbeat AS heartbeat_age
  FROM agent_sessions
  WHERE state NOT IN ('CLOSED')
  ORDER BY last_heartbeat DESC;
"

# Check runtime-manager logs for heartbeat failures
kubectl logs -l app=runtime-manager -n clab-platform | grep "heartbeat"
```

**How the heartbeat monitor works:**

The runtime manager runs a heartbeat check loop with these parameters:
- **Check interval**: 30 seconds
- **Stale threshold**: 2 minutes without heartbeat -> session marked `STALE`
- **Lost threshold**: 5 minutes in `STALE` state -> session marked `CLOSED`, associated tasks re-queued

**Resolution:**

1. **Automatic recovery**: The runtime manager's heartbeat monitor runs every 30 seconds. Sessions without a heartbeat for 2 minutes are marked `STALE`. After 5 minutes in `STALE` state, sessions are `CLOSED` and their tasks are re-queued. Wait up to 5 minutes for automatic recovery.

2. **Manual session cleanup** (via MCP tool -- preferred):
   ```
   Use the `mission_abort` MCP tool to abort the mission, which will
   close all associated sessions and cancel pending tasks.
   ```

3. **Manual session cleanup** (via API):
   ```bash
   # Abort the mission via API
   curl -X POST http://localhost:4000/v1/missions/<mission-id>/abort \
     -H "Content-Type: application/json"
   ```

4. **Manual database cleanup** (last resort):
   ```bash
   # Mark session as closed
   psql $DATABASE_URL -c "
     UPDATE agent_sessions SET state = 'CLOSED', closed_at = NOW()
     WHERE id = '<session-id>';
   "

   # Reset the task to QUEUED so it gets re-assigned
   psql $DATABASE_URL -c "
     UPDATE tasks SET status = 'QUEUED', updated_at = NOW()
     WHERE id = '<task-id>' AND status IN ('ASSIGNED', 'RUNNING');
   "
   ```

**Prevention:**
- Monitor the heartbeat log output for early warnings of stale sessions.
- Ensure workers are correctly sending heartbeats to the runtime manager.

---

### Task Timeout

**Symptoms:**
- Task status changes to `FAILED` with error `Task execution timed out`
- TaskRun record shows `status = 'TIMED_OUT'`
- Worker may still be running (timeout is enforced by runtime manager, not worker)

**Diagnosis:**

```bash
# Check the task's timeout configuration and run history
psql $DATABASE_URL -c "
  SELECT t.id, t.title, t.timeout_ms, t.max_retries,
         tr.attempt, tr.status, tr.started_at, tr.finished_at,
         tr.finished_at - tr.started_at AS duration
  FROM tasks t
  JOIN task_runs tr ON tr.task_id = t.id
  WHERE t.id = '<task-id>'
  ORDER BY tr.attempt;
"

# Check what the worker was doing
kubectl logs -l app=runtime-manager -n clab-platform | grep "<task-id>"
```

**Resolution:**

1. **If the task is legitimately slow**, increase its timeout:
   ```bash
   psql $DATABASE_URL -c "
     UPDATE tasks SET timeout_ms = 600000, updated_at = NOW()
     WHERE id = '<task-id>';
   "
   ```
   Then retry the task (see [How to Retry Tasks](#how-to-retry-tasks)).

2. **If the worker is hung**, close the session and let the task be re-assigned:
   ```bash
   # Find the session
   psql $DATABASE_URL -c "
     SELECT s.id, s.role, s.engine FROM agent_sessions s
     JOIN task_runs tr ON tr.session_id = s.id
     WHERE tr.task_id = '<task-id>'
     ORDER BY tr.attempt DESC LIMIT 1;
   "
   # Close it
   psql $DATABASE_URL -c "
     UPDATE agent_sessions SET state = 'CLOSED', closed_at = NOW()
     WHERE id = '<session-id>';
   "
   ```

3. **If the task spec is flawed** (e.g., impossible acceptance criteria), cancel the task:
   ```bash
   psql $DATABASE_URL -c "
     UPDATE tasks SET status = 'CANCELLED', updated_at = NOW()
     WHERE id = '<task-id>';
   "
   ```

**Prevention:**
- Set realistic `timeout_ms` based on task complexity (default: 300000 = 5 min).
- Use the `BROWSER` engine type for web interactions (they typically need longer timeouts).

---

### DB Connection Issues

**Symptoms:**
- Services fail to start with `ECONNREFUSED` or `connection timeout`
- Health endpoint returns `{"status":"error","db":"disconnected"}`
- Logs show `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Diagnosis:**

```bash
# Check if PostgreSQL is reachable from within the cluster
kubectl run pg-check --rm -it --image=postgres:15 -n clab-platform -- \
  psql "$DATABASE_URL" -c "SELECT 1"

# Check the database service/endpoint
kubectl get endpoints -n clab-platform | grep postgres

# Check for too many connections
psql $DATABASE_URL -c "
  SELECT count(*) as total_connections,
         count(*) FILTER (WHERE state = 'active') as active,
         count(*) FILTER (WHERE state = 'idle') as idle
  FROM pg_stat_activity
  WHERE datname = 'clab';
"
```

**Resolution:**

1. **PostgreSQL is down**: Restart it or check the managed service status page.

2. **Connection limit exceeded**:
   ```sql
   -- Check max connections
   SHOW max_connections;

   -- Kill idle connections if needed
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = 'clab'
     AND state = 'idle'
     AND query_start < NOW() - INTERVAL '10 minutes';
   ```

3. **Network issue**: Check Kubernetes network policies and service DNS:
   ```bash
   kubectl run dns-check --rm -it --image=busybox -n clab-platform -- \
     nslookup postgres.clab-platform.svc.cluster.local
   ```

4. **Wrong DATABASE_URL**: Verify the secret:
   ```bash
   kubectl get secret clab-secrets -n clab-platform -o jsonpath='{.data.DATABASE_URL}' | base64 -d
   ```

**Prevention:**
- Use connection pooling (each service uses `pg-pool` with `max: 10` by default).
- Set up database monitoring and alerts on connection count.
- Use a managed PostgreSQL service with automatic failover.

---

### NATS Disconnection

**Symptoms:**
- Events stop flowing; dashboard goes stale
- Logs show `NatsError: CONNECTION_CLOSED` or `DISCONNECT`
- Services continue to work for REST calls but event-driven behavior stops

**Diagnosis:**

```bash
# Check NATS server status
kubectl exec -it deployment/nats -n clab-platform -- nats server info

# Check JetStream status
kubectl exec -it deployment/nats -n clab-platform -- nats stream ls
kubectl exec -it deployment/nats -n clab-platform -- nats consumer ls TASKS

# Check if consumers are healthy
kubectl exec -it deployment/nats -n clab-platform -- nats consumer info TASKS orchestrator

# Check NATS pod status
kubectl describe pod -l app=nats -n clab-platform

# Check NATS logs
kubectl logs -l app=nats -n clab-platform --tail=50
```

**Resolution:**

1. **NATS pod crashed**: Check and restart:
   ```bash
   kubectl rollout restart deployment/nats -n clab-platform
   ```

2. **JetStream storage full**:
   ```bash
   # Check storage usage
   kubectl exec -it deployment/nats -n clab-platform -- nats server report jetstream

   # Purge old messages from a stream
   kubectl exec -it deployment/nats -n clab-platform -- nats stream purge SESSIONS --keep=1000
   ```

3. **Consumer stuck**: Delete and recreate:
   ```bash
   kubectl exec -it deployment/nats -n clab-platform -- nats consumer rm TASKS orchestrator
   # The service will recreate its consumer on next connection
   kubectl rollout restart deployment/orchestrator -n clab-platform
   ```

4. **Network partition**: Services have automatic reconnection logic. Restart affected services:
   ```bash
   kubectl rollout restart deployment/orchestrator -n clab-platform
   kubectl rollout restart deployment/runtime-manager -n clab-platform
   ```

**Prevention:**
- Monitor NATS JetStream storage usage.
- Set appropriate retention policies (time-based, not unlimited).
- The `packages/events` package has built-in reconnection with exponential backoff.

---

### Dashboard Issues

**Symptoms:**
- Dashboard loads but shows no missions or stale data
- Dashboard shows a loading spinner indefinitely
- Data appears outdated (not refreshing)

**Diagnosis:**

```bash
# Check if the dashboard pod is running
kubectl get pods -l app=dashboard -n clab-platform

# Check if the API gateway is reachable
kubectl port-forward svc/api-gateway 4000:4000 -n clab-platform

# Test the dashboard aggregate endpoint directly
curl http://localhost:4000/v1/dashboard

# Check CORS configuration
curl -I -X OPTIONS http://localhost:4000/v1/dashboard \
  -H "Origin: https://dashboard.example.com"
```

**How the dashboard works:**

The dashboard uses **5-second polling** against the API gateway's `/v1/dashboard` aggregate endpoint. There is no WebSocket connection. The API gateway fetches data from the orchestrator, runtime-manager, and knowledge-service, then returns a combined response.

**Resolution:**

1. **CORS issue**: Ensure `CORS_ORIGINS` in the API gateway env var includes the dashboard URL.

2. **API gateway not responding**: Restart it:
   ```bash
   kubectl rollout restart deployment/api-gateway -n clab-platform
   ```

3. **Downstream service unavailable**: The dashboard endpoint aggregates data from multiple services. If one is down, partial data is returned. Check which service is failing:
   ```bash
   curl http://localhost:4000/v1/health/all
   ```

4. **Dashboard pod itself is unhealthy**: Restart it:
   ```bash
   kubectl rollout restart deployment/dashboard -n clab-platform
   ```

---

## How to Retry Tasks

### Via API

```bash
# Retry a specific task
curl -X POST http://localhost:4000/v1/missions/<mission-id>/tasks/<task-id>/retry \
  -H "Content-Type: application/json"
```

### Via MCP Tool (preferred)

Use the `mission_abort` tool to abort a stuck mission, or `approval_resolve` to resolve a pending approval that is blocking progress.

### Via Database (last resort)

```bash
# Reset task status to QUEUED
psql $DATABASE_URL -c "
  UPDATE tasks
  SET status = 'QUEUED', updated_at = NOW()
  WHERE id = '<task-id>';
"

# Notify the orchestrator (via NATS or by restarting it)
# The orchestrator's wave monitor will pick up the queued task
```

### Retry all failed tasks in a wave

```bash
psql $DATABASE_URL -c "
  UPDATE tasks
  SET status = 'QUEUED', updated_at = NOW()
  WHERE wave_id = '<wave-id>'
    AND status = 'FAILED';

  UPDATE waves
  SET status = 'RUNNING', updated_at = NOW()
  WHERE id = '<wave-id>';
"
```

---

## How to Recover from Mission Failure

### Assess the situation

```bash
# Get mission status and its waves/tasks
psql $DATABASE_URL -c "
  SELECT m.id, m.title, m.status,
         w.ordinal AS wave_order, w.status AS wave_status,
         t.title AS task_title, t.status AS task_status, t.role, t.engine
  FROM missions m
  JOIN plans p ON p.mission_id = m.id
  JOIN waves w ON w.plan_id = p.id
  JOIN tasks t ON t.wave_id = w.id
  WHERE m.id = '<mission-id>'
  ORDER BY w.ordinal, t.title;
"
```

### Option 1: Retry failed tasks

If specific tasks failed but the plan is sound:

```bash
# Reset failed tasks and their wave
psql $DATABASE_URL -c "
  BEGIN;

  UPDATE tasks SET status = 'QUEUED', updated_at = NOW()
  WHERE wave_id IN (
    SELECT w.id FROM waves w
    JOIN plans p ON p.id = w.plan_id
    WHERE p.mission_id = '<mission-id>'
  ) AND status = 'FAILED';

  UPDATE waves SET status = 'RUNNING', updated_at = NOW()
  WHERE id IN (
    SELECT w.id FROM waves w
    JOIN plans p ON p.id = w.plan_id
    WHERE p.mission_id = '<mission-id>'
  ) AND status = 'FAILED';

  UPDATE missions SET status = 'RUNNING', updated_at = NOW()
  WHERE id = '<mission-id>';

  COMMIT;
"
```

### Option 2: Re-plan the mission

If the plan itself was flawed:

```bash
# Reset mission to PLANNED status
# The orchestrator will generate a new plan
psql $DATABASE_URL -c "
  UPDATE missions SET status = 'PLANNED', updated_at = NOW()
  WHERE id = '<mission-id>';
"
```

### Option 3: Abort the mission

If the mission should be abandoned:

```bash
# Via MCP tool (preferred)
# Use the mission_abort tool

# Via API
curl -X POST http://localhost:4000/v1/missions/<mission-id>/abort \
  -H "Content-Type: application/json"

# Via database (last resort)
psql $DATABASE_URL -c "
  BEGIN;

  -- Cancel all non-terminal tasks
  UPDATE tasks SET status = 'CANCELLED', updated_at = NOW()
  WHERE wave_id IN (
    SELECT w.id FROM waves w
    JOIN plans p ON p.id = w.plan_id
    WHERE p.mission_id = '<mission-id>'
  ) AND status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED');

  -- Close active sessions
  UPDATE agent_sessions SET state = 'CLOSED', closed_at = NOW()
  WHERE workspace_id = (SELECT workspace_id FROM missions WHERE id = '<mission-id>')
    AND state NOT IN ('CLOSED');

  -- Mark mission as aborted
  UPDATE missions SET status = 'ABORTED', updated_at = NOW(), completed_at = NOW()
  WHERE id = '<mission-id>';

  COMMIT;
"
```

---

## Emergency Procedures

### All services down

```bash
# Check node status
kubectl get nodes

# Check namespace events
kubectl get events -n clab-platform --sort-by='.lastTimestamp'

# Restart all deployments
kubectl rollout restart deployment -n clab-platform

# Watch recovery
kubectl get pods -n clab-platform -w
```

### Database corruption

```bash
# 1. Stop all services immediately
kubectl scale deployment --all --replicas=0 -n clab-platform

# 2. Take a backup of current state
pg_dump $DATABASE_URL > clab_emergency_backup_$(date +%Y%m%d_%H%M%S).sql

# 3. Assess damage
psql $DATABASE_URL -c "
  SELECT schemaname, tablename
  FROM pg_tables
  WHERE schemaname = 'public';
"

# 4. Restore from most recent backup if needed
psql $DATABASE_URL < clab_backup_YYYYMMDD.sql

# 5. Restart services
kubectl scale deployment --all --replicas=1 -n clab-platform
```

### NATS data loss

If NATS JetStream data is lost, services will continue to function via REST but event-driven features will be degraded:

```bash
# Recreate streams
kubectl exec -it deployment/nats -n clab-platform -- sh -c '
  nats stream add MISSIONS --subjects="mission.*" --retention=limits --max-age=168h --storage=file
  nats stream add WAVES --subjects="wave.*" --retention=limits --max-age=168h --storage=file
  nats stream add TASKS --subjects="task.*" --retention=limits --max-age=168h --storage=file
  nats stream add SESSIONS --subjects="session.*" --retention=limits --max-age=24h --storage=file
  nats stream add REVIEWS --subjects="review.*" --retention=limits --max-age=168h --storage=file
'

# Restart all services to recreate consumers
kubectl rollout restart deployment -n clab-platform
```
