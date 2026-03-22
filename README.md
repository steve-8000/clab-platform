# clab-platform — Multi-Agent Orchestration Platform

Stateful development agent platform with knowledge integration.
LangGraph-native, 3-layer architecture: Control Plane + Knowledge Plane + cmux Runtime Plane.

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** (for dashboard)
- **Go 1.21+** (for knowledge-server, if building from source)
- **Docker + Kubernetes** (for K8s deployment, optional)
- **Claude Code CLI** or **Codex CLI** (at least one required)
  - `npm install -g @anthropic-ai/claude-code`
  - `npm install -g @openai/codex`
- **cmux** (required for parallel execution mode)

## Setup

```bash
git clone https://github.com/steve-8000/clab-platform.git
cd clab-platform
bash setup.sh
```

This installs local-agent and mcp-server Python dependencies, creates `.env`, and registers MCP tools with Codex.

### Use as MCP Tool (recommended)

```bash
# In any project directory:
bin/clab-init              # Creates .mcp.json + .claude/settings.json
claude                     # or: codex
# Then use mission_run, knowledge_search, etc. as MCP tools
```

### Use Local Agent Directly

```bash
cd local-agent && source .venv/bin/activate
python -m local_agent --parallel --workdir ~/my-project "implement REST API"
```

### Deploy K8s Services (optional)

```bash
cp .env.example .env       # Edit API keys
bin/build-images.sh
kubectl apply -f k8s/
bin/port-forward.sh        # For local access
```

## Architecture

```
A. Control Plane (K8s, FastAPI)        B. Knowledge Plane (K8s, Go)
  ├── Thread/run state machine           ├── Pre-K / Post-K lifecycle
  ├── Checkpointer (PostgreSQL)          ├── Knowledge search & storage
  ├── Human-in-the-loop interrupts       ├── Insight extraction
  ├── SSE streaming to dashboards        └── Document integrity checks
  └── Worker registry

C. cmux Runtime Plane (Local)
  ├── LangGraph StateGraph agent
  ├── cmux Runtime (workspace/surface management)
  │   ├── codex-0: planner + reviewer (dual role)
  │   ├── codex-1/2/3: parallel workers
  │   └── Browser surface (isolated verification)
  └── Notification-based completion monitoring
```

## Components

| Component | Language | Path |
|-----------|----------|------|
| Control Plane | Python (FastAPI) | `control-plane/` |
| Knowledge Server | Go (chi) | `knowledge-server/` |
| Knowledge Library | Python | `knowledge/` |
| Local Agent | Python (LangGraph) | `local-agent/` |
| cmux Runtime | Python | `local-agent/local_agent/cmux/` |
| Dashboard | Next.js | `apps/dashboard/` |
| Code Intelligence | Python (FastAPI) | `apps/code-intel/` |
| CodeGraph Adapter | Python | `packages/codegraph/` |
| MCP Server | Python | `mcp-server/` |

## Execution Flow

```
User Goal → Local Agent
  1. Pre-K: retrieve prior knowledge (→ Knowledge Plane)
  2. Planner (codex-0 on main surface): decompose goal into task graph
  3. Execute tasks:
     ├── Parallel mode (default): WorkerPool
     │   ├── codex-1/2/3 execute tasks concurrently
     │   ├── codex-0 reviews each result (APPROVED / FIX)
     │   └── Fix loop: reviewer → worker → re-review (max 2 rounds)
     └── Sequential mode: single codex surface
  4. Verifier: test/lint/typecheck validation
  5. Replanner: on failure, LLM re-decomposes and retries
  6. Post-K: verify knowledge integrity
  7. Extract insights → store in Knowledge Plane
```

### Task Contract

- Each planned task must be independently executable by a CLI tool.
- A worker should be able to run a single task in isolation without hidden shared step order.
- Task definitions should include the concrete command or entrypoint needed to execute the task.

## cmux Workspace Model

```
Orchestrator Workspace (user-facing):
  ├── Claude CLI (orchestrator) — read/analyze/dispatch only
  └── Browser (optional, verification)

Agent Workspace "agent-planner" (created at plan stage):
  ├── codex-0 (main)  ── planner + reviewer (dual role)
  ├── codex-1 (right) ── worker
  ├── codex-2 (down-left)  ── worker
  └── codex-3 (down-right) ── worker
```

- Orchestrator WS: coordination only, no codex surfaces
- Agent WS: all codex work happens here, single workspace with 4 surfaces
- Workspace named `{orchestrator}:agent` (e.g. `K8s-STG:agent`), persists across missions
- Planner creates agent WS → executor reuses it via `_planner_runtime.workspace_id`
- `cmux notify` = trigger (looks done), `clab review` = truth (actually verified)

### Notification Polling Protocol

```bash
cmux clear-notifications          # 1. Clear stale
cmux send --surface $S "$CMD"     # 2. Inject command
sleep 15                          # 3. Wait for codex startup
cmux clear-notifications          # 4. Clear startup noise
# 5. Poll by surface_id (field 3), not by status
for i in $(seq 1 120); do
  sleep 4
  cmux list-notifications | grep -q "$SURFACE_UUID" && break
done
```

### Codex Prompting

- Direct inline instructions preferred over prompt file references
- Preamble: `"Do not produce a task list or plan. Execute now."`
- Max ≤4 edits per prompt (more triggers planning mode)
- End with: `"Modify files directly. Do not summarize or plan."`

## Workspace Lifecycle

- Agent workspace created on first mission, reused across subsequent missions
- Codex sessions retain file history and context between missions
- No startup overhead on repeat runs (codex already running on surfaces)
- Workspace auto-detected via `CMUX_WORKSPACE_ID` environment variable
- Named `{orchestrator}:agent` — deterministic lookup, no collision between sessions

## MCP Tools

Available via `mcp-server/server.py`:

| Tool | Description |
|------|-------------|
| `mission_run` | Run full mission (parallel by default) |
| `knowledge_pre_k` | Retrieve prior knowledge before work |
| `knowledge_post_k` | Verify knowledge integrity after work |
| `knowledge_search` | Search knowledge base |
| `knowledge_store` | Store decisions/patterns/insights |
| `platform_health` | Check service health |
| `session_list` | List agent sessions |
| `interrupt_list` / `interrupt_resolve` | Human-in-the-loop |

## Production Features

- **Checkpointer**: Remote checkpoint storage via Control Plane HTTP API
- **Human-in-the-loop**: Interrupt/resume via `/interrupts` API
- **SSE Streaming**: WebSocket → SSE event streaming to dashboards
- **Retry/Replanning**: LangGraph RetryPolicy + LLM-based replanning
- **Long-running Resume**: thread_id based checkpoint recovery
- **Parallel Execution**: 4-surface codex WorkerPool with review loop
- **Idle Detection**: TUI prompt detection instead of blind sleep
- **Notification Filtering**: surface_id based polling, status-agnostic

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent Framework | LangGraph + LangChain |
| LLM | Claude (Anthropic) / GPT (OpenAI) |
| Control Plane | FastAPI + WebSocket + SSE |
| Knowledge Server | Go + chi router |
| CLI Execution | Codex CLI (primary) + Claude Code CLI (fallback) |
| Runtime | cmux (workspace/surface multiplexer) |
| Container | Docker |
| Orchestration | Kubernetes + ArgoCD (GitOps) |
| Database | PostgreSQL |

## License

MIT
