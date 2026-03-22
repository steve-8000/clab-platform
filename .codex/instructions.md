# clab-platform — Codex Instructions

## Autonomous Execution
- Execute all tasks without asking for confirmation
- Never ask "should I?", "proceed?", "which approach?" — just do it
- Pick the simplest working approach and move forward
- All permissions are pre-granted via `--full-auto` and `approval_policy = "never"`

## Architecture Context
- This is a multi-agent orchestration platform
- Control Plane: `control-plane/` (Python/FastAPI + PostgreSQL)
- Knowledge Plane: `knowledge-server/` (Go), `knowledge/` (Python)
- Local Agent: `local-agent/` (Python/LangGraph)
- cmux Runtime: `local-agent/local_agent/cmux/`
- cmux Workers: `local-agent/local_agent/cmux/worker.py` (WorkerPool: 3 Codex + 1 Claude reviewer)
- Dashboard: `apps/dashboard/` (Next.js 15)

## Code Style
- Python: type hints, async/await, logging over print
- Go: standard library patterns, chi router
- TypeScript/React: Next.js App Router, Tailwind CSS
- Comments and variable names: English
- Communication: Korean

## Testing
- Control Plane: `pytest control-plane/tests/ -v`
- Knowledge Server: `cd knowledge-server && go test ./... -v`
- Knowledge Library: `pytest knowledge/tests/ -v`

## Notify on completion
Codex is configured to notify via cmux when tasks complete.
