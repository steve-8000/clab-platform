// Thread / Run (Control Plane)
export interface Thread {
  id: string;
  worker_id: string;
  goal: string;
  workdir: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Run {
  id: string;
  thread_id: string;
  status: string;
  current_task: string | null;
  step: number;
  created_at: string;
  updated_at: string;
}

export interface RunEvent {
  event_id: string;
  thread_id: string;
  run_id: string | null;
  type: string;
  seq: number;
  ts: string;
  payload: Record<string, unknown>;
}

export interface Interrupt {
  id: string;
  thread_id: string;
  run_id: string | null;
  value: string;
  status: string;
  resume_value: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface Worker {
  worker_id: string;
  capabilities: string[];
  workdir: string;
  connected_at: number;
  last_heartbeat: number;
}

export interface Artifact {
  id: string;
  thread_id: string;
  run_id: string | null;
  type: string;
  path: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Runtime types
export interface WorkerRuntime {
  worker_id: string;
  hostname: string;
  platform: string;
  capabilities: string[];
  workdir: string;
  status: "online" | "offline" | "degraded";
  connected_at: string;
  last_heartbeat: string;
  version: string;
}

export interface WorkspaceRuntime {
  id: string;
  worker_id: string;
  workspace_id: string;
  name: string;
  role: "orchestrator" | "agent" | "browser" | "adhoc";
  status: "idle" | "busy" | "degraded" | "offline";
  current_thread_id?: string;
  current_run_id?: string;
  created_at: string;
  updated_at: string;
  last_sync_at?: string;
  surfaces?: SurfaceRuntime[];
}

export interface SurfaceRuntime {
  id: string;
  worker_id: string;
  workspace_id: string;
  surface_id: string;
  name: string;
  role: "planner" | "reviewer" | "worker" | "browser" | "shell";
  engine: "codex" | "claude" | "browser" | "shell";
  status: "idle" | "running" | "reviewing" | "fixing" | "waiting_input" | "error";
  last_output_excerpt?: string;
  last_activity_at?: string;
  metadata?: Record<string, unknown>;
}

export interface DispatchCommand {
  id: string;
  worker_id: string;
  workspace_id?: string;
  surface_id?: string;
  thread_id?: string;
  run_id?: string;
  command_type: "mission" | "prompt" | "cancel";
  payload: Record<string, unknown>;
  status: "queued" | "sent" | "acked" | "running" | "completed" | "failed" | "cancelled";
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Knowledge
export interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  tags: string[];
  source: string;
  created_at: string;
  is_static?: boolean;
  version?: number;
  is_latest?: boolean;
  is_forgotten?: boolean;
  forget_after?: string;
  relations?: Record<string, string[]>;
}

export interface ProfileResponse {
  static: KnowledgeEntry[];
  dynamic: KnowledgeEntry[];
  stats: {
    total_memories: number;
    static_count: number;
    dynamic_count: number;
    forgotten_count: number;
  };
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total: number;
}

export interface GraphNode {
  id: string;
  topic: string;
  source: string;
  is_static: boolean;
  created_at: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface InsightListResponse {
  insights: KnowledgeEntry[];
  total: number;
}

export interface DebtCheckResponse {
  passed: boolean;
  debts: { type: string; path: string; description: string }[];
  summary: {
    total: number;
    missing_crosslinks: number;
    missing_hub: number;
    orphan_docs: number;
    broken_links: number;
    stale_docs: number;
  };
}

// Health
export interface HealthData {
  status: string;
  service: string;
  threads: number;
  runs: number;
  checkpoints: number;
  pending_interrupts: number;
  workers: number;
}

// cmux Agent
export interface CmuxWorkspace {
  id: string;
  name: string;
  surfaces: CmuxSurface[];
}

export interface CmuxSurface {
  id: string;
  engine: string;
  status: string;
  lastOutput: string;
  url?: string; // for browser surfaces
}

// Code Intelligence
export interface Repository {
  id: string;
  url: string;
  name: string;
  default_branch: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  symbol_count?: number;
  relation_count?: number;
  last_indexed_at?: string;
}

export interface RepoSnapshot {
  id: string;
  repository_id: string;
  commit_hash: string;
  branch: string;
  snapshot_at: string;
  metadata: Record<string, unknown>;
}

export interface RepoSummary {
  total_files: number;
  total_symbols: number;
  total_relations: number;
  languages: Record<string, number>;
  top_complexity: Array<Record<string, unknown>>;
}

export interface SymbolNode {
  id: string;
  snapshot_id: string;
  fq_name: string;
  name: string;
  kind: string;
  file_path: string;
  line_number: number;
  language: string;
  metadata: Record<string, unknown>;
}

export interface ImpactAnalysis {
  target: string;
  direct: string[];
  transitive: string[];
  related_tests: string[];
  risk_score: number;
}

export interface Hotspot {
  file?: string;
  file_path: string;
  symbol_count: number;
  metric: string;
  complexity: number;
  fan_in: number;
  fan_out: number;
  recent_changes: number;
  review_failures: number;
  event_coupling: number;
  metric_value: number;
}

export interface StructuralFinding {
  id: string;
  snapshot_id: string;
  review_id: string;
  finding_type: string;
  severity: string;
  title: string;
  description: string;
  affected_symbols: string[];
  affected_files: string[];
  metrics_delta: Record<string, unknown> | null;
  recommendation: string | null;
  created_at: string;
}

export interface ContextBundle {
  id: string;
  snapshot_id: string;
  task_run_id: string;
  primary_targets: unknown[];
  direct_relations: unknown[];
  transitive_impact: unknown[];
  related_files: unknown[];
  related_tests: unknown[];
  hotspots: unknown[];
  warnings: unknown[];
  summary: string;
  created_at: string;
}
