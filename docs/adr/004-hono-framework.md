# ADR-004: Hono Framework

## Status

**Accepted** — 2026-03-01

## Context

Each microservice in clab-platform needs an HTTP framework for REST endpoints and, in the case of the API gateway, WebSocket support. We need a framework that is:

1. **TypeScript-first** — Full type inference for routes, middleware, and request/response bodies.
2. **Fast** — Low overhead per request; services handle internal traffic at high frequency.
3. **Lightweight** — Small dependency footprint; services should start quickly.
4. **Flexible** — Works across runtimes (Node.js today, possibly Bun or edge runtimes later).

### Options Considered

1. **Express**
   - Pros: Ubiquitous, massive ecosystem, everyone knows it.
   - Cons: TypeScript support is bolted on (@types/express), middleware types are loose, no built-in validation, showing its age (callback-era patterns), slow compared to alternatives.

2. **Fastify**
   - Pros: Fast, good TypeScript support, schema-based validation, rich plugin ecosystem.
   - Cons: Plugin system has a learning curve, TypeScript generics can be complex, heavier than needed for internal services, tied to Node.js.

3. **Hono**
   - Pros: TypeScript-first (written in TypeScript), extremely fast, tiny footprint (~14KB), runs on Node.js/Bun/Deno/Cloudflare Workers/Lambda, built-in middleware for common needs (CORS, JWT, logging), route type inference.
   - Cons: Younger project, smaller ecosystem than Express/Fastify, fewer third-party middleware options.

4. **tRPC**
   - Pros: End-to-end type safety, no API schema to maintain.
   - Cons: Requires TypeScript on both ends (workers might not be TS), heavier conceptual model, harder to debug with standard HTTP tools.

## Decision

We chose **Hono** as the HTTP framework for all services.

### Rationale

**TypeScript inference** is the standout feature. Hono infers route parameter types, request body types, and response types from the route definition:

```typescript
const app = new Hono()

app.get('/missions/:id', async (c) => {
  const id = c.req.param('id') // typed as string
  const mission = await getMission(id)
  return c.json(mission) // response type inferred
})
```

This eliminates an entire class of bugs where route handlers receive unexpected types.

**Performance** matters for internal service-to-service calls. The orchestrator makes many calls to the runtime manager during wave execution. Hono's routing is based on a RegExpRouter that benchmarks consistently faster than Express and comparable to Fastify.

**Runtime flexibility** is a strategic advantage. Today we run on Node.js, but Hono's portable API means we could move individual services to Bun (for faster startup) or edge runtimes (for the API gateway) without rewriting route handlers.

**Small footprint** means fast container startup. Each service's Docker image is smaller, and cold-start times are lower. This matters when scaling workers up and down.

**Built-in middleware** covers our common needs without third-party dependencies:

- `hono/cors` — CORS handling for dashboard requests
- `hono/jwt` — JWT validation for API authentication
- `hono/logger` — Request logging
- `hono/validator` — Input validation with Zod integration

## Consequences

### Positive

- Full TypeScript inference for routes, parameters, and responses.
- Minimal bundle size; services start in milliseconds.
- Portable across runtimes; future migration path to Bun or edge.
- Built-in middleware reduces dependency count.
- Clean, modern API that new contributors find intuitive.

### Negative

- Smaller middleware ecosystem than Express. Some niche middleware (rate limiting, session management) must be implemented or adapted.
- Fewer Stack Overflow answers and blog posts compared to Express.
- Breaking changes are possible in minor versions (though the project follows semver).
- Team members familiar with Express need to learn Hono's patterns (context-based vs. req/res).

### Mitigations

- Common middleware needs (rate limiting, error handling, request ID tracking) are implemented once in `packages/config` or as shared Hono middleware and reused across services.
- Hono's API surface is small and well-documented; the learning curve from Express is minimal.
- We pin Hono versions in `package.json` and update deliberately.
