# clab-platform — Execution Control Plane for Multi-Agent Orchestration

Stateful execution control plane where Claude orchestrates Codex/Claude agents through structured missions, waves, and tasks.

```
User Request → Mission → Plan → Waves → Tasks → Agent Sessions → Artifacts → Review
```

## Quick Start

```bash
# 1. Install prerequisites (user responsibility)
#    - Node.js >= 22     : https://nodejs.org or nvm install 22
#    - pnpm >= 9.15      : corepack enable && corepack prepare pnpm@9.15.4 --activate
#    - tmux              : brew install tmux (macOS) / apt install tmux (Linux)
#    - Claude Code CLI   : curl -fsSL https://claude.ai/install.sh | sh
#    - Codex CLI         : npm install -g @openai/codex
#    - Docker (optional) : https://docs.docker.com/get-docker/

# 2. Clone & setup
git clone https://github.com/steve-8000/clab-platform.git
cd clab-platform
./scripts/setup.sh    # installs deps and creates .env

# 3. Start local dependencies and services
docker compose -f infra/docker/docker-compose.yml up -d postgres nats
pnpm db:push
pnpm dev
```

## Prerequisites

Install these **before** running `setup.sh`:

| Tool | Version | Install |
|------|---------|---------|
| Node.js | >= 22 | https://nodejs.org or `nvm install 22` |
| pnpm | >= 9.15 | `corepack enable && corepack prepare pnpm@9.15.4 --activate` |
| tmux | any | `brew install tmux` (macOS) / `apt install tmux` (Linux) |
| Claude Code CLI | latest | `curl -fsSL https://claude.ai/install.sh \| sh` or `npm install -g @anthropic-ai/claude-code` |
| Codex CLI | latest | `npm install -g @openai/codex` |
| Docker | any | https://docs.docker.com/get-docker/ (optional, for containers) |

## What `setup.sh` Does

1. Verifies all prerequisites are installed
2. `pnpm install` — installs project dependencies
3. Creates `.env` from `.env.example`
4. Leaves runtime credentials optional for local `cmux` execution

Local execution uses logged-in Claude/Codex CLI sessions inside `cmux` panes.

## How It Works

```
로컬 PC (에이전트 실행)                  K8s (상태 관리)
┌─────────────────────────┐            ┌─────────────────────┐
│ Claude Code / Codex TUI  │            │ api-gateway          │
│  └─ cmux panes           │  상태 동기  │ orchestrator         │
│      ├─ codex TUI        │ ────────→  │ knowledge-service    │
│      ├─ claude TUI       │            │ review-service       │
│      ├─ browser pane     │            │ dashboard UI         │
│      └─ notifications    │ ←── 대시보드 │ postgres + nats      │
└─────────────────────────┘            └─────────────────────┘
```

- **All agent execution** runs locally via `cmux` panes (`codex`, `claude`, browser)
- **Workers launch interactive TUIs**, not one-shot batch commands, when `EXECUTION_MODE=local`
- **Agent sessions are sticky per `workspace + role + engine`** so each agent keeps a live pane across tasks
- **Task completion** is detected from pane-scoped `cmux` notifications first, with TUI idle checks as fallback
- **State sync** to K8s platform for dashboard, knowledge, review workflows
- Set `CLAB_API_URL=https://ai.clab.one` to enable platform sync
- Without `CLAB_API_URL`, the plugin works fully offline (local cmux only)
- `hyper-proxy` is not part of the intended execution path for this project

## Manual Setup

### 1. Install Dependencies & Configure

```bash
pnpm install

# Create .env and add optional overrides if needed
cp .env.example .env
# Local cmux execution uses logged-in Claude/Codex CLI sessions by default.
# API keys are only needed for direct API fallback paths.
```

### 2. Register clab Plugin in Claude Code

The clab plugin exposes orchestration tools to Claude Code via MCP. The actual task execution path for local work is `cmux` + interactive Claude/Codex TUIs.

```bash
# Set CLAUDE_PLUGIN_ROOT (add to ~/.zshrc or ~/.bashrc)
export CLAUDE_PLUGIN_ROOT=$(pwd)

# Register plugin in Claude Code settings (~/.claude/settings.json)
./scripts/setup.sh   # handles everything automatically
```

<details>
<summary>Manual plugin registration</summary>

Add to `~/.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "clab@clab-local": true
  },
  "extraKnownMarketplaces": {
    "clab-local": {
      "source": {
        "source": "directory",
        "path": "/absolute/path/to/clab-platform"
      }
    }
  }
}
```

The `.claude-plugin/plugin.json` defines the plugin metadata and the `.mcp.json` references `${CLAUDE_PLUGIN_ROOT}` for the MCP server path.
</details>

### 5. Start Services

```bash
# Start PostgreSQL + NATS
docker compose -f infra/docker/docker-compose.yml up -d postgres nats

# Run database migrations
pnpm db:push

# Start all services in dev mode
pnpm dev
```

### 6. Launch Claude with clab

```bash
# From any directory — the plugin loads automatically
claude
# Use /clab:init to set up, /clab:dispatch to delegate tasks
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    api-gateway :4000                     │
│                REST / WebSocket facade                   │
├─────────────┬───────────────────────┬───────────────────┤
│ orchestrator │  runtime-manager     │  review-service   │
│    :4001    │       :4002           │     :4006         │
├─────────────┼───────────┬───────────┼───────────────────┤
│             │worker-codex│worker-claude│ browser-service │
│             │   :4003   │   :4004    │     :4005       │
├─────────────┴───────────┴────────────┴──────────────────┤
│              PostgreSQL  │  NATS JetStream               │
└─────────────────────────────────────────────────────────┘
```

