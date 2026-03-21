import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Workspaces ───────────────────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Missions ─────────────────────────────────────────────────────────────────

export const missions = pgTable("missions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  objective: text("objective").notNull(),
  status: text("status").notNull().default("DRAFT"),
  priority: text("priority").notNull().default("NORMAL"),
  assumptions: jsonb("assumptions").$type<string[]>().default([]),
  constraints: jsonb("constraints").$type<string[]>().default([]),
  acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ─── Plans ────────────────────────────────────────────────────────────────────

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id")
    .notNull()
    .references(() => missions.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  summary: text("summary").notNull(),
  waveCount: integer("wave_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Waves ────────────────────────────────────────────────────────────────────

export const waves = pgTable("waves", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  missionId: uuid("mission_id")
    .notNull()
    .references(() => missions.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  label: text("label"),
  status: text("status").notNull().default("PENDING"),
  directive: text("directive"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  waveId: uuid("wave_id")
    .notNull()
    .references(() => waves.id, { onDelete: "cascade" }),
  missionId: uuid("mission_id")
    .notNull()
    .references(() => missions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  role: text("role").notNull(),
  engine: text("engine").notNull().default("CODEX"),
  status: text("status").notNull().default("QUEUED"),
  dependencies: jsonb("dependencies").$type<string[]>().default([]),
  acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().default([]),
  maxRetries: integer("max_retries").notNull().default(2),
  timeoutMs: integer("timeout_ms").notNull().default(300_000),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ─── Task Runs ────────────────────────────────────────────────────────────────

export const taskRuns = pgTable("task_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => agentSessions.id, {
    onDelete: "set null",
  }),
  attempt: integer("attempt").notNull().default(1),
  status: text("status").notNull().default("STARTING"),
  exitCode: integer("exit_code"),
  stdout: text("stdout"),
  stderr: text("stderr"),
  durationMs: integer("duration_ms"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

// ─── Agent Sessions ───────────────────────────────────────────────────────────

export const agentSessions = pgTable("agent_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  engine: text("engine").notNull(),
  state: text("state").notNull().default("IDLE"),
  paneId: text("pane_id"),
  pid: integer("pid"),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

// ─── Artifacts ────────────────────────────────────────────────────────────────

export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskRunId: uuid("task_run_id")
    .notNull()
    .references(() => taskRuns.id, { onDelete: "cascade" }),
  missionId: uuid("mission_id")
    .notNull()
    .references(() => missions.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  path: text("path"),
  content: text("content"),
  sizeBytes: integer("size_bytes"),
  checksum: text("checksum"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Decisions ────────────────────────────────────────────────────────────────

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id")
    .notNull()
    .references(() => missions.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  title: text("title").notNull(),
  reasoning: text("reasoning").notNull(),
  alternatives: jsonb("alternatives").$type<string[]>().default([]),
  chosenOption: text("chosen_option").notNull(),
  riskLevel: text("risk_level").notNull().default("LOW"),
  actorKind: text("actor_kind").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Approvals ────────────────────────────────────────────────────────────────

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id")
    .notNull()
    .references(() => missions.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  requestedCapability: text("requested_capability").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("PENDING"),
  riskLevel: text("risk_level").notNull().default("MEDIUM"),
  actorKind: text("actor_kind").notNull(),
  actorId: text("actor_id").notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Capability Leases ────────────────────────────────────────────────────────

export const capabilityLeases = pgTable("capability_leases", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  capability: text("capability").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ─── Events ───────────────────────────────────────────────────────────────────

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  version: integer("version").notNull().default(1),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  missionId: uuid("mission_id"),
  waveId: uuid("wave_id"),
  taskId: uuid("task_id"),
  taskRunId: uuid("task_run_id"),
  sessionId: uuid("session_id"),
  workspaceId: uuid("workspace_id"),
  actorKind: text("actor_kind").notNull(),
  actorId: text("actor_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  missions: many(missions),
  agentSessions: many(agentSessions),
}));

export const missionsRelations = relations(missions, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [missions.workspaceId],
    references: [workspaces.id],
  }),
  plans: many(plans),
  waves: many(waves),
  tasks: many(tasks),
  artifacts: many(artifacts),
  decisions: many(decisions),
  approvals: many(approvals),
}));

export const plansRelations = relations(plans, ({ one, many }) => ({
  mission: one(missions, {
    fields: [plans.missionId],
    references: [missions.id],
  }),
  waves: many(waves),
}));

export const wavesRelations = relations(waves, ({ one, many }) => ({
  plan: one(plans, {
    fields: [waves.planId],
    references: [plans.id],
  }),
  mission: one(missions, {
    fields: [waves.missionId],
    references: [missions.id],
  }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  wave: one(waves, {
    fields: [tasks.waveId],
    references: [waves.id],
  }),
  mission: one(missions, {
    fields: [tasks.missionId],
    references: [missions.id],
  }),
  taskRuns: many(taskRuns),
  decisions: many(decisions),
  approvals: many(approvals),
}));

export const taskRunsRelations = relations(taskRuns, ({ one, many }) => ({
  task: one(tasks, {
    fields: [taskRuns.taskId],
    references: [tasks.id],
  }),
  session: one(agentSessions, {
    fields: [taskRuns.sessionId],
    references: [agentSessions.id],
  }),
  artifacts: many(artifacts),
}));

export const agentSessionsRelations = relations(
  agentSessions,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [agentSessions.workspaceId],
      references: [workspaces.id],
    }),
    taskRuns: many(taskRuns),
    capabilityLeases: many(capabilityLeases),
  }),
);

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  taskRun: one(taskRuns, {
    fields: [artifacts.taskRunId],
    references: [taskRuns.id],
  }),
  mission: one(missions, {
    fields: [artifacts.missionId],
    references: [missions.id],
  }),
}));

export const decisionsRelations = relations(decisions, ({ one }) => ({
  mission: one(missions, {
    fields: [decisions.missionId],
    references: [missions.id],
  }),
  task: one(tasks, {
    fields: [decisions.taskId],
    references: [tasks.id],
  }),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  mission: one(missions, {
    fields: [approvals.missionId],
    references: [missions.id],
  }),
  task: one(tasks, {
    fields: [approvals.taskId],
    references: [tasks.id],
  }),
}));

export const capabilityLeasesRelations = relations(
  capabilityLeases,
  ({ one }) => ({
    session: one(agentSessions, {
      fields: [capabilityLeases.sessionId],
      references: [agentSessions.id],
    }),
  }),
);
