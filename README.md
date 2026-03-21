# clab-platform — Execution Control Plane for Multi-Agent Orchestration

Stateful execution control plane where Claude orchestrates Codex/Claude agents through structured missions, waves, and tasks.

```
User Request → Mission → Plan → Waves → Tasks → Agent Sessions → Artifacts → Review
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    api-gateway :4000                     │
│              REST / WebSocket / MCP                      │
├─────────────┬───────────────────────┬───────────────────┤
│ orchestrator│   runtime-manager     │  review-service   │
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
| IaC | Terraform |

## Quick Start

```bash
# Clone
git clone https://github.com/steve-8000/clab-platform.git
cd clab-platform

# Install
pnpm install

# Start infrastructure
docker compose -f infra/docker/docker-compose.yml up -d postgres nats

# Run migrations
pnpm db:push

# Start all services
pnpm dev
```

## Project Structure

```
clab-platform/
├── apps/
│   ├── api-gateway/          # REST/WS/MCP facade       :4000
│   ├── orchestrator/         # Mission planner, scheduler :4001
│   ├── runtime-manager/      # Session binding, cmux     :4002
│   ├── worker-codex/         # Codex execution worker    :4003
│   ├── worker-claude/        # Claude CLI worker         :4004
│   ├── browser-service/      # Browser automation        :4005
│   ├── review-service/       # QA / verification         :4006
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
├── infra/
│   ├── docker/               # Dockerfiles + compose
│   ├── k8s/                  # Kustomize manifests
│   ├── terraform/            # AWS infrastructure
│   ├── grafana/              # Dashboards
│   └── otel/                 # Collector config
└── docs/
    ├── architecture/         # System design
    ├── adr/                  # Architecture Decision Records
    └── runbooks/             # Operations guides
```

## Services

| Service | Port | Role |
|---------|------|------|
| api-gateway | 4000 | External entry point |
| orchestrator | 4001 | Mission planning, wave scheduling |
| runtime-manager | 4002 | Session lifecycle, cmux control |
| worker-codex | 4003 | Codex task execution |
| worker-claude | 4004 | Claude CLI execution |
| browser-service | 4005 | Browser automation |
| review-service | 4006 | QA and verification |
| dashboard | 3000 | Operations UI |

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
