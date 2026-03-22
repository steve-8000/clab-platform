# clab-platform — Codex Instructions

## Autonomous Execution
- Execute all tasks without asking for confirmation
- Never ask "should I?", "proceed?", "which approach?" — just do it
- Pick the simplest working approach and move forward
- All permissions are pre-granted via `--full-auto` and `approval_policy = "never"`
- Only stop when explicitly told: "stop"

## Architecture

Three-layer multi-agent orchestration platform:

- **Control Plane** (K8s, FastAPI): `control-plane/` — threads, runs, checkpoints, interrupts
- **Knowledge Plane** (K8s, Go): `knowledge-server/` — Pre-K/Post-K, knowledge storage
- **cmux Runtime Plane** (Local): `local-agent/` — LangGraph agent + cmux workspace execution

### cmux Workspace Model

```
Orchestrator Workspace (user-facing):
  ├── Claude CLI or Codex CLI (orchestrator)
  └── Browser (optional, verification)

Agent Workspace "agent-planner" (created at plan stage):
  ├── codex-0 (main) — planner + reviewer (dual role)
  ├── codex-1 (right) — worker
  ├── codex-2 (down-left) — worker
  └── codex-3 (down-right) — worker
```

- All agent work uses codex engine (never claude)
- Planner creates agent WS → executor reuses it
- cmux notify = trigger, clab review = truth

## MCP Tools (via `clab` server)

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

Use `/mcp` to list available tools.

## Key Paths

| Component | Path |
|-----------|------|
| Control Plane | `control-plane/` (Python/FastAPI) |
| Knowledge Server | `knowledge-server/` (Go/chi) |
| Local Agent | `local-agent/` (Python/LangGraph) |
| cmux Runtime | `local-agent/local_agent/cmux/` |
| Dashboard | `apps/dashboard/` (Next.js) |
| Code Intelligence | `apps/code-intel/` (FastAPI) |
| CodeGraph Adapter | `packages/codegraph/` |
| MCP Server | `mcp-server/server.py` |

## Code Style
- Python: type hints, async/await, logging over print
- Go: standard library patterns, chi router
- TypeScript/React: Next.js App Router, Tailwind CSS
- Comments and variable names: English
- Respond in Korean

## Testing
- Agent tests: `cd local-agent && PYTHONPATH=. python3 -m pytest ../tests/agent/ -v`
- Control Plane: `python3 -m pytest control-plane/tests/ -v`
- Knowledge Server: `cd knowledge-server && go test ./... -v`
- Knowledge Library: `python3 -m pytest knowledge/tests/ -v`
- CodeGraph: `cd local-agent && PYTHONPATH=. python3 -m pytest ../tests/codegraph/ -v`

## Notification Protocol
- Codex notifies via cmux on task completion
- Filter notifications by surface_id (field 3 in pipe-delimited output)
- Status may be "read" or "unread" — do NOT filter by status
