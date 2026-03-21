# ADR-005: Drizzle ORM

## Status

**Accepted** — 2026-03-01

## Context

clab-platform uses PostgreSQL (see ADR-002) and needs an ORM or query builder for:

1. **Schema definition** — Define tables, columns, constraints, and relations in TypeScript.
2. **Type-safe queries** — Compile-time checking that queries match the schema.
3. **Migrations** — Generate and apply database schema changes.
4. **JSONB support** — First-class support for querying JSONB columns.

### Options Considered

1. **Prisma**
   - Pros: Most popular TypeScript ORM, excellent documentation, visual studio (Prisma Studio), large community.
   - Cons: Requires a code generation step (`prisma generate`), generated client is large (~2MB), schema is defined in `.prisma` files (not TypeScript), JSONB querying is limited, query API abstracts SQL heavily.

2. **Drizzle ORM**
   - Pros: Schema defined in TypeScript, no code generation step, SQL-like query API, excellent type inference, lightweight runtime, first-class JSONB support, schema is just TypeScript (importable, composable).
   - Cons: Younger project, smaller community, fewer guides and tutorials, some advanced features still maturing.

3. **Kysely**
   - Pros: Pure query builder (no ORM opinions), excellent TypeScript types, SQL-like.
   - Cons: No schema definition (types must be maintained manually or generated), no built-in migration tooling, more boilerplate for common operations.

4. **Raw pg + sql template tags**
   - Pros: Full SQL control, zero abstraction overhead.
   - Cons: No type safety, manual migration management, high boilerplate, error-prone.

## Decision

We chose **Drizzle ORM** with `drizzle-kit` for migrations.

### Rationale

**No code generation** is the strongest advantage. With Prisma, every schema change requires running `prisma generate` before TypeScript can see the new types. This adds friction to the development loop and can cause confusing errors when the generated client is stale. Drizzle's schema is plain TypeScript -- change the schema file, and types update immediately.

**SQL-like API** means developers write queries that map directly to SQL:

```typescript
// Drizzle — reads like SQL
const result = await db
  .select()
  .from(tasks)
  .where(and(
    eq(tasks.waveId, waveId),
    eq(tasks.status, 'COMPLETED')
  ))
  .orderBy(desc(tasks.completedAt))

// vs. Prisma — proprietary query language
const result = await prisma.task.findMany({
  where: { waveId, status: 'COMPLETED' },
  orderBy: { completedAt: 'desc' }
})
```

The Drizzle version is immediately understandable to anyone who knows SQL. The Prisma version requires learning Prisma's query API.

**Type inference from schema** means the query result types are derived from the schema definition:

```typescript
// Schema definition
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  status: text('status', { enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'] }).notNull(),
  spec: jsonb('spec').$type<TaskSpec>(),
  // ...
})

// Query result is automatically typed
const task = await db.select().from(tasks).where(eq(tasks.id, id))
// task[0].spec is typed as TaskSpec | null
```

**JSONB querying** is first-class:

```typescript
// Query tasks where spec contains a specific language
await db.select().from(tasks)
  .where(sql`${tasks.spec} @> '{"language": "typescript"}'::jsonb`)
```

**Lightweight runtime** means faster service startup. Drizzle's runtime is a thin query builder layer over the PostgreSQL driver. No heavy client to initialize.

**drizzle-kit** provides migration tooling:

- `drizzle-kit generate` — generates SQL migrations from schema changes
- `drizzle-kit migrate` — applies pending migrations
- `drizzle-kit studio` — visual database browser (like Prisma Studio)

## Schema Organization

The schema is defined in `packages/db/src/schema/`:

```
packages/db/src/schema/
  missions.ts      # missions table
  plans.ts         # plans table
  waves.ts         # waves table
  tasks.ts         # tasks table
  task-runs.ts     # task_runs table
  sessions.ts      # agent_sessions table
  artifacts.ts     # artifacts table
  decisions.ts     # decisions table
  events.ts        # events table
  relations.ts     # Drizzle relation definitions
  index.ts         # Barrel export
```

Each file exports the table definition and its inferred types:

```typescript
// tasks.ts
export const tasks = pgTable('tasks', { ... })
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
```

## Consequences

### Positive

- No code generation step; schema changes are immediately reflected in types.
- SQL-like API is accessible to anyone who knows SQL.
- Lightweight runtime; fast service startup.
- First-class JSONB support for flexible metadata columns.
- Schema is composable TypeScript; can be imported by any package.
- `drizzle-kit` provides migration generation and a visual studio.

### Negative

- Smaller community; fewer blog posts, tutorials, and Stack Overflow answers.
- Some advanced patterns (complex subqueries, CTEs) require dropping to raw SQL via `sql` template tag.
- Relation queries (`.query` API) are less intuitive than Prisma's nested includes.
- Ecosystem integrations (auth libraries, admin panels) are fewer than Prisma's.

### Mitigations

- Complex queries use Drizzle's `sql` template tag, which still provides type-safe interpolation.
- Shared query patterns are abstracted into repository functions in `packages/db`, so individual services don't need to write complex queries.
- The team maintains a `QUERIES.md` file with examples of common patterns for reference.