## Domain Model

```
Mission
  └─ Plan
      └─ Wave[]
          └─ Task[]
              └─ TaskRun[]
                  └─ AgentSession
                      └─ Artifact[]
                      └─ Decision[]
```

## Services

| Service | Port | Role |
|---------|------|------|
| api-gateway | 4000 | External entry point (REST/WS) |
| orchestrator | 4001 | Mission planning, wave scheduling |
| runtime-manager | 4002 | Sticky session lifecycle, `cmux` pane management |
| worker-codex | 4003 | Codex task execution in `cmux` TUI |
| worker-claude | 4004 | Claude task execution in `cmux` TUI |
| browser-service | 4005 | Browser automation |
| review-service | 4006 | QA and verification |
| knowledge-service | 4007 | AKB knowledge layer |
| dashboard | 3000 | Operations UI |

## Deployment (K8s / ArgoCD GitOps)

### Build & Deploy to K8s

```bash
# Build all service images
for svc in api-gateway mission-service runtime-manager worker-codex worker-claude browser-service review-service; do
  docker build --build-arg SERVICE=$svc -t clab/$svc:v1 .
done
docker build -f infra/docker/Dockerfile.dashboard -t clab/dashboard:v1 .

# Import to k3s containerd (for imagePullPolicy: Never)
for img in api-gateway mission-service runtime-manager worker-codex worker-claude browser-service review-service dashboard; do
  docker save clab/$img:v1 | ssh user@server ctr images import -
done

# ArgoCD syncs from the k8s-stg repo automatically
```

### GitOps Architecture

```
clab-platform (source)          k8s-stg (deployment repo)      K8s Cluster
┌──────────────────┐           ┌─────────────────────┐        ┌──────────────┐
│ apps/             │  build   │ workloads/           │  sync  │ ns:           │
│ packages/         │ ──────→  │   clab-platform/     │ ─────→ │ clab-platform │
│ infra/k8s/        │  image   │     kustomization.yaml│ ArgoCD│              │
│ Dockerfile        │          │     services.yaml    │        │ 11 pods      │
└──────────────────┘           │     dashboard.yaml   │        └──────────────┘
                               │     postgres.yaml    │
                               │     nats.yaml        │
                               └─────────────────────┘
```

| Component | Details |
|-----------|---------|
| Cluster | k3s (single node or HA) |
| Namespace | `clab-platform` |
| Ingress | nginx + cert-manager (Let's Encrypt TLS) |
| Domain | `ai.clab.one` |
| Storage | PostgreSQL StatefulSet + PVC |
| Events | NATS JetStream |
| Images | Local containerd (`imagePullPolicy: Never`) |
| GitOps | ArgoCD watching `k8s-stg` repo |
| Monitoring | Prometheus + Grafana + Loki |
| Secrets | Vault |

## Project Structure

```
clab-platform/
├── apps/
│   ├── api-gateway/          # REST/WS facade            :4000
│   ├── orchestrator/         # Mission planner           :4001
│   ├── runtime-manager/      # Sticky session binding    :4002
│   ├── worker-codex/         # Codex execution worker    :4003
│   ├── worker-claude/        # Claude execution worker   :4004
│   ├── browser-service/      # Browser automation        :4005
│   ├── review-service/       # QA / verification         :4006
│   ├── knowledge-service/    # AKB knowledge layer       :4007
│   └── dashboard/            # Next.js operations UI     :3000
├── packages/
│   ├── domain/               # Entities, enums, state machines
│   ├── db/                   # Drizzle schema + migrations
│   ├── events/               # Event envelope + NATS bus
│   ├── policy/               # RBAC, capabilities, approval gates
│   ├── artifacts/            # Result artifacts store
│   ├── prompts/              # Role prompt templates
│   ├── cmux-adapter/         # cmux RPC adapter
│   ├── engines/              # Codex/Claude/Browser runners
│   ├── telemetry/            # OTel tracing + metrics + logging
│   ├── sdk/                  # Internal client SDK
│   └── knowledge/            # AKB knowledge layer
├── schemas/                  # JSON Schema definitions
├── scripts/
│   └── setup.sh              # Automated setup script
├── infra/
│   ├── docker/               # Dockerfiles + compose
│   ├── k8s/                  # Kustomize manifests (base + overlays)
│   ├── terraform/            # Cloud infrastructure
│   ├── grafana/              # Dashboards
│   └── otel/                 # Collector config
└── docs/
    ├── architecture/
    ├── adr/
    └── runbooks/
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ES2024) |
| Monorepo | pnpm + Turborepo |
| API | Hono |
| ORM | Drizzle |
| Database | PostgreSQL |
| Events | NATS JetStream |
| Dashboard | Next.js 15 + Tailwind v4 |
| Observability | OpenTelemetry + Grafana |
| Container | Docker |
| Orchestration | Kubernetes (Kustomize) |
| GitOps | ArgoCD |
| AI Agents | Claude Code CLI + OpenAI Codex CLI |
| Terminal Mux | cmux (tmux-based agent multiplexer) |

## Roles

| Role | Engine | Responsibility |
|------|--------|---------------|
| Mission-Service | Claude (main) | Coordination, decisions |
| Builder | Codex | Coding, tests, bug fixes |
| Architect | Codex | Technical design |
| PM | Claude CLI | Task decomposition |
| Operations-Reviewer | Claude CLI | QA, verification |
| Strategist | Codex | Strategy analysis |
| Research-Analyst | Codex | Research, documentation |

## License

MIT
