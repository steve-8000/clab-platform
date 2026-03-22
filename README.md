# clab-platform — 3-Layer LangGraph Agent Platform

Stateful development agent platform with knowledge integration.
LangGraph-native, 3-layer architecture: Control Plane + Knowledge Plane + Execution Plane.

## Architecture

```
A. Control Plane (K8s :8000)         B. Knowledge Plane (K8s :4007)
  ├── Session state                    ├── knowledge-service (Go)
  ├── Checkpointer (PostgreSQL)        ├── Pre-K / Post-K / Insights
  ├── Worker registry                  ├── Decision memory
  ├── Task scheduling                  └── Integrity rules
  ├── Human-in-the-loop API
  ├── Audit logs / Artifact lineage
  └── Dashboard API / SSE streaming

C. Execution Plane (Local)
  ├── LangGraph Agent (full StateGraph execution)
  ├── cmux Runtime (workspace/surface/worker management)
  │   ├── WorkerPool: 3× Codex parallel + 1× Claude reviewer
  │   └── Browser workspace (isolated verification)
  ├── Claude CLI / Codex CLI (code execution)
  └── Test / Build / Lint (verification)
```

## Quick Start

### 1. Deploy K8s Services

```bash
# Build all images
bin/build-images.sh

# Deploy entire stack (PostgreSQL + Control Plane + Knowledge + Dashboard)
kubectl apply -f k8s/

# Wait for ready
kubectl -n clab wait --for=condition=ready pod --all --timeout=120s
```

### 2. Connect Local Agent

```bash
# Option A: via Ingress (if DNS configured)
source .env.k8s

# Option B: via port-forward
bin/port-forward.sh

# Run agent
cd local-agent && ./setup.sh && source .venv/bin/activate
python -m local_agent --parallel --workdir ~/my-project "REST API 개발해줘"
```

### 3. View Dashboard

Open https://ai.clab.one (or http://localhost:3000 with port-forward)

## Components

| Component | Language | Location |
|-----------|----------|----------|
| Control Plane | Python (FastAPI) | `control-plane/` |
| Knowledge Server | Go (chi) | `knowledge-server/` |
| Knowledge Library | Python | `knowledge/` |
| Local Agent | Python (LangGraph) | `local-agent/` |
| cmux Runtime | Python | `local-agent/local_agent/cmux/` |
| Dashboard | Next.js | `apps/dashboard/` |
| MCP Server | Python | `mcp-server/` |
| Code Intelligence | Python (FastAPI) | `apps/code-intel/` |
| CodeGraph Adapter | Python | `packages/codegraph/` |

## Execution Flow

```
User Goal → Local Agent
  ├── 1. Pre-K: search prior knowledge (→ Knowledge Plane)
  ├── 2. Planner LLM: decompose into task graph
  ├── 3. Execute tasks (parallel or sequential):
  │     ├── MCP default: parallel mode (3× Codex + 1× Claude reviewer)
  │     ├── CLI: --parallel flag enables parallel mode
  │     ├── Parallel: WorkerPool (3× Codex workers + Claude reviewer)
  │     │   ├── Codex workers execute in parallel
  │     │   ├── Claude reviewer approves or requests fixes
  │     │   └── Fix loop: reviewer → worker → re-review (max 2 rounds)
  │     ├── Sequential: single engine surface execution
  │     ├── Test/Build/Lint verification
  │     └── Failure → Replanner LLM → retry
  ├── 4. Post-K: verify knowledge integrity
  ├── 5. Extract insights → store in Knowledge
  └── 6. Return results + artifacts
```

## cmux Workspace Model

```
Orchestrator Workspace (user-facing):
  └── Claude CLI (orchestrator) + Browser (optional)

Agent Workspace (created per mission):
  ├── codex-worker-0 ── parallel task execution
  ├── codex-worker-1 ── parallel task execution
  ├── codex-worker-2 ── parallel task execution
  └── claude-reviewer ── review + fix loop
```

Surface split layout (balanced 2-column grid):
```
[main]      [worker-0]
[worker-1]  [worker-2]
[reviewer]
```

- Orchestrator workspace: coordination only, no agent surfaces
- Agent workspace: all codex/claude work happens here
- Reasoning (planner/verifier): runs as subprocess, no workspace created
- cmux notify = trigger, clab review = truth

## Production Features

- **Checkpointer**: Remote checkpoint storage via Control Plane HTTP API
- **Human-in-the-loop**: Interrupt/resume via `/interrupts` API
- **Streaming**: WebSocket → SSE event streaming to dashboards
- **Retry/Compensation**: LangGraph RetryPolicy + LLM-based replanning
- **Long-running Resume**: thread_id based checkpoint recovery
- **Multi-worker**: Worker registry with capability-based scheduling
- **Parallel Execution**: WorkerPool with balanced cmux surface layout, review loop with max 2 fix rounds
- **Artifact Lineage**: Audit log + artifact tracking

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent Framework | LangGraph + LangChain |
| LLM | Claude (Anthropic) / GPT (OpenAI) |
| Control Plane | FastAPI + WebSocket + SSE |
| Knowledge Server | Go + chi router |
| CLI Execution | Claude Code CLI + Codex CLI |
| Container | Docker |
| Orchestration | Kubernetes (Kustomize) |
| Domains | control.clab.dev, knowledge.clab.dev |

## License

MIT
