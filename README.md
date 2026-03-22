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
  ├── Orchestrator LLM (planning, tool selection, replanning)
  ├── LangGraph Agent (full StateGraph execution)
  ├── Claude CLI / Codex CLI (code execution)
  ├── Test / Build / Lint (verification)
  └── WebSocket → Control Plane (state sync)
```

## Quick Start

### 1. Deploy K8s Services

```bash
# Build images
docker build -t clab/control-plane:v1 control-plane/
docker build -t clab/knowledge-service:v1 knowledge-server/

# Deploy
kubectl apply -f control-plane/k8s/control-plane.yaml
kubectl apply -f knowledge-server/k8s/knowledge-service.yaml
```

### 2. Run Local Agent

```bash
cd local-agent
./setup.sh
source .venv/bin/activate

python -m local_agent \
  --control-plane https://control.clab.dev \
  --knowledge https://knowledge.clab.dev \
  --workdir ~/my-project \
  "REST API 개발해줘"
```

## Components

| Component | Language | Lines | Tests | Location |
|-----------|----------|-------|-------|----------|
| Control Plane | Python (FastAPI) | 471 | - | `control-plane/` |
| Knowledge Server | Go (chi) | 2,154 | 32 | `knowledge-server/` |
| Knowledge Library | Python | 2,235 | 47 | `knowledge/` |
| Local Agent | Python (LangGraph) | 1,255 | - | `local-agent/` |

## Execution Flow

```
User Goal → Local Agent
  ├── 1. Pre-K: search prior knowledge (→ Knowledge Plane)
  ├── 2. Planner LLM: decompose into task graph
  ├── 3. For each task:
  │     ├── Claude/Codex CLI execution (local subprocess)
  │     ├── Test/Build/Lint verification
  │     ├── Failure → Replanner LLM → retry
  │     └── Success → next task
  ├── 4. Post-K: verify knowledge integrity
  ├── 5. Extract insights → store in Knowledge
  └── 6. Return results + artifacts
```

## Production Features

- **Checkpointer**: Remote checkpoint storage via Control Plane HTTP API
- **Human-in-the-loop**: Interrupt/resume via `/interrupts` API
- **Streaming**: WebSocket → SSE event streaming to dashboards
- **Retry/Compensation**: LangGraph RetryPolicy + LLM-based replanning
- **Long-running Resume**: thread_id based checkpoint recovery
- **Multi-worker**: Worker registry with capability-based scheduling
- **Artifact Lineage**: Audit log + artifact tracking

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
