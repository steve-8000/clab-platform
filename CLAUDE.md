# clab-platform — Claude Code Instructions

## Available MCP Tools

This project provides an MCP server (`clab`) with the following tools:

### Knowledge Tools
- **knowledge_search** — Search the knowledge base for prior decisions, patterns, and insights
- **knowledge_store** — Store a new knowledge entry for future reference
- **knowledge_pre_k** — Retrieve relevant prior knowledge BEFORE starting work on a task
- **knowledge_post_k** — Verify knowledge integrity AFTER completing work

### Agent Tools
- **mission_run** — Run a full development mission through the LangGraph agent (Plan → Execute → Verify → Replan loop)

### Platform Tools
- **platform_health** — Check health of all services
- **session_list** — List agent sessions
- **interrupt_list** — List pending human-in-the-loop requests
- **interrupt_resolve** — Resolve a pending interrupt

## Workflow

1. Before starting work, use `knowledge_pre_k` to check for prior knowledge
2. After completing work, use `knowledge_post_k` to verify document integrity
3. Store important decisions with `knowledge_store`
4. For complex multi-step tasks, use `mission_run` to delegate to the LangGraph agent

## Architecture

- **Control Plane** (K8s): Session state, checkpoints, interrupts, workers, audit
- **Knowledge Plane** (K8s): Knowledge storage, Pre-K/Post-K, insights
- **Execution Plane** (Local): LangGraph agent, Claude/Codex CLI

## Environment

Set these to point to your K8s services:
- `CLAB_CONTROL_URL` — Control Plane URL (default: http://localhost:8000)
- `CLAB_KNOWLEDGE_URL` — Knowledge Service URL (default: http://localhost:4007)
