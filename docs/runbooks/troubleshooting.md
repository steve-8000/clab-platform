# Troubleshooting Runbook

## Quick Reference

| Symptom                          | Likely Cause                    | Jump To                        |
| -------------------------------- | ------------------------------- | ------------------------------ |
| Tasks stuck in `DISPATCHED`      | Worker session stale/dead       | [Session Stale](#session-stale)|
| Tasks timing out                 | Worker hung or slow             | [Task Timeout](#task-timeout)  |
| Services can't start             | DB connection failure           | [DB Connection](#db-connection-issues) |
| Events not flowing               | NATS disconnected               | [NATS Disconnection](#nats-disconnection) |
| Mission stuck in `EXECUTING`     | Wave not completing             | [Mission Failure Recovery](#mission-failure-recovery) |
| Dashboard shows no data          | WebSocket or API gateway issue  | [Dashboard Issues](#dashboard-issues) |

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

- `fatal` — Unrecoverable errors
- `error` — Errors that affect functionality
- `warn` — Unexpected conditions that are handled
- `info` — Normal operational messages (default)
- `debug` — Detailed diagnostic information
- `trace` — Very verbose, includes request/response bodies

```bash
# Temporarily increase log level for a deployment
kubectl set env deployment/orchestrator LOG_LEVEL=debug -n clab-platform
```

---

## Common Issues

### Session Stale

**Symptoms:**
- Tasks stuck in `DISPATCHED` or `RUNNING` status
- Runtime manager logs show `session stale: no heartbeat for >30s`
- Worker pane in tmux is unresponsive or shows an error

**Diagnosis:**

```bash
# Check session status in the database
psql $DATABASE_URL -c "
  SELECT id, worker_id, pane_id, status, last_heartbeat,
         NOW() - last_heartbeat AS heartbeat_age
  FROM agent_sessions
  WHERE status NOT IN ('TERMINATED')
  ORDER BY last_heartbeat DESC;
"

# Check if the tmux pane still exists
# (from a machine with tmux access)
tmux list-panes -a | grep <pane_id>

# Check runtime-manager logs for heartbeat failures
kubectl logs -l app=runtime-manager -n clab-platform | grep "heartbeat"
```

**Resolution:**

1. **Automatic recovery**: The runtime manager's stale-session reaper runs every 15 seconds. It marks stale sessions as `TERMINATED` and re-queues their tasks. Wait 30-60 seconds to see if it recovers.

2. **Manual session cleanup**:
   ```bash
   # Mark session as terminated
   psql $DATABASE_URL -c "
     UPDATE agent_sessions SET status = 'TERMINATED', updated_at = NOW()
     WHERE id = '<session-id>';
   "

   # Reset the task to PENDING so it gets re-dispatched
   psql $DATABASE_URL -c "
     UPDATE tasks SET status = 'PENDING', updated_at = NOW()
     WHERE id = '<task-id>' AND status IN ('DISPATCHED', 'RUNNING');
   "
   ```

3. **Kill the stuck tmux pane** (if applicable):
   ```bash
   tmux kill-pane -t <pane_id>
   ```

**Prevention:**
- Ensure `WORKER_HEARTBEAT_TIMEOUT_MS` is set appropriately (default: 30000).
- Monitor the `session.heartbeat` NATS subject for gaps.

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
  SELECT t.id, t.title, t.timeout_seconds, t.max_retries,
         tr.attempt, tr.status, tr.started_at, tr.completed_at,
         tr.completed_at - tr.started_at AS duration
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
     UPDATE tasks SET timeout_seconds = 600, updated_at = NOW()
     WHERE id = '<task-id>';
   "
   ```
   Then retry the task (see [How to Manually Retry Tasks](#how-to-manually-retry-tasks)).

2. **If the worker is hung**, kill the session and let the task be re-dispatched:
   ```bash
   # Find the session
   psql $DATABASE_URL -c "
     SELECT s.id, s.pane_id FROM agent_sessions s
     JOIN task_runs tr ON tr.session_id = s.id
     WHERE tr.task_id = '<task-id>'
     ORDER BY tr.attempt DESC LIMIT 1;
   "
   # Terminate it
   psql $DATABASE_URL -c "
     UPDATE agent_sessions SET status = 'TERMINATED' WHERE id = '<session-id>';
   "
   ```

3. **If the task spec is flawed** (e.g., impossible acceptance criteria), update the spec or skip the task:
   ```bash
   # Skip the task
   psql $DATABASE_URL -c "
     UPDATE tasks SET status = 'SKIPPED', updated_at = NOW()
     WHERE id = '<task-id>';
   "
   ```

**Prevention:**
- Set realistic `timeout_seconds` based on task complexity.
- Use the `BROWSER` task type for web interactions (they have longer default timeouts).

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

# Check connection pool status (if using pgBouncer)
psql $DATABASE_URL -c "SHOW pool_size;" 2>/dev/null

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
- The `packages/nats-client` has built-in reconnection with exponential backoff.

---

### Dashboard Issues

**Symptoms:**
- Dashboard loads but shows no missions or stale data
- WebSocket connection fails (browser console shows `WebSocket connection to 'wss://...' failed`)
- Dashboard shows a loading spinner indefinitely

**Diagnosis:**

```bash
# Check if the dashboard pod is running
kubectl get pods -l app=dashboard -n clab-platform

# Check if the API gateway WebSocket endpoint is reachable
kubectl port-forward svc/api-gateway 3000:3000 -n clab-platform
# Then in another terminal:
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  http://localhost:3000/ws

# Check CORS configuration
curl -I -X OPTIONS http://localhost:3000/ws \
  -H "Origin: https://dashboard.example.com"
```

**Resolution:**

1. **CORS issue**: Ensure `DASHBOARD_ORIGIN` in the API gateway matches the dashboard URL.

2. **WebSocket ingress**: Ensure the ingress controller supports WebSocket upgrades:
   ```yaml
   # In ingress annotation (nginx)
   nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
   nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
   nginx.ingress.kubernetes.io/websocket-services: "api-gateway"
   ```

3. **API gateway not forwarding events**: Restart it:
   ```bash
   kubectl rollout restart deployment/api-gateway -n clab-platform
   ```

---

## How to Manually Retry Tasks

### Via API

```bash
# Retry a specific task
curl -X POST http://localhost:3000/api/tasks/<task-id>/retry \
  -H "Authorization: Bearer <token>"
```

### Via Database

```bash
# Reset task status to PENDING
psql $DATABASE_URL -c "
  UPDATE tasks
  SET status = 'PENDING', updated_at = NOW()
  WHERE id = '<task-id>';
"

# Notify the orchestrator (via NATS or by restarting it)
# The orchestrator's wave monitor will pick up the pending task
```

### Retry all failed tasks in a wave

```bash
psql $DATABASE_URL -c "
  UPDATE tasks
  SET status = 'PENDING', updated_at = NOW()
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
         w.order AS wave_order, w.status AS wave_status,
         t.title AS task_title, t.status AS task_status, t.type
  FROM missions m
  JOIN plans p ON p.mission_id = m.id
  JOIN waves w ON w.plan_id = p.id
  JOIN tasks t ON t.wave_id = w.id
  WHERE m.id = '<mission-id>'
  ORDER BY w.order, t.priority DESC;
"
```

### Option 1: Retry failed tasks

If specific tasks failed but the plan is sound:

```bash
# Reset failed tasks and their wave
psql $DATABASE_URL -c "
  BEGIN;

  UPDATE tasks SET status = 'PENDING', updated_at = NOW()
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

  UPDATE missions SET status = 'EXECUTING', updated_at = NOW()
  WHERE id = '<mission-id>';

  COMMIT;
"
```

### Option 2: Re-plan the mission

If the plan itself was flawed:

```bash
# Reset mission to PLANNING status
# The orchestrator will generate a new plan
psql $DATABASE_URL -c "
  UPDATE missions SET status = 'PLANNING', updated_at = NOW()
  WHERE id = '<mission-id>';
"
```

### Option 3: Cancel the mission

If the mission should be abandoned:

```bash
psql $DATABASE_URL -c "
  BEGIN;

  -- Cancel all non-terminal tasks
  UPDATE tasks SET status = 'SKIPPED', updated_at = NOW()
  WHERE wave_id IN (
    SELECT w.id FROM waves w
    JOIN plans p ON p.id = w.plan_id
    WHERE p.mission_id = '<mission-id>'
  ) AND status NOT IN ('COMPLETED', 'FAILED', 'SKIPPED');

  -- Terminate active sessions
  UPDATE agent_sessions SET status = 'TERMINATED', updated_at = NOW()
  WHERE mission_id = '<mission-id>'
    AND status NOT IN ('TERMINATED');

  -- Mark mission as cancelled
  UPDATE missions SET status = 'CANCELLED', updated_at = NOW(), completed_at = NOW()
  WHERE id = '<mission-id>';

  COMMIT;
"
```

### Option 4: Via API (preferred)

```bash
# Retry mission
curl -X POST http://localhost:3000/api/missions/<mission-id>/retry \
  -H "Authorization: Bearer <token>"

# Cancel mission
curl -X POST http://localhost:3000/api/missions/<mission-id>/cancel \
  -H "Authorization: Bearer <token>"
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
