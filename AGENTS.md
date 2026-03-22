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

## Project Structure

```
clab-platform/
├── control-plane/     # K8s: state management, checkpoints, interrupts
├── knowledge-server/  # K8s: Go knowledge API
├── knowledge/         # Python: knowledge library + LangChain tools
├── local-agent/       # Local: LangGraph agent + CLI execution
└── mcp-server/        # MCP: Claude/Codex integration
```
