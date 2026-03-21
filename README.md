# clab-platform — Execution Control Plane for Multi-Agent Orchestration

Stateful execution control plane where Claude orchestrates Codex/Claude agents through structured missions, waves, and tasks.

```
User Request → Mission → Plan → Waves → Tasks → Agent Sessions → Artifacts → Review
```

## Quick Start

```bash
# Clone
git clone https://github.com/steve-8000/clab-platform.git
cd clab-platform

# Automated setup (installs Claude Code, Codex, deps, registers plugin)
./scripts/setup.sh

# Or manual setup — see below
```

## Setup (Manual)

### 1. Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | >= 22 | https://nodejs.org or `nvm install 22` |
| pnpm | >= 9.15 | `corepack enable && corepack prepare pnpm@9.15.4 --activate` |
| tmux | any | `brew install tmux` (macOS) / `apt install tmux` (Linux) |
| Docker | any | https://docs.docker.com/get-docker/ (optional, for containers) |

### 2. Install Claude Code + Codex

```bash
# Claude Code CLI
curl -fsSL https://claude.ai/install.sh | sh    # macOS
# or: npm install -g @anthropic-ai/claude-code

# Codex CLI
npm install -g @openai/codex
```

### 3. Install Dependencies & Configure

```bash
pnpm install

# Create .env and add your API keys
cp .env.example .env
# ANTHROPIC_API_KEY=sk-ant-xxxxx
# OPENAI_API_KEY=sk-xxxxx
```

### 4. Register clab Plugin in Claude Code

The clab plugin connects Claude Code to this platform via MCP (36 tools: codex dispatch, wave orchestration, browser automation, AKB knowledge, etc).

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
│              REST / WebSocket / MCP                      │
├─────────────┬───────────────────────┬───────────────────┤
│mission-service│  runtime-manager     │  review-service   │
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
| api-gateway | 4000 | External entry point (REST/WS/MCP) |
| mission-service | 4001 | Mission planning, wave scheduling |
| runtime-manager | 4002 | Session lifecycle, cmux control |
| worker-codex | 4003 | Codex task execution |
| worker-claude | 4004 | Claude CLI execution |
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
│   ├── api-gateway/          # REST/WS/MCP facade       :4000
│   ├── mission-service/      # Mission planner           :4001
│   ├── runtime-manager/      # Session binding, cmux     :4002
│   ├── worker-codex/         # Codex execution worker    :4003
│   ├── worker-claude/        # Claude CLI worker         :4004
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
│   ├── mcp-contracts/        # MCP tool schemas
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
