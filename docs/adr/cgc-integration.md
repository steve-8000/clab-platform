# ADR: CodeGraphContext(CGC) Integration

- **Status**: ACCEPTED
- **Date**: 2026-03-22

## Context

clab-platform needs structural code intelligence to improve planning accuracy, runtime context, and review quality. CodeGraphContext (CGC) provides indexing, symbol extraction, relationship analysis, and complexity signals as an open-source Python tool.

## Decision

Integrate CGC as an external engine via adapter pattern, keeping clab-platform in control of its own domain models.

### Key Decisions

1. **CGC as engine, not embedded**: CGC is used through `CodeIntelEngine` interface. No CGC internals leak into clab domain.
2. **KuzuDB embedded**: Zero-config graph DB, no external service dependency.
3. **CLI adapter first**: `CgcCliEngineAdapter` wraps CGC CLI subprocess calls. Interface allows future `CgcMcpEngineAdapter`.
4. **Snapshot-based indexing**: On-demand indexing, not real-time watch. Each index run creates a `RepoSnapshot` + `GraphBuild`.
5. **Graceful degradation**: CGC unavailable = empty results, never platform crash.
6. **PostgreSQL for normalized data**: Raw CGC results cached as artifacts; dashboard queries hit normalized `ci_*` tables.

## Architecture

```
clab-platform
├─ apps/code-intel/          ← FastAPI service
│   ├─ app.py                ← Routes + background indexing
│   ├─ models.py             ← Domain + request/response models
│   ├─ config.py             ← Environment config
│   └─ schema.sql            ← PostgreSQL DDL (9 tables)
├─ packages/codegraph/       ← Adapter package
│   ├─ engine.py             ← CodeIntelEngine ABC
│   ├─ cli_adapter.py        ← CgcCliEngineAdapter
│   ├─ models.py             ← Engine output models
│   └─ normalizer.py         ← CGC → clab domain translation
├─ apps/dashboard/           ← Dashboard integration
│   ├─ src/app/code-intel/   ← 5 pages (list, detail, impact, findings, hotspots)
│   ├─ src/hooks/use-code-intel.ts
│   └─ src/lib/api.ts        ← ci API client
└─ vendor/codegraphcontext/  ← git submodule (external engine)
```

## Domain Models

| Model | Purpose |
|-------|---------|
| Repository | Platform-managed repo |
| RepoSnapshot | Point-in-time index |
| GraphBuild | Index run lifecycle |
| SymbolNode | Normalized symbol |
| RelationEdge | Normalized relationship |
| ImpactAnalysis | Change blast radius |
| ContextBundle | TaskRun structural context |
| StructuralFinding | Review structural risk |
| ScopeDriftEvent | Plan vs actual scope delta |

## API Endpoints

- `POST /repositories` — Register repo
- `POST /repositories/:id/index` — Trigger indexing
- `GET /repositories` — List repos
- `GET /repositories/:id/summary` — Repo stats
- `GET /repositories/:id/symbols/search` — Symbol search
- `GET /repositories/:id/impact` — Impact analysis
- `GET /repositories/:id/hotspots` — Complexity hotspots
- `GET /task-runs/:id/context-bundle` — TaskRun context
- `GET /reviews/:id/structural-findings` — Review findings

## Integration Points

### Planning (Phase 4)
- Planner fetches repo summary before task decomposition
- Impact pre-analysis for candidate tasks
- Wave decomposition considers graph locality

### Runtime (Phase 3)
- Runtime-manager requests ContextBundle before TaskRun start
- Bundle injected into worker prompt context
- Degraded mode if bundle generation fails

### Review (Phase 5)
- Before/after snapshot comparison
- StructuralFinding generation (NEW_CYCLE, BLAST_RADIUS_INCREASED, etc.)
- Severity-based approval hints

## Failure Handling

- code-intel unavailable → degraded mode, empty results
- Bundle generation failure → worker runs with minimal context
- Findings generation failure → standard review continues
- Dashboard → clear empty/error states
- Retry limits enforced, no retry storms

## Risks

1. CGC CLI output format may change between versions
2. Large repos may timeout during indexing
3. KuzuDB index storage grows with repo count
4. Dashboard progressive loading needed for large graphs

## Consequences

- Workers get structural context → fewer blind searches, more accurate edits
- Reviews catch structural risks automatically
- Planning can use dependency clusters for wave decomposition
- Dashboard becomes decision-support surface, not just monitoring
