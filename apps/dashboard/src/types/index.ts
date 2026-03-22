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

// Knowledge
export interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  tags: string[];
  source: string;
  created_at: string;
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
