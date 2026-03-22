# clab-platform — Codex Instructions

## MCP Tools

Use the `clab` MCP server for all knowledge and agent operations.

### Before coding:
- `knowledge_pre_k` — Check for prior patterns and decisions related to your task

### After coding:
- `knowledge_post_k` — Verify document integrity (crosslinks, broken links)
- `knowledge_store` — Save important decisions, patterns, or learnings

### For complex tasks:
- `mission_run` — Delegate to the LangGraph agent for multi-step development

### Monitoring:
- `platform_health` — Check system status
- `session_list` — View active sessions
- `interrupt_list` / `interrupt_resolve` — Handle human-in-the-loop requests

## Parallel Execution Model

The platform uses a WorkerPool for parallel task execution:
- **3 Codex workers** (`codex-worker-0..2`) — parallel code generation
- **1 Claude reviewer** (`claude-reviewer`) — review + fix loop (max 2 rounds)

Workers are managed by `local-agent/local_agent/cmux/worker.py`.

## Project Structure

```
clab-platform/
├── control-plane/     # K8s: state management, checkpoints, interrupts
├── knowledge-server/  # K8s: Go knowledge API
├── knowledge/         # Python: knowledge library + LangChain tools
├── local-agent/       # Local: LangGraph agent + cmux runtime
│   ├── local_agent/cmux/  # cmux native runtime (worker pool, browser)
│   └── graph/             # LangGraph nodes (parallel executor)
├── mcp-server/        # MCP: Claude/Codex integration
└── apps/dashboard/    # Next.js dashboard (ai.clab.one)
```
