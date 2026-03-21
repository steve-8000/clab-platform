# ADR-001: Monorepo Structure

## Status

**Accepted** — 2026-03-01

## Context

clab v1 was a single MCP server (clab-cmux) that combined orchestration, worker management, browser automation, and state management into one process. As the system grew, this monolithic approach created several problems:

- **Tight coupling**: Changes to the browser service required redeploying the entire orchestrator.
- **Testing difficulty**: Unit testing individual components required mocking deeply intertwined dependencies.
- **Scaling limitations**: The orchestrator and workers had fundamentally different resource profiles, but couldn't be scaled independently.
- **Onboarding friction**: New contributors had to understand the entire codebase to make changes in one area.

We needed to split into multiple services while keeping the development experience cohesive.

### Options Considered

1. **Polyrepo** — Each service in its own repository.
   - Pros: True isolation, independent versioning.
   - Cons: Cross-cutting changes require coordinating multiple PRs, shared code must be published to a registry, version drift between shared dependencies.

2. **Monorepo with pnpm workspaces + Turborepo** — All services and shared packages in a single repository, with pnpm for dependency management and Turborepo for build orchestration.
   - Pros: Atomic cross-service changes, shared packages without publishing, consistent tooling, fast builds via caching.
   - Cons: Larger repository, more complex build configuration, need to understand workspace boundaries.

3. **Monorepo with Nx** — Similar to option 2 but using Nx instead of Turborepo.
   - Pros: More features (affected commands, generators), mature ecosystem.
   - Cons: Heavier, steeper learning curve, more opinionated project structure.

## Decision

We chose **pnpm workspaces + Turborepo** (Option 2) with the following structure:

```
clab-platform/
  apps/
    api-gateway/          # Hono HTTP gateway
    orchestrator/         # Mission planning and coordination
    runtime-manager/      # Worker lifecycle management
    browser-service/      # Playwright-based browser automation
    review-service/       # Quality gate and artifact review
    dashboard/            # React + Vite web UI
  packages/
    shared-types/         # TypeScript types shared across services
    db/                   # Drizzle schema, migrations, client
    nats-client/          # NATS connection and typed pub/sub helpers
    config/               # Shared configuration loading (env, defaults)
    logger/               # Structured logging (pino-based)
    testing/              # Shared test utilities and fixtures
  turbo.json
  pnpm-workspace.yaml
  package.json
```

### Conventions

- **apps/** contains deployable services. Each has its own Dockerfile and can be deployed independently.
- **packages/** contains shared libraries. They are never deployed alone, only consumed by apps.
- All packages use TypeScript and are built with `tsup`.
- Turborepo handles build ordering based on the dependency graph.
- A root `tsconfig.json` provides base TypeScript configuration; each package/app extends it.

## Consequences

### Positive

- **Atomic changes**: A schema change in `packages/db` and its consumers in `apps/orchestrator` can land in a single commit.
- **Shared code without publishing**: `packages/shared-types` is consumed directly via workspace protocol (`workspace:*`), no npm publish step.
- **Consistent tooling**: ESLint, Prettier, and TypeScript configs are defined once at the root and extended.
- **Fast iteration**: Turborepo caches build outputs. Unchanged packages are not rebuilt.
- **Independent deployment**: Each app has its own Dockerfile and build target. CI can build and deploy only affected services.

### Negative

- **Build complexity**: Turborepo configuration requires understanding the dependency graph. Misconfigured `turbo.json` can cause stale builds.
- **CI times**: Full builds (cold cache) take longer than they would for individual repos. Mitigated by Turborepo remote caching.
- **Repository size**: All service code in one repo means cloning is heavier. Acceptable at our scale.
- **Boundary discipline**: Easy to accidentally create cross-package imports that bypass the intended API. Enforced via ESLint import rules.

### Mitigations

- Turborepo remote caching is enabled for CI to avoid redundant builds.
- ESLint rules enforce that apps only import from packages, never from other apps.
- Each package exposes a clean `index.ts` barrel export; internal modules are not importable.
