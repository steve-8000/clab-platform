# clab-platform

Shared memory system for Claude, Codex, and OpenCode.

This repository is no longer the legacy multi-agent orchestration platform. It is the replacement target for a memory-first stack built around:

- `knowledge-server/` as the `memory-gateway`
- `letta-api` as the shared memory plane
- PostgreSQL with pgvector for Letta persistence
- thin runtime adapters for Claude, Codex, and OpenCode

## Active Scope

- `knowledge-server/` — memory-gateway implementation
- `knowledge/` — reusable memory/knowledge library code
- `mcp-server/` — adapter/tooling surface to be repurposed for runtime integration
- `docs/reports/` — phase verification reports

## Deprecated Scope

The previous control-plane, dashboard, code-intel, local-agent orchestration, and codegraph platform surfaces have been removed from the active replacement target.

## Local Verification

```bash
cd knowledge-server
go test ./...
```

## Staging Workload

GitOps manifests live under:

```bash
/Users/steve/k8s-stg/workloads/clab-platform
```

The active rendered stack is memory-only:

- `memory-gateway`
- `letta-api`
- `postgres`
- `memory.clab.one` ingress
