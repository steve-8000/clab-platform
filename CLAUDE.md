# clab-platform — Claude Code Instructions

## Architecture

Three-layer multi-agent orchestration platform:

- **Control Plane** (K8s/FastAPI): Threads, runs, checkpoints, interrupts, state machines, audit
- **Knowledge Plane** (K8s/Go): Pre-K/Post-K, knowledge storage, insight extraction
- **cmux Runtime Plane** (Local): Agent execution via cmux workspaces/surfaces/browser

### cmux Workspace Model

Two-workspace architecture: orchestrator stays clean, agents work separately.

```
Orchestrator Workspace (user-facing):
  ├─ Surface: Claude CLI (orchestrator)
  └─ Surface: Browser (optional, for verification)
  ※ No codex/claude agent surfaces here

Agent Workspace "agent-planner" (planner creates at plan stage):
  ├─ codex-0 (main) ── planner + reviewer (dual role)
  ├─ codex-1 (right) ── worker
  ├─ codex-2 (down-left) ── worker
  └─ codex-3 (down-right) ── worker
```

- Orchestrator WS: browser only. Never add agent surfaces.
- Agent WS: all codex work happens here. User switches tabs to monitor.
- Workspace persists across missions — codex sessions retain context, no restart overhead
- **cmux notify = trigger** ("looks done") — NOT source of truth
- **clab review = truth** ("actually succeeded, failed, or waiting")
- Agents run with full permissions: `--dangerously-skip-permissions`, `--full-auto`
- Planner/verifier/replanner: codex-0 in agent WS (same surface as reviewer), subprocess fallback
- mission_run: parallel by default (MCP `parallel=true`), CLI opt-in (`--parallel`)

## Available MCP Tools

### Knowledge Tools
- **knowledge_search** — Search knowledge base
- **knowledge_store** — Store decisions/patterns/insights
- **knowledge_pre_k** — Retrieve prior knowledge BEFORE starting work
- **knowledge_post_k** — Verify document integrity AFTER completing work

### Agent Tools
- **mission_run** — Run a full mission through the LangGraph agent

### Platform Tools
- **platform_health** — Check health of all services
- **session_list** — List agent sessions
- **interrupt_list** / **interrupt_resolve** — Human-in-the-loop management

## Autonomous Execution Rules

1. Agents execute ALL tasks without asking for confirmation
2. Permission prompts are auto-accepted (monitor.py handles this)
3. Design questions are auto-resolved — agents pick the simplest approach
4. Only stop when explicitly told: "stop"

## Workflow

1. `knowledge_pre_k` — check for prior knowledge
2. Plan and decompose tasks into waves
3. Execute via cmux: `CmuxRuntime.create_agent()` → `allocate_surface()` → `inject_command()`
4. Monitor completion via idle detection + notifications
5. clab state machine verifies actual success/failure
6. `knowledge_post_k` — verify document integrity
7. Store insights with `knowledge_store`

## cmux Surface Split Rules

Balanced 2-column grid layout. Never cascade splits from same surface.

```
Step 1: main → split right → w1       [codex-0]  [codex-1]
Step 2: main → split down  → w2       [codex-2]  [codex-3]
Step 3: w1   → split down  → w3       (planner/reviewer stays on main)
```

- Alternate between left/right columns when splitting down
- Cascading down from same surface makes each subsequent pane smaller
- WorkerPool (worker.py) and CmuxRuntime (executor.py) both follow this pattern

## Codex Prompting Rules

- Prefer direct inline instructions over prompt file references
- When using prompt files: preamble MUST include "Do not produce a task list or plan. Execute now."
- Keep edits to ≤4 per prompt (more causes codex to switch to planning mode)
- Always end with "Modify files directly. Do not summarize or plan."

## cmux Notification-Based Monitoring

Never use blind `sleep N` to wait for task completion. Use cmux notifications.

### Notification format
```
cmux list-notifications output:
index:notification_id | workspace_id | surface_id | status | title | subtitle | body

Codex completion:  title="Codex", subtitle="", body=""
Claude completion:  title="Claude Code", subtitle="Completed in {project}", body="completion message"

Fields: index:notification_id | workspace_id | surface_id | status | title | subtitle | body
- surface_id (field 3) is the key for filtering — match against the surface you dispatched to
- status can be "unread" or "read" (user viewing workspace) — do NOT filter by status
```

### Polling pattern (orchestrator)
```bash
# 1. Clear stale notifications BEFORE injecting command
cmux clear-notifications 2>&1 > /dev/null

# 2. Inject command to codex surface
cmux send --workspace $WS --surface $SURFACE "$INSTRUCTION"
sleep 1
cmux send-key --workspace $WS --surface $SURFACE "enter"

# 3. Wait for codex to start processing (avoid stale notification false positives)
sleep 15

# 4. Clear again (catches codex startup notifications)
cmux clear-notifications 2>&1 > /dev/null

# 5. Poll for completion notification from OUR surface
for i in $(seq 1 120); do
  sleep 4
  notifs=$(cmux list-notifications 2>&1)
  if echo "$notifs" | grep -q "$SURFACE_UUID"; then
    echo "DONE"; cmux clear-notifications 2>&1 > /dev/null; break
  fi
  # Fallback: any Codex notification (less precise)
  if echo "$notifs" | grep -q "Codex"; then
    echo "DONE (fallback)"; cmux clear-notifications 2>&1 > /dev/null; break
  fi
done
```
**Key rules:**
- Always `clear-notifications` before injecting commands
- Wait ≥15s after injection before polling (codex startup takes time)
- Filter by surface UUID when possible (field 3 in pipe-delimited output)
- Notification status may be `read` (user viewing) or `unread` — filter by surface_id, not status

### Alternatives
- `tail -f logfile | grep -m1 "Completed:"` — log-based detection
- `run_in_background` + notification polling — parallel work during wait

### Internal monitoring (monitor.py)
- Primary: notification-first (`_check_notifications` matches `surface_id`)
- Fallback: idle pattern detection (double-check confirmation)
- Auto-responds to permission prompts for autonomous operation

## Key Paths

| Component | Path |
|-----------|------|
| Control Plane | `control-plane/` (Python/FastAPI) |
| Knowledge Server | `knowledge-server/` (Go/chi) |
| Knowledge Library | `knowledge/` (Python) |
| Local Agent | `local-agent/` (Python/LangGraph) |
| cmux Runtime | `local-agent/local_agent/cmux/` |
| cmux Workers    | `local-agent/local_agent/cmux/worker.py` |
| MCP Server | `mcp-server/server.py` |

## Environment

- `CLAB_CONTROL_URL` — Control Plane (default: https://ai.clab.one/api/cp)
- `CLAB_KNOWLEDGE_URL` — Knowledge Service (default: https://ai.clab.one/api/ks)
- `CMUX_SOCKET_PATH` — cmux socket (default: ~/Library/Application Support/cmux/cmux.sock)
