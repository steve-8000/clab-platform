# clab-platform -- Execution Control Plane for Multi-Agent Orchestration

Stateful execution control plane where Claude orchestrates Codex/Claude agents through structured missions, waves, and tasks.

```
User Request -> Mission -> Plan -> Waves -> Tasks -> Agent Sessions -> Artifacts -> Review
```

## Quick Start

```bash
# 1. Install prerequisites (user responsibility)
#    - Node.js >= 22     : https://nodejs.org or nvm install 22
#    - pnpm >= 9.15      : corepack enable && corepack prepare pnpm@9.15.4 --activate
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
| Claude Code CLI | latest | `curl -fsSL https://claude.ai/install.sh \| sh` or `npm install -g @anthropic-ai/claude-code` |
| Codex CLI | latest | `npm install -g @openai/codex` |
| Docker | any | https://docs.docker.com/get-docker/ (optional, for containers) |

## What `setup.sh` Does

1. Verifies all prerequisites are installed
2. `pnpm install` -- installs project dependencies
3. Creates `.env`
4. Prepares the repo for MCP-first operation with `.mcp.json`, `CLAUDE.md`, and `AGENTS.md`

## How It Works

```
Claude / Codex                    clab MCP                      K8s / Host Runtime
+----------------------+          +------------------------+    +---------------------+
| CLAUDE.md / AGENTS.md | -------> | stdio MCP server       | -> | api-gateway          |
| project hooks         |          | tool routing + policy  |    | orchestrator         |
| local model client    |          |                        |    | review-service       |
+----------------------+          +------------------------+    | knowledge-service    |
                                                                 | dashboard / nats / db|
                                                                 +---------------------+
```

- Claude and Codex reach the deployed platform through the `clab` MCP server.
- `CLAB_API_URL` is the control-plane entry point.
- K8s hosts the control plane and data plane; local Claude/Codex clients execute through MCP.

## Manual Setup

### 1. Install Dependencies & Configure

```bash
pnpm install

# Create .env and set CLAB_API_URL for your target environment
cp .env.example .env 2>/dev/null || true
```

### 2. Connect Claude and Codex Through MCP

```bash
# The repo already ships .mcp.json
# Start Claude or Codex from this repository root
claude
codex
```

Claude project rules live in `.claude/settings.json` and `CLAUDE.md`. Codex rules live in `AGENTS.md`.

### 5. Start Services

```bash
# Start PostgreSQL + NATS
docker compose -f infra/docker/docker-compose.yml up -d postgres nats

# Run database migrations
pnpm db:push

# Start all services in dev mode if running locally
pnpm dev
```

### 6. Use the MCP Tools

```bash
# Launch from the repo root so .mcp.json is discovered
claude
codex
```

## Architecture

```
+----------------------------------------------------------+
|                    api-gateway :4000                       |
|                REST facade for MCP tools                  |
+-------------+------------------------+-------------------+
| orchestrator |  runtime-manager      |  review-service   |
|    :4001     |       :4002           |     :4006         |
+-------------+------------------------+-------------------+
| knowledge-service :4007              | dashboard :3000   |
+----------------------------------------------------------+
|                PostgreSQL + NATS JetStream                |
+----------------------------------------------------------+
```

## Domain Model

```
Mission
  +- Plan
      +- Wave[]
          +- Task[]
              +- TaskRun[]
                  +- AgentSession
                      +- Artifact[]
                      +- Decision[]
```

## Services

| Service | Port | Role |
|---------|------|------|
| api-gateway | 4000 | External entry point (REST) |
| orchestrator | 4001 | Mission planning, wave scheduling |
| runtime-manager | 4002 | Session and state tracking |
| browser-service | 4005 | Browser automation (Playwright) |
| review-service | 4006 | QA and verification |
| knowledge-service | 4007 | AKB knowledge layer |
| dashboard | 3000 | Operations UI |
| worker-claude | -- | Claude CLI task executor |
| worker-codex | -- | Codex CLI task executor |

## Deployment (K8s / ArgoCD GitOps)

### Build & Deploy to K8s

```bash
# Build all service images
for svc in api-gateway orchestrator runtime-manager browser-service review-service knowledge-service; do
  docker build --build-arg SERVICE=$svc -t clab/$svc:v3 .
done
docker build -f infra/docker/Dockerfile.dashboard -t clab/dashboard:v3 .

# Import to k3s containerd (for imagePullPolicy: Never)
for img in api-gateway orchestrator runtime-manager browser-service review-service knowledge-service dashboard; do
  docker save clab/$img:v3 | ssh user@server ctr images import -
done

# ArgoCD syncs from the k8s-stg repo automatically
```

### GitOps Architecture

```
clab-platform (source)          k8s-stg (deployment repo)      K8s Cluster
+------------------+           +---------------------+        +--------------+
| apps/             |  build   | workloads/           |  sync  | ns:           |
| packages/         | ------>  |   clab-platform/     | -----> | clab-platform |
| infra/k8s/        |  image   |     kustomization.yaml| ArgoCD|              |
| Dockerfile        |          |     services.yaml    |        | core workloads|
+------------------+           |     dashboard.yaml   |        +--------------+
                               |     postgres.yaml    |
                               |     nats.yaml        |
                               +---------------------+
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
+-- apps/
|   +-- api-gateway/          # REST facade                :4000
|   +-- orchestrator/         # Mission planner            :4001
|   +-- runtime-manager/      # Session state manager      :4002
|   +-- browser-service/      # Browser automation         :4005
|   +-- review-service/       # QA / verification          :4006
|   +-- knowledge-service/    # AKB knowledge layer        :4007
|   +-- dashboard/            # Next.js operations UI      :3000
|   +-- worker-claude/        # Claude CLI executor
|   +-- worker-codex/         # Codex CLI executor
+-- packages/
|   +-- domain/               # Entities, enums, state machines
|   +-- db/                   # Drizzle schema + migrations
|   +-- events/               # Event envelope + NATS bus
|   +-- policy/               # RBAC, capabilities, approval gates
|   +-- engines/              # Shared execution helpers
|   +-- cmux-adapter/         # Local session adapter
|   +-- telemetry/            # OTel tracing + metrics + logging
|   +-- knowledge/            # AKB knowledge layer
|   +-- mcp-contracts/        # MCP tool contracts
|   +-- runtime-contracts/    # Runtime interface contracts
+-- schemas/                  # JSON Schema definitions
+-- scripts/
|   +-- setup.sh              # Automated setup script
+-- infra/
|   +-- docker/               # Dockerfiles + compose
|   +-- k8s/                  # Kustomize manifests (base + overlays)
|   +-- terraform/            # Cloud infrastructure
|   +-- grafana/              # Dashboards
|   +-- otel/                 # Collector config
+-- docs/
    +-- architecture/
    +-- adr/
    +-- runbooks/
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
| Integration | MCP + repo rules + hooks |

## Roles

| Role | Engine | Responsibility |
|------|--------|---------------|
| Orchestrator | Claude (main) | Coordination, decisions |
| Builder | Codex | Coding, tests, bug fixes |
| Architect | Codex | Technical design |
| PM | Claude CLI | Task decomposition |
| Operations-Reviewer | Claude CLI | QA, verification |
| Strategist | Codex | Strategy analysis |
| Research-Analyst | Codex | Research, documentation |

## License

MIT
