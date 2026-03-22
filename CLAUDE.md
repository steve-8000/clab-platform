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

Agent Workspace (created at plan stage):
  ├─ codex-worker-0 ── parallel execution
  ├─ codex-worker-1 ── parallel execution
  ├─ codex-worker-2 ── parallel execution
  └─ claude-reviewer ── review + fix loop
```

- Orchestrator WS: browser only. Never add agent surfaces.
- Agent WS: all codex/claude work happens here. User switches tabs to monitor.
- **cmux notify = trigger** ("looks done") — NOT source of truth
- **clab review = truth** ("actually succeeded, failed, or waiting")
- Agents run with full permissions: `--dangerously-skip-permissions`, `--full-auto`
- Reasoning (planner/verifier/replanner): subprocess via `claude --print`, no workspace created
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
4. Only stop when explicitly told: "stop", "중단", "그만"

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
Step 1: main → split right → w0       [main]     [w0]
Step 2: main → split down  → w1       [w1]       [w2]
Step 3: w0   → split down  → w2       [reviewer]
Step 4: w1   → split down  → reviewer
```

- Alternate between left/right columns when splitting down
- Cascading down from same surface makes each subsequent pane smaller
- WorkerPool (worker.py) and CmuxRuntime (executor.py) both follow this pattern

## cmux Notification-Based Monitoring

Never use blind `sleep N` to wait for task completion. Use cmux notifications.

### Notification format
```
cmux list-notifications output:
index:notification_id | workspace_id | surface_id | status | title | subtitle | body

Codex completion:  title="Codex", subtitle="", body=""
Claude completion:  title="Claude Code", subtitle="Completed in {project}", body="completion message"
```

### Polling pattern (orchestrator)
```bash
# Poll every 2s until notification appears
for i in $(seq 1 150); do
  sleep 2
  notifs=$(cmux list-notifications 2>&1)
  [ "$notifs" != "No notifications" ] && break
done
```

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
